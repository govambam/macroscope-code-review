import { NextRequest, NextResponse } from "next/server";
import { Octokit } from "@octokit/rest";
import { config, GITHUB_ORG } from "@/lib/config";
import { getFork, getPRsForFork } from "@/lib/services/database";

export interface ExistingPR {
  id: number;
  prNumber: number;
  title: string | null;
  originalPrUrl: string | null;
  originalPrTitle: string | null;
  forkedPrUrl: string;
  createdAt: string;
  hasMacroscopeBugs: boolean;
  bugCount: number | null;
  hasAnalysis: boolean;
  state: string | null;
}

export interface CheckForkResponse {
  success: boolean;
  hasFork: boolean;
  forkOwner?: string;
  forkRepo?: string;
  forkUrl?: string;
  existingPRs?: ExistingPR[];
  error?: string;
}

/**
 * POST /api/prospector/check-fork
 *
 * Checks if the macroscope-gtm org has a fork of the given repo.
 * If so, returns existing simulated PRs from our database.
 *
 * Body: { owner: string, repo: string }
 */
export async function POST(request: NextRequest) {
  try {
    const githubToken = config.githubToken;
    if (!githubToken) {
      return NextResponse.json(
        { success: false, hasFork: false, error: "GITHUB_BOT_TOKEN is not configured" },
        { status: 500 }
      );
    }

    const body = await request.json();
    const { owner, repo } = body;

    if (!owner || !repo) {
      return NextResponse.json(
        { success: false, hasFork: false, error: "owner and repo are required" },
        { status: 400 }
      );
    }

    const forkOwner = GITHUB_ORG;
    const octokit = new Octokit({ auth: githubToken });

    try {
      // Single API call: check if the org has a repo with the same name
      const { data: repoData } = await octokit.repos.get({
        owner: forkOwner,
        repo,
      });

      // Verify it's actually a fork of the target repo
      if (repoData.fork && repoData.parent?.full_name === `${owner}/${repo}`) {
        // Fork exists - get existing PRs from our database
        const dbFork = getFork(forkOwner, repo);
        let existingPRs: ExistingPR[] = [];

        if (dbFork) {
          const prs = getPRsForFork(dbFork.id);
          existingPRs = prs.map((pr) => ({
            id: pr.id,
            prNumber: pr.pr_number,
            title: pr.pr_title,
            originalPrUrl: pr.original_pr_url,
            originalPrTitle: pr.original_pr_title,
            forkedPrUrl: pr.forked_pr_url,
            createdAt: pr.created_at,
            hasMacroscopeBugs: !!pr.has_macroscope_bugs,
            bugCount: pr.bug_count,
            hasAnalysis: !!(pr as unknown as Record<string, unknown>).has_analysis,
            state: pr.state,
          }));
        }

        return NextResponse.json({
          success: true,
          hasFork: true,
          forkOwner,
          forkRepo: repo,
          forkUrl: repoData.html_url,
          existingPRs,
        } satisfies CheckForkResponse);
      }

      // Repo exists in the org but is not a fork of the target
      return NextResponse.json({
        success: true,
        hasFork: false,
      } satisfies CheckForkResponse);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes("Not Found")) {
        return NextResponse.json({
          success: true,
          hasFork: false,
        } satisfies CheckForkResponse);
      }
      throw error;
    }
  } catch (error) {
    console.error("Check fork error:", error);
    return NextResponse.json(
      {
        success: false,
        hasFork: false,
        error: error instanceof Error ? error.message : "Failed to check fork status",
      },
      { status: 500 }
    );
  }
}
