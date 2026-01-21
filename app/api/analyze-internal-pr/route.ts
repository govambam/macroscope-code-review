import { NextRequest, NextResponse } from "next/server";
import { Octokit } from "@octokit/rest";
import {
  saveFork,
  savePR,
  saveAnalysis,
  getFork,
  getPR,
  getAnalysis,
} from "@/lib/services/database";
import { analyzePR } from "@/lib/services/pr-analyzer";

interface AnalyzeInternalPRRequest {
  prUrl: string;
}

// Parse GitHub PR URL to extract owner, repo, and PR number
function parsePrUrl(url: string): { owner: string; repo: string; prNumber: number } | null {
  const match = url.match(/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/);
  if (!match) return null;
  return { owner: match[1], repo: match[2], prNumber: parseInt(match[3], 10) };
}

// Macroscope bot username
const MACROSCOPE_BOT_USERNAME = "macroscopeapp[bot]";

/**
 * POST /api/analyze-internal-pr
 * Analyzes an internal PR that already has Macroscope reviews.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json() as AnalyzeInternalPRRequest;
    const { prUrl } = body;

    // Validate PR URL
    if (!prUrl || typeof prUrl !== "string") {
      return NextResponse.json(
        { success: false, error: "PR URL is required" },
        { status: 400 }
      );
    }

    const parsed = parsePrUrl(prUrl);
    if (!parsed) {
      return NextResponse.json(
        { success: false, error: "Invalid GitHub PR URL format. Expected: https://github.com/owner/repo/pull/123" },
        { status: 400 }
      );
    }

    const { owner, repo, prNumber } = parsed;

    // Check for GitHub token
    const githubToken = process.env.GITHUB_TOKEN;
    if (!githubToken) {
      return NextResponse.json(
        { success: false, error: "GitHub token not configured" },
        { status: 500 }
      );
    }

    const octokit = new Octokit({ auth: githubToken });

    // Fetch PR details from GitHub
    let prData;
    try {
      const { data } = await octokit.pulls.get({
        owner,
        repo,
        pull_number: prNumber,
      });
      prData = data;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes("Not Found")) {
        return NextResponse.json(
          { success: false, error: `PR #${prNumber} not found in ${owner}/${repo}. Please check the URL.` },
          { status: 404 }
        );
      }
      throw error;
    }

    // Fetch review comments from the PR
    let reviewComments;
    try {
      const { data } = await octokit.pulls.listReviewComments({
        owner,
        repo,
        pull_number: prNumber,
        per_page: 100,
      });
      reviewComments = data;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return NextResponse.json(
        { success: false, error: `Failed to fetch review comments: ${errorMessage}` },
        { status: 500 }
      );
    }

    // Filter for Macroscope comments
    const macroscopeComments = reviewComments.filter(
      (comment) => comment.user?.login === MACROSCOPE_BOT_USERNAME
    );

    if (macroscopeComments.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: "No Macroscope review found on this PR. Please ensure the Macroscope GitHub app is installed on this repository and has reviewed this PR.",
          noMacroscopeReview: true
        },
        { status: 400 }
      );
    }

    // Check if we already have this repo/PR in the database
    let existingFork = getFork(owner, repo);
    let forkId: number;

    if (existingFork) {
      forkId = existingFork.id;
    } else {
      // Create a new "fork" record for this internal repo
      const repoUrl = `https://github.com/${owner}/${repo}`;
      forkId = saveFork(owner, repo, repoUrl, true); // isInternal = true
    }

    // Check if PR already exists in database
    let existingPR = getPR(forkId, prNumber);
    let prId: number;

    if (existingPR) {
      prId = existingPR.id;

      // Check if we already have an analysis
      const existingAnalysis = getAnalysis(prId);
      if (existingAnalysis) {
        // Return cached analysis - wrap in 'result' to match analyze-pr format
        const analysisData = JSON.parse(existingAnalysis.analysis_json);
        return NextResponse.json({
          success: true,
          cached: true,
          result: analysisData,
          analysisId: existingAnalysis.id,
          prId,
          prTitle: prData.title,
          forkedPrUrl: prUrl,
          originalPrUrl: prUrl,
          repoName: repo,
          repoOwner: owner,
          isInternal: true,
          macroscopeBugCount: macroscopeComments.length,
        });
      }
    } else {
      // Create PR record
      prId = savePR(
        forkId,
        prNumber,
        prData.title,
        prUrl, // For internal PRs, forked_pr_url is the same as original_pr_url
        prUrl,
        macroscopeComments.length > 0,
        macroscopeComments.length,
        {
          originalPrTitle: prData.title,
          state: prData.state,
          commitCount: prData.commits,
          updateBugCheckTime: true,
          isInternal: true,
        }
      );
    }

    // Run the analysis using the existing PR analyzer
    // For internal PRs, we pass the PR URL as the forkedPrUrl since it's the actual PR
    const analysisResult = await analyzePR({
      forkedPrUrl: prUrl,
      originalPrUrl: prUrl,
    });

    // Save the analysis
    const analysisId = saveAnalysis(prId, analysisResult.meaningful_bugs_found, JSON.stringify(analysisResult));

    // Update PR with bug count
    savePR(
      forkId,
      prNumber,
      prData.title,
      prUrl,
      prUrl,
      macroscopeComments.length > 0,
      macroscopeComments.length,
      {
        originalPrTitle: prData.title,
        state: prData.state,
        commitCount: prData.commits,
        updateBugCheckTime: true,
        isInternal: true,
      }
    );

    return NextResponse.json({
      success: true,
      cached: false,
      result: analysisResult,
      analysisId,
      prId,
      prTitle: prData.title,
      forkedPrUrl: prUrl,
      originalPrUrl: prUrl,
      repoName: repo,
      repoOwner: owner,
      isInternal: true,
      macroscopeBugCount: macroscopeComments.length,
    });
  } catch (error) {
    console.error("Error analyzing internal PR:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 }
    );
  }
}
