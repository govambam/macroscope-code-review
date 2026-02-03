import { NextRequest, NextResponse } from "next/server";
import { Octokit } from "@octokit/rest";
import { config } from "@/lib/config";

export interface DiscoveredPR {
  number: number;
  title: string;
  url: string;
  state: "open" | "closed";
  created_at: string;
  updated_at: string;
  user: {
    login: string;
    avatar_url: string;
  };
  additions: number;
  deletions: number;
  changed_files: number;
  comments: number;
  score: number;
  scoreBreakdown: {
    size: number;
    files: number;
    activity: number;
    recency: number;
  };
}

/**
 * POST /api/prospector/discover-prs
 *
 * Lightweight PR discovery using a SINGLE GitHub API call.
 * Scores PRs using only data available in the pulls.list response.
 * No separate calls for commits, file details, or metrics.
 *
 * Body: { owner: string, repo: string }
 */
export async function POST(request: NextRequest) {
  try {
    const githubToken = config.githubToken;
    if (!githubToken) {
      return NextResponse.json(
        { success: false, error: "GITHUB_BOT_TOKEN is not configured" },
        { status: 500 }
      );
    }

    const body = await request.json();
    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { success: false, error: "Request body must be a JSON object" },
        { status: 400 }
      );
    }
    const { owner, repo } = body;

    if (!owner || !repo) {
      return NextResponse.json(
        { success: false, error: "owner and repo are required" },
        { status: 400 }
      );
    }

    const octokit = new Octokit({ auth: githubToken });

    // Single API call - fetch recent PRs (open + recently closed)
    const { data: prs } = await octokit.pulls.list({
      owner,
      repo,
      state: "all",
      sort: "updated",
      direction: "desc",
      per_page: 50,
    });

    // Filter to PRs updated within the last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const recentPRs = prs.filter(
      (pr) => new Date(pr.updated_at) > thirtyDaysAgo
    );

    // Score each PR using ONLY data from the list response.
    // The GitHub API returns additions/deletions/changed_files/comments
    // in pulls.list but Octokit's types don't include them.
    const scoredPRs: DiscoveredPR[] = recentPRs.map((pr) => {
      const prAny = pr as typeof pr & { additions?: number; deletions?: number; changed_files?: number; comments?: number };
      const additions = prAny.additions ?? 0;
      const deletions = prAny.deletions ?? 0;
      const changedFiles = prAny.changed_files ?? 0;
      const comments = prAny.comments ?? 0;

      const sizeScore = Math.min(100, (additions + deletions) / 10);
      const filesScore = Math.min(100, changedFiles * 5);
      const activityScore = Math.min(100, comments * 10);

      const daysOld =
        (Date.now() - new Date(pr.created_at).getTime()) /
        (1000 * 60 * 60 * 24);
      const recencyScore = Math.max(0, 100 - daysOld * (100 / 30));

      const score = Math.round(
        sizeScore * 0.3 +
          filesScore * 0.2 +
          activityScore * 0.2 +
          recencyScore * 0.3
      );

      return {
        number: pr.number,
        title: pr.title,
        url: pr.html_url,
        state: pr.state as "open" | "closed",
        created_at: pr.created_at,
        updated_at: pr.updated_at,
        user: {
          login: pr.user?.login ?? "unknown",
          avatar_url: pr.user?.avatar_url ?? "",
        },
        additions,
        deletions,
        changed_files: changedFiles,
        comments,
        score,
        scoreBreakdown: {
          size: Math.round(sizeScore),
          files: Math.round(filesScore),
          activity: Math.round(activityScore),
          recency: Math.round(recencyScore),
        },
      };
    });

    scoredPRs.sort((a, b) => b.score - a.score);

    return NextResponse.json({
      success: true,
      prs: scoredPRs,
      repo: { owner, name: repo, fullName: `${owner}/${repo}` },
      totalCount: scoredPRs.length,
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";

    if (errorMessage.includes("Not Found")) {
      return NextResponse.json(
        {
          success: false,
          error: "Repository not found. Check the owner/repo name.",
        },
        { status: 404 }
      );
    }

    if (errorMessage.includes("rate limit")) {
      return NextResponse.json(
        {
          success: false,
          error: "GitHub API rate limit reached. Please try again later.",
        },
        { status: 429 }
      );
    }

    console.error("Prospector discover PRs error:", error);
    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 }
    );
  }
}
