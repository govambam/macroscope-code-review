import { NextRequest, NextResponse } from "next/server";
import { Octokit } from "@octokit/rest";
import {
  syncForksFromGitHub,
  getAllForksWithPRs,
  deleteFork,
  deletePR,
  getFork,
} from "@/lib/services/database";

interface PRRecord {
  prNumber: number;
  prUrl: string;
  prTitle: string;
  createdAt: string;
  updatedAt?: string | null;
  commitCount: number;
  state: string;
  branchName: string;
  macroscopeBugs?: number;
  hasAnalysis?: boolean;
  analysisId?: number | null;
  lastBugCheckAt?: string;
  originalPrUrl?: string | null;
  isInternal?: boolean;
  createdBy?: string | null;
}

interface ForkRecord {
  repoName: string;
  forkUrl: string;
  createdAt: string;
  isInternal?: boolean;
  prs: PRRecord[];
}

interface BugCountResult {
  count: number;
  debug: {
    totalReviewComments: number;
    commentUsers: string[];
  };
}

// Count Macroscope bugs from PR review comments
async function countMacroscopeBugs(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number
): Promise<BugCountResult> {
  try {
    // Get review comments (comments on specific lines of code)
    const { data: reviewComments } = await octokit.pulls.listReviewComments({
      owner,
      repo,
      pull_number: prNumber,
      per_page: 100,
    });

    // Get unique usernames who commented (for debugging)
    const commentUsers = [...new Set(reviewComments.map((c) => c.user?.login).filter(Boolean))] as string[];

    // Count review comments from Macroscope - each one represents a bug
    const macroscopeReviewComments = reviewComments.filter(
      (comment) => comment.user?.login === "macroscopeapp[bot]"
    );

    return {
      count: macroscopeReviewComments.length,
      debug: {
        totalReviewComments: reviewComments.length,
        commentUsers,
      },
    };
  } catch {
    return { count: 0, debug: { totalReviewComments: 0, commentUsers: [] } };
  }
}

// GET - Fetch forks
// Query params:
// - source=db: Load from database only (fast, for initial page load)
// - source=github (default): Fetch from GitHub and sync to database
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const source = searchParams.get("source") || "github";

  // If source=db, just return data from the database (no GitHub API calls)
  if (source === "db") {
    try {
      const dbForks = getAllForksWithPRs();

      // Transform database format to API format
      const forks: ForkRecord[] = dbForks.map(dbFork => ({
        repoName: dbFork.repo_name,
        forkUrl: dbFork.fork_url,
        createdAt: dbFork.created_at,
        isInternal: Boolean(dbFork.is_internal),
        prs: dbFork.prs.map(dbPR => ({
          prNumber: dbPR.pr_number,
          prUrl: dbPR.forked_pr_url,
          prTitle: dbPR.pr_title || `PR #${dbPR.pr_number}`,
          createdAt: dbPR.created_at,
          updatedAt: dbPR.updated_at ?? null,
          commitCount: dbPR.commit_count ?? 0,
          state: dbPR.state || "open",
          branchName: `review-pr-${dbPR.pr_number}`, // Reconstructed from convention
          macroscopeBugs: dbPR.bug_count ?? undefined,
          hasAnalysis: Boolean(dbPR.has_analysis),
          analysisId: dbPR.analysis_id ?? null,
          lastBugCheckAt: dbPR.last_bug_check_at ?? undefined,
          originalPrUrl: dbPR.original_pr_url ?? null,
          isInternal: Boolean(dbPR.is_internal),
          createdBy: dbPR.created_by ?? null,
        })),
      }));

      return NextResponse.json({
        success: true,
        forks,
        source: "database",
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return NextResponse.json(
        { success: false, error: errorMessage },
        { status: 500 }
      );
    }
  }

  // Default: Fetch from GitHub
  try {
    const githubToken = process.env.GITHUB_TOKEN;
    if (!githubToken) {
      return NextResponse.json(
        { success: false, error: "GitHub token not configured" },
        { status: 500 }
      );
    }

    const octokit = new Octokit({ auth: githubToken });

    // Get authenticated user
    const { data: user } = await octokit.users.getAuthenticated();

    // Get all user's repos that are forks
    const { data: repos } = await octokit.repos.listForAuthenticatedUser({
      type: "owner",
      sort: "created",
      direction: "desc",
      per_page: 100,
    });

    const forks = repos.filter((repo) => repo.fork);

    // For each fork, get PRs that look like review PRs
    const forkRecords: ForkRecord[] = [];
    const allDebugInfo: { fork: string; prNumber: number; debug: BugCountResult["debug"] }[] = [];

    for (const fork of forks) {
      try {
        const { data: prs } = await octokit.pulls.list({
          owner: user.login,
          repo: fork.name,
          state: "all",
          per_page: 100,
        });

        // Filter PRs that look like review PRs (branch starts with "review-")
        const reviewPRs = prs.filter(
          (pr) =>
            pr.head.ref.startsWith("review-") ||
            pr.head.ref.startsWith("recreate-")
        );

        if (reviewPRs.length > 0) {
          // Build PR records with bug counts
          const prRecords: PRRecord[] = [];

          for (const pr of reviewPRs) {
            const bugResult = await countMacroscopeBugs(
              octokit,
              user.login,
              fork.name,
              pr.number
            );

            prRecords.push({
              prNumber: pr.number,
              prUrl: pr.html_url,
              prTitle: pr.title,
              createdAt: pr.created_at,
              // Note: commits count not available in list endpoint, would need extra API call
              commitCount: 0,
              state: pr.state,
              branchName: pr.head.ref,
              macroscopeBugs: bugResult.count,
            });

            // Collect debug info for all PRs
            allDebugInfo.push({
              fork: fork.name,
              prNumber: pr.number,
              debug: bugResult.debug
            });
          }

          forkRecords.push({
            repoName: fork.name,
            forkUrl: fork.html_url,
            createdAt: fork.created_at || new Date().toISOString(),
            prs: prRecords,
          });
        }
      } catch {
        // Skip repos we can't access
        continue;
      }
    }

    // Sync to database
    try {
      syncForksFromGitHub(forkRecords);
    } catch (dbError) {
      console.error("Failed to sync to database:", dbError);
      // Continue anyway, GitHub data is the source of truth
    }

    // Get data back from database (includes analysis status)
    const dbForks = getAllForksWithPRs();

    // Merge GitHub data with database analysis status
    const mergedForks: ForkRecord[] = forkRecords.map(ghFork => {
      const dbFork = dbForks.find(f => f.repo_name === ghFork.repoName);
      return {
        ...ghFork,
        isInternal: false,
        prs: ghFork.prs.map(ghPR => {
          const dbPR = dbFork?.prs.find(p => p.pr_number === ghPR.prNumber);
          return {
            ...ghPR,
            updatedAt: dbPR?.updated_at ?? null,
            hasAnalysis: Boolean(dbPR?.has_analysis),
            analysisId: dbPR?.analysis_id ?? null,
            isInternal: false,
          };
        }),
      };
    });

    // Add internal repos from database (not GitHub forks)
    const internalForks = dbForks
      .filter(dbFork => dbFork.is_internal)
      .map(dbFork => ({
        repoName: dbFork.repo_name,
        forkUrl: dbFork.fork_url,
        createdAt: dbFork.created_at,
        isInternal: true,
        prs: dbFork.prs.map(dbPR => ({
          prNumber: dbPR.pr_number,
          prUrl: dbPR.forked_pr_url,
          prTitle: dbPR.pr_title || `PR #${dbPR.pr_number}`,
          createdAt: dbPR.created_at,
          updatedAt: dbPR.updated_at ?? null,
          commitCount: dbPR.commit_count ?? 0,
          state: dbPR.state || "open",
          branchName: `pr-${dbPR.pr_number}`,
          macroscopeBugs: dbPR.bug_count ?? undefined,
          hasAnalysis: Boolean(dbPR.has_analysis),
          analysisId: dbPR.analysis_id ?? null,
          lastBugCheckAt: dbPR.last_bug_check_at ?? undefined,
          originalPrUrl: dbPR.original_pr_url ?? null,
          isInternal: true,
        })),
      }));

    // Combine GitHub forks with internal repos
    const allForks = [...mergedForks, ...internalForks];

    return NextResponse.json({
      success: true,
      forks: allForks,
      username: user.login,
      source: "github",
      debug: allDebugInfo,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 }
    );
  }
}

// DELETE - Delete selected forks and PRs
export async function DELETE(request: NextRequest): Promise<NextResponse> {
  try {
    const githubToken = process.env.GITHUB_TOKEN;
    if (!githubToken) {
      return NextResponse.json(
        { success: false, error: "GitHub token not configured" },
        { status: 500 }
      );
    }

    const octokit = new Octokit({ auth: githubToken });
    const { data: user } = await octokit.users.getAuthenticated();

    const body = await request.json();
    const { repos, prs } = body as {
      repos: string[];
      prs: { repo: string; prNumber: number; branchName: string }[];
    };

    const results: {
      deletedRepos: string[];
      deletedPRs: { repo: string; prNumber: number }[];
      errors: string[];
    } = {
      deletedRepos: [],
      deletedPRs: [],
      errors: [],
    };

    // Delete PRs first (close PR and delete branch)
    for (const pr of prs) {
      try {
        // Close the PR
        await octokit.pulls.update({
          owner: user.login,
          repo: pr.repo,
          pull_number: pr.prNumber,
          state: "closed",
        });

        // Delete the branch
        try {
          await octokit.git.deleteRef({
            owner: user.login,
            repo: pr.repo,
            ref: `heads/${pr.branchName}`,
          });
        } catch {
          // Branch might already be deleted, continue
        }

        results.deletedPRs.push({ repo: pr.repo, prNumber: pr.prNumber });

        // Also delete from database
        try {
          const fork = getFork(user.login, pr.repo);
          if (fork) {
            deletePR(fork.id, pr.prNumber);
          }
        } catch (dbError) {
          console.error("Failed to delete PR from database:", dbError);
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        results.errors.push(`Failed to delete PR #${pr.prNumber} in ${pr.repo}: ${msg}`);
      }
    }

    // Delete entire repos
    for (const repo of repos) {
      try {
        await octokit.repos.delete({
          owner: user.login,
          repo: repo,
        });
        results.deletedRepos.push(repo);

        // Also delete from database
        try {
          deleteFork(user.login, repo);
        } catch (dbError) {
          console.error("Failed to delete fork from database:", dbError);
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        results.errors.push(`Failed to delete repo ${repo}: ${msg}`);
      }
    }

    return NextResponse.json({
      success: true,
      ...results,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 }
    );
  }
}
