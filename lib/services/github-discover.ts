import { Octokit } from "@octokit/rest";
import { config } from "@/lib/config";

function getOctokit(): Octokit {
  const token = config.githubToken;
  if (!token) {
    throw new Error("GitHub bot token not configured");
  }
  return new Octokit({ auth: token });
}

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

export async function fetchPRFiles(owner: string, repo: string, pullNumber: number) {
  const octokit = getOctokit();

  // Get list of files changed (for LLM analysis)
  // Use paginate to handle PRs with more than 100 files
  const files = await octokit.paginate(octokit.pulls.listFiles, {
    owner,
    repo,
    pull_number: pullNumber,
    per_page: 100,
  });

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

  const patterns = [/github\.com\/([^\/]+)\/([^\/]+)/, /^([^\/]+)\/([^\/]+)$/];

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
