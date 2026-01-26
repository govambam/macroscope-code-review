import { Octokit } from "@octokit/rest";
import { config } from "../config";

/**
 * Status of a Macroscope code review check.
 */
export interface MacroscopeCheckStatus {
  status: "pending" | "in_progress" | "completed" | "failed";
  conclusion?: "success" | "failure" | "neutral" | "cancelled" | "timed_out" | null;
  startedAt?: string | null;
  completedAt?: string | null;
  bugsFound: number;
  comments: MacroscopeComment[];
}

/**
 * A comment left by Macroscope on a PR.
 */
export interface MacroscopeComment {
  id: number;
  body: string;
  path: string;
  line: number | null;
  createdAt: string;
}

/**
 * Check the status of Macroscope code review for a PR.
 *
 * This checks:
 * 1. GitHub Check Run status (pending/in_progress/completed)
 * 2. Macroscope bot comments (bugs found)
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param prNumber - Pull request number
 * @returns The current status of the Macroscope review
 */
export async function checkMacroscopeReviewStatus(
  owner: string,
  repo: string,
  prNumber: number
): Promise<MacroscopeCheckStatus> {
  const githubToken = config.githubToken;

  if (!githubToken) {
    console.error("GITHUB_BOT_TOKEN not configured");
    return {
      status: "failed",
      bugsFound: 0,
      comments: [],
    };
  }

  const octokit = new Octokit({ auth: githubToken });

  try {
    // 1. Get the PR to get the latest commit SHA
    const { data: pr } = await octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: prNumber,
    });

    const headSha = pr.head.sha;

    // 2. Get check runs for this commit
    const { data: checkRuns } = await octokit.rest.checks.listForRef({
      owner,
      repo,
      ref: headSha,
    });

    // 3. Find the Macroscope check (could be named differently)
    const macroscopeCheck = checkRuns.check_runs.find(
      (check) =>
        check.name.toLowerCase().includes("macroscope") ||
        check.name.toLowerCase().includes("correctness")
    );

    if (!macroscopeCheck) {
      // Check hasn't started yet
      return {
        status: "pending",
        bugsFound: 0,
        comments: [],
      };
    }

    // 4. Determine status from check
    let status: "pending" | "in_progress" | "completed" | "failed";

    if (macroscopeCheck.status === "completed") {
      status = "completed";
    } else if (macroscopeCheck.status === "in_progress") {
      status = "in_progress";
    } else if (macroscopeCheck.status === "queued") {
      status = "pending";
    } else {
      status = "pending";
    }

    // 5. If completed, fetch Macroscope comments to count bugs
    let bugsFound = 0;
    let comments: MacroscopeComment[] = [];

    if (status === "completed") {
      try {
        const { data: prComments } = await octokit.rest.pulls.listReviewComments({
          owner,
          repo,
          pull_number: prNumber,
          per_page: 100,
        });

        // Filter for Macroscope bot comments that indicate bugs
        // Macroscope bot username could be 'macroscopeapp' or similar
        // Bug comments typically contain indicators like emoji or specific phrases
        const macroscopeComments = prComments.filter(
          (comment) =>
            comment.user?.login?.toLowerCase().includes("macroscope") &&
            // Bug indicators - Macroscope uses specific patterns
            (comment.body.includes("🎯") ||
              comment.body.toLowerCase().includes("bug") ||
              comment.body.toLowerCase().includes("issue") ||
              comment.body.toLowerCase().includes("want me to fix"))
        );

        bugsFound = macroscopeComments.length;
        comments = macroscopeComments.map((c) => ({
          id: c.id,
          body: c.body,
          path: c.path,
          line: c.line || c.original_line || null,
          createdAt: c.created_at,
        }));
      } catch (commentError) {
        console.error(`Failed to fetch comments for ${owner}/${repo}#${prNumber}:`, commentError);
        // Continue with 0 bugs if comments fetch fails
      }
    }

    return {
      status,
      conclusion: macroscopeCheck.conclusion as MacroscopeCheckStatus["conclusion"],
      startedAt: macroscopeCheck.started_at || null,
      completedAt: macroscopeCheck.completed_at || null,
      bugsFound,
      comments,
    };
  } catch (error) {
    console.error(`Failed to check Macroscope status for ${owner}/${repo}#${prNumber}:`, error);
    return {
      status: "failed",
      bugsFound: 0,
      comments: [],
    };
  }
}

/**
 * Parse a GitHub PR URL to extract owner, repo, and PR number.
 */
export function parsePRUrl(url: string): { owner: string; repo: string; prNumber: number } | null {
  const match = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (!match) return null;
  return {
    owner: match[1],
    repo: match[2],
    prNumber: parseInt(match[3], 10),
  };
}
