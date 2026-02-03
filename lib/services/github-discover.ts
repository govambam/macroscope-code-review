import { Octokit } from "@octokit/rest";
import { config } from "@/lib/config";
import { OrgMonthlyMetrics } from "@/lib/types/discover";

function getOctokit(): Octokit {
  const token = config.githubToken;
  if (!token) {
    throw new Error("GitHub bot token not configured");
  }
  return new Octokit({ auth: token });
}

// Cutoff date: only include PRs where ALL commits are after this date
const COMMIT_CUTOFF_DATE = new Date("2026-01-01T00:00:00Z");

export async function fetchRecentPRs(owner: string, repo: string, limit: number = 100) {
  const octokit = getOctokit();

  // Fetch recent PRs (both open and closed)
  const { data: prs } = await octokit.pulls.list({
    owner,
    repo,
    state: "all",
    sort: "updated",
    direction: "desc",
    per_page: limit,
  });

  return prs;
}

export async function fetchPRDetails(owner: string, repo: string, pullNumber: number) {
  const octokit = getOctokit();

  // Get detailed PR info including additions/deletions
  const { data: pr } = await octokit.pulls.get({
    owner,
    repo,
    pull_number: pullNumber,
  });

  return pr;
}

const MAX_FILES_LIMIT = 500;

export async function fetchPRFiles(owner: string, repo: string, pullNumber: number) {
  const octokit = getOctokit();

  // Get list of files changed (for LLM analysis)
  // Use paginate to handle PRs with more than 100 files, with a limit to prevent OOM
  const files: Awaited<ReturnType<typeof octokit.pulls.listFiles>>["data"] = [];

  await octokit.paginate(
    octokit.pulls.listFiles,
    {
      owner,
      repo,
      pull_number: pullNumber,
      per_page: 100,
    },
    (response, done) => {
      for (const file of response.data) {
        if (files.length >= MAX_FILES_LIMIT) {
          done();
          break;
        }
        files.push(file);
      }
      return [];
    }
  );

  return files.map((f) => ({
    filename: f.filename,
    status: f.status,
    additions: f.additions,
    deletions: f.deletions,
    changes: f.changes,
  }));
}

export function parseRepoUrl(input: string): { owner: string; repo: string } | null {
  // Handle various formats:
  // - https://github.com/owner/repo
  // - github.com/owner/repo
  // - owner/repo
  // - https://github.com/owner/repo/pull/123 (extract repo)

  const patterns = [/github\.com\/([^\/]+)\/([^\/\?]+)/, /^([^\/]+)\/([^\/]+)$/];

  for (const pattern of patterns) {
    const match = input.match(pattern);
    if (match) {
      return {
        owner: match[1],
        repo: match[2].replace(/\.git$/, "").split("/")[0],
      };
    }
  }

  return null;
}

/**
 * Fetch commits for a PR to check their commit dates.
 * Returns the list of commit dates.
 */
export async function fetchPRCommits(owner: string, repo: string, pullNumber: number): Promise<Date[]> {
  const octokit = getOctokit();

  const commits: Date[] = [];

  await octokit.paginate(
    octokit.pulls.listCommits,
    {
      owner,
      repo,
      pull_number: pullNumber,
      per_page: 100,
    },
    (response, done) => {
      for (const commit of response.data) {
        // Use the commit date (when the commit was made), not the author date
        const commitDate = commit.commit.committer?.date || commit.commit.author?.date;
        if (commitDate) {
          commits.push(new Date(commitDate));
        }
        // Limit to first 250 commits to avoid excessive API calls
        if (commits.length >= 250) {
          done();
          break;
        }
      }
      return [];
    }
  );

  return commits;
}

/**
 * Check if all commits in a PR are after the cutoff date (January 1, 2026).
 */
export async function areAllCommitsAfterCutoff(owner: string, repo: string, pullNumber: number): Promise<boolean> {
  const commitDates = await fetchPRCommits(owner, repo, pullNumber);

  if (commitDates.length === 0) {
    return false; // No commits found, don't include this PR
  }

  return commitDates.every(date => date >= COMMIT_CUTOFF_DATE);
}

/**
 * Fetch all repositories for an organization.
 * Returns repos sorted by recent activity.
 */
export async function fetchOrgRepos(org: string): Promise<Array<{ owner: string; name: string; updated_at: string }>> {
  const octokit = getOctokit();

  const repos: Array<{ owner: string; name: string; updated_at: string }> = [];

  await octokit.paginate(
    octokit.repos.listForOrg,
    {
      org,
      type: "all",
      sort: "updated",
      direction: "desc",
      per_page: 100,
    },
    (response, done) => {
      for (const repo of response.data) {
        // Skip archived repos
        if (repo.archived) continue;

        repos.push({
          owner: repo.owner.login,
          name: repo.name,
          updated_at: repo.updated_at || "",
        });

        // Limit to 100 most recently updated repos
        if (repos.length >= 100) {
          done();
          break;
        }
      }
      return [];
    }
  );

  return repos;
}

/**
 * Fetch recent PRs across all repos in an organization.
 * Returns PRs from the last 30 days, limited to the most active repos.
 */
export async function fetchOrgRecentPRs(
  org: string,
  limit: number = 100
): Promise<Array<Awaited<ReturnType<typeof fetchRecentPRs>>[number] & { repo_owner: string; repo_name: string }>> {
  const octokit = getOctokit();

  // Get recently updated repos
  const repos = await fetchOrgRepos(org);

  // Fetch PRs from each repo (limit to top 20 repos to avoid rate limits)
  const allPRs: Array<Awaited<ReturnType<typeof fetchRecentPRs>>[number] & { repo_owner: string; repo_name: string }> = [];

  const reposToCheck = repos.slice(0, 20);

  for (const repo of reposToCheck) {
    try {
      const prs = await fetchRecentPRs(repo.owner, repo.name, 50);
      const prsWithRepo = prs.map(pr => ({
        ...pr,
        repo_owner: repo.owner,
        repo_name: repo.name,
      }));
      allPRs.push(...prsWithRepo);
    } catch (error) {
      console.error(`Failed to fetch PRs for ${repo.owner}/${repo.name}:`, error);
      // Continue with other repos
    }
  }

  // Sort by updated_at descending and limit
  allPRs.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());

  return allPRs.slice(0, limit);
}

/**
 * Calculate monthly metrics for an organization.
 * Uses GitHub's statistics APIs where possible, falls back to PR/commit enumeration.
 */
export async function calculateOrgMonthlyMetrics(org: string): Promise<OrgMonthlyMetrics> {
  const octokit = getOctokit();

  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  let monthlyPRs = 0;
  let monthlyCommits = 0;
  let monthlyLinesChanged = 0;

  // Get repos for the org
  const repos = await fetchOrgRepos(org);
  const reposToAnalyze = repos.slice(0, 30); // Analyze top 30 most active repos

  // For each repo, try to get stats
  for (const repo of reposToAnalyze) {
    try {
      // Count PRs created in the last 30 days using search API (more efficient)
      const prSearchResult = await octokit.search.issuesAndPullRequests({
        q: `repo:${repo.owner}/${repo.name} is:pr created:>=${thirtyDaysAgo.toISOString().split('T')[0]}`,
        per_page: 1,
      });
      monthlyPRs += prSearchResult.data.total_count;

      // Try to get commit activity from stats API
      try {
        const { data: commitActivity } = await octokit.repos.getCommitActivityStats({
          owner: repo.owner,
          repo: repo.name,
        });

        // commitActivity is weekly data for the last year
        // Each week has: { days: number[], total: number, week: number (unix timestamp) }
        if (Array.isArray(commitActivity)) {
          const fourWeeksAgo = now.getTime() - 30 * 24 * 60 * 60 * 1000;
          for (const week of commitActivity) {
            const weekTime = week.week * 1000; // Convert to milliseconds
            if (weekTime >= fourWeeksAgo) {
              monthlyCommits += week.total;
            }
          }
        }
      } catch {
        // Stats API may return 202 if computing, fall back to listing commits
        try {
          const { data: commits } = await octokit.repos.listCommits({
            owner: repo.owner,
            repo: repo.name,
            since: thirtyDaysAgo.toISOString(),
            per_page: 100,
          });
          monthlyCommits += commits.length;
        } catch {
          // Skip this repo for commits
        }
      }

      // Try to get code frequency stats for lines changed
      try {
        const { data: codeFrequency } = await octokit.repos.getCodeFrequencyStats({
          owner: repo.owner,
          repo: repo.name,
        });

        // codeFrequency is weekly: [timestamp, additions, deletions]
        if (Array.isArray(codeFrequency)) {
          const fourWeeksAgo = now.getTime() - 30 * 24 * 60 * 60 * 1000;
          for (const week of codeFrequency) {
            const weekTime = week[0] * 1000; // Convert to milliseconds
            if (weekTime >= fourWeeksAgo) {
              monthlyLinesChanged += Math.abs(week[1]) + Math.abs(week[2]);
            }
          }
        }
      } catch {
        // Stats API may return 202 if computing, skip lines changed for this repo
      }

    } catch (error) {
      console.error(`Failed to get stats for ${repo.owner}/${repo.name}:`, error);
      // Continue with other repos
    }
  }

  return {
    org,
    monthly_prs: monthlyPRs,
    monthly_commits: monthlyCommits,
    monthly_lines_changed: monthlyLinesChanged,
    period_start: thirtyDaysAgo.toISOString(),
    period_end: now.toISOString(),
    calculated_at: now.toISOString(),
  };
}
