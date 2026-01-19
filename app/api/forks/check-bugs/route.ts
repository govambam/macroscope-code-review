import { NextRequest, NextResponse } from "next/server";
import { Octokit } from "@octokit/rest";
import { getCachedPRBugs, setCachedPRBugs } from "@/lib/services/redis";
import { getGitHubToken } from "@/lib/config/api-keys";

// POST - Check bug count for a single PR
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
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

    // Check Redis cache first
    const cachedBugCount = await getCachedPRBugs(repoName, prNumber);
    if (cachedBugCount !== null) {
      return NextResponse.json({
        success: true,
        repoName,
        prNumber,
        bugCount: cachedBugCount,
        cached: true,
      });
    }

    const githubToken = await getGitHubToken();
    if (!githubToken) {
      return NextResponse.json(
        { success: false, error: "GitHub token not configured. Please configure it in Settings." },
        { status: 500 }
      );
    }

    const octokit = new Octokit({ auth: githubToken });
    const { data: user } = await octokit.users.getAuthenticated();

    // Fetch review comments for this PR (comments on specific lines of code)
    const { data: reviewComments } = await octokit.pulls.listReviewComments({
      owner: user.login,
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

    // Cache the result in Redis
    await setCachedPRBugs(repoName, prNumber, bugCount);

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
