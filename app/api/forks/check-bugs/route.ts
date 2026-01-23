import { NextRequest, NextResponse } from "next/server";
import { Octokit } from "@octokit/rest";
import { config, GITHUB_ORG } from "@/lib/config";
import { getFork, getPR, updatePRBugCount } from "@/lib/services/database";

// POST - Check bug count for a single PR
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const githubToken = config.githubToken;
    if (!githubToken) {
      return NextResponse.json(
        { success: false, error: "GitHub bot token not configured" },
        { status: 500 }
      );
    }

    const octokit = new Octokit({ auth: githubToken });
    const orgOwner = GITHUB_ORG;

    const body = await request.json();
    const { repoName, prNumber } = body as {
      repoName: string;
      prNumber: number;
    };

    if (!repoName || !prNumber) {
      return NextResponse.json(
        { success: false, error: "Missing repoName or prNumber" },
        { status: 400 }
      );
    }

    // Fetch review comments for this PR (comments on specific lines of code)
    const { data: reviewComments } = await octokit.pulls.listReviewComments({
      owner: orgOwner,
      repo: repoName,
      pull_number: prNumber,
      per_page: 100,
    });

    // Get unique usernames who commented (for debugging)
    const commentUsers = [...new Set(reviewComments.map((c) => c.user?.login).filter(Boolean))];

    // Count review comments from Macroscope - each one represents a bug
    const macroscopeComments = reviewComments.filter(
      (comment) => comment.user?.login === "macroscopeapp[bot]"
    );

    const bugCount = macroscopeComments.length;

    // Save bug count to database with timestamp
    try {
      const fork = getFork(orgOwner, repoName);
      if (fork) {
        const pr = getPR(fork.id, prNumber);
        if (pr) {
          updatePRBugCount(pr.id, bugCount);
        }
      }
    } catch (dbError) {
      console.error("Failed to save bug count to database:", dbError);
      // Continue anyway - we still have the count
    }

    return NextResponse.json({
      success: true,
      repoName,
      prNumber,
      bugCount,
      debug: {
        totalReviewComments: reviewComments.length,
        commentUsers,
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 }
    );
  }
}
