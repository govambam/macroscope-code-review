import { NextRequest, NextResponse } from "next/server";
import { Octokit } from "@octokit/rest";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { config } from "@/lib/config";
import {
  analyzePR,
  extractOriginalPRUrl,
  PRAnalysisResult,
  isV2AnalysisResult,
  hasMeaningfulBugs,
  PRAnalysisResultV2,
} from "@/lib/services/pr-analyzer";
import {
  getAnalysisByPRUrl,
  saveAnalysis,
  saveFork,
  savePR,
  getPRByUrl,
  getEmailsForAnalysis,
  updatePROriginalInfo,
  updatePRBugCount,
} from "@/lib/services/database";

interface AnalyzeRequest {
  forkedPrUrl: string;
  originalPrUrl?: string; // Optional - will try to extract from PR body if not provided
  forceRefresh?: boolean; // Force re-analysis even if cached
}

interface AnalyzeResponse {
  success: boolean;
  result?: PRAnalysisResult;
  error?: string;
  forkedPrUrl?: string;
  originalPrUrl?: string;
  originalPrTitle?: string; // Title of the original PR
  originalPrState?: "open" | "merged" | "closed"; // State of the original PR
  originalPrMergedAt?: string | null; // ISO timestamp if merged
  cached?: boolean; // Whether the result was loaded from cache
  analysisId?: number; // Database ID of the analysis
  cachedEmail?: string; // Previously generated email content
  needsOriginalPrUrl?: boolean; // If true, client should prompt user for the original PR URL
}

/**
 * Parses a GitHub PR URL to extract owner, repo, and PR number.
 */
function parsePrUrl(
  url: string
): { owner: string; repo: string; prNumber: number } | null {
  const match = url.match(/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/);
  if (!match) return null;
  return { owner: match[1], repo: match[2], prNumber: parseInt(match[3], 10) };
}

/**
 * POST /api/analyze-pr
 *
 * Analyzes a PR to determine if Macroscope found meaningful bugs.
 *
 * Request body:
 * - forkedPrUrl: The URL of the forked PR (with Macroscope comments)
 * - originalPrUrl: (optional) The URL of the original PR
 *
 * If originalPrUrl is not provided, it will be extracted from the forked PR body.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // Get the current user from session
    const session = await getServerSession(authOptions);
    const createdBy = session?.user?.login || null;

    // Check for required environment variables
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json<AnalyzeResponse>(
        {
          success: false,
          error:
            "ANTHROPIC_API_KEY is not configured. Please add it to your .env.local file.",
        },
        { status: 500 }
      );
    }

    const body: AnalyzeRequest = await request.json();
    const { forkedPrUrl, forceRefresh } = body;
    let { originalPrUrl } = body;

    // Validate forked PR URL
    if (!forkedPrUrl) {
      return NextResponse.json<AnalyzeResponse>(
        { success: false, error: "forkedPrUrl is required" },
        { status: 400 }
      );
    }

    const parsedForkedPr = parsePrUrl(forkedPrUrl);
    if (!parsedForkedPr) {
      return NextResponse.json<AnalyzeResponse>(
        {
          success: false,
          error:
            "Invalid forkedPrUrl format. Expected: https://github.com/owner/repo/pull/123",
        },
        { status: 400 }
      );
    }

    // CHECK CACHE FIRST - before any GitHub API calls
    // This ensures "View Analysis" returns instantly for cached results
    if (!forceRefresh) {
      try {
        const cachedAnalysis = getAnalysisByPRUrl(forkedPrUrl);
        if (cachedAnalysis) {
          const result = JSON.parse(cachedAnalysis.analysis_json) as PRAnalysisResult;

          // Get the stored PR record to retrieve originalPrUrl, originalPrTitle, and state
          const prRecord = getPRByUrl(forkedPrUrl);
          const storedOriginalUrl = prRecord?.original_pr_url || originalPrUrl;
          // Use stored values - no GitHub API call needed!
          const originalPrTitle = prRecord?.original_pr_title || undefined;
          const originalPrState = (prRecord?.original_pr_state as "open" | "merged" | "closed") || undefined;
          const originalPrMergedAt = prRecord?.original_pr_merged_at || undefined;

          // Get any previously generated email for this analysis
          let cachedEmail: string | undefined;
          try {
            const emails = getEmailsForAnalysis(cachedAnalysis.id);
            if (emails.length > 0) {
              // Return the most recent email
              cachedEmail = emails[0].email_content;
            }
          } catch {
            // Continue without cached email
          }

          return NextResponse.json<AnalyzeResponse>({
            success: true,
            result,
            forkedPrUrl,
            originalPrUrl: storedOriginalUrl,
            originalPrTitle,
            originalPrState,
            originalPrMergedAt,
            cached: true,
            analysisId: cachedAnalysis.id,
            cachedEmail,
          });
        }
      } catch (dbError) {
        console.error("Failed to check for cached analysis:", dbError);
        // Continue with fresh analysis
      }
    }

    // No cached result - need to fetch from GitHub and run analysis
    const githubToken = config.githubToken;
    if (!githubToken) {
      return NextResponse.json<AnalyzeResponse>(
        {
          success: false,
          error: "GITHUB_BOT_TOKEN is not configured. Required to fetch PR details.",
        },
        { status: 500 }
      );
    }

    const octokit = new Octokit({ auth: githubToken });

    // Try to get original PR URL from multiple sources:
    // 1. Request body (already provided)
    // 2. Database (stored from previous simulation/analysis)
    // 3. PR body description (extracted via regex)
    if (!originalPrUrl) {
      // First, check database for stored original_pr_url
      try {
        const prRecord = getPRByUrl(forkedPrUrl);
        if (prRecord?.original_pr_url) {
          originalPrUrl = prRecord.original_pr_url;
        }
      } catch {
        // Continue to try other sources
      }
    }

    if (!originalPrUrl) {
      // Try to extract from PR body description
      try {
        const { data: forkedPr } = await octokit.pulls.get({
          owner: parsedForkedPr.owner,
          repo: parsedForkedPr.repo,
          pull_number: parsedForkedPr.prNumber,
        });

        // Extract original PR URL from the PR body
        if (forkedPr.body) {
          const extractedUrl = extractOriginalPRUrl(forkedPr.body);
          if (extractedUrl) {
            originalPrUrl = extractedUrl;
          }
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        return NextResponse.json<AnalyzeResponse>(
          {
            success: false,
            error: `Failed to fetch forked PR details: ${errorMessage}`,
          },
          { status: 500 }
        );
      }
    }

    // If we still don't have the original PR URL, ask the client to provide it
    if (!originalPrUrl) {
      return NextResponse.json<AnalyzeResponse>(
        {
          success: false,
          needsOriginalPrUrl: true,
          forkedPrUrl,
          error:
            "Could not determine the original PR URL. Please provide it manually.",
        },
        { status: 200 } // Use 200 since this is a recoverable situation
      );
    }

    // Validate original PR URL
    const parsedOriginalPr = parsePrUrl(originalPrUrl);
    if (!parsedOriginalPr) {
      return NextResponse.json<AnalyzeResponse>(
        {
          success: false,
          error:
            "Invalid originalPrUrl format. Expected: https://github.com/owner/repo/pull/123",
        },
        { status: 400 }
      );
    }

    // Fetch the original PR details from GitHub (title, state, merged_at)
    let originalPrTitle: string | undefined;
    let originalPrState: "open" | "merged" | "closed" = "open";
    let originalPrMergedAt: string | null = null;
    try {
      const { data: originalPr } = await octokit.pulls.get({
        owner: parsedOriginalPr.owner,
        repo: parsedOriginalPr.repo,
        pull_number: parsedOriginalPr.prNumber,
      });
      originalPrTitle = originalPr.title;
      // Determine PR state: merged takes precedence over closed
      if (originalPr.merged) {
        originalPrState = "merged";
        originalPrMergedAt = originalPr.merged_at;
      } else if (originalPr.state === "closed") {
        originalPrState = "closed";
      } else {
        originalPrState = "open";
      }
    } catch (error) {
      console.error("Failed to fetch original PR details:", error);
      // Continue without the details - email generation will use defaults
    }

    // Perform the analysis
    const result = await analyzePR({
      forkedPrUrl,
      originalPrUrl,
    });

    // Save the analysis to the database
    let analysisId: number | undefined;
    try {
      // Ensure PR exists in database
      let prId: number;
      const existingPR = getPRByUrl(forkedPrUrl);
      if (existingPR) {
        prId = existingPR.id;
        // Update original PR info if we have it
        if (originalPrUrl) {
          updatePROriginalInfo(prId, originalPrUrl, originalPrTitle || null, originalPrState, originalPrMergedAt);
        }
        // Update bug count for existing PR
        let bugCount = 0;
        if (isV2AnalysisResult(result)) {
          bugCount = result.meaningful_bugs_count;
        } else if (result.meaningful_bugs_found) {
          bugCount = result.total_macroscope_bugs_found;
        }
        updatePRBugCount(prId, bugCount);
      } else {
        // Create fork and PR records
        const forkId = saveFork(
          parsedForkedPr.owner,
          parsedForkedPr.repo,
          `https://github.com/${parsedForkedPr.owner}/${parsedForkedPr.repo}`
        );

        // Determine bug count based on format
        let bugCount = 0;
        if (isV2AnalysisResult(result)) {
          bugCount = result.meaningful_bugs_count;
        } else if (result.meaningful_bugs_found) {
          bugCount = result.total_macroscope_bugs_found;
        }

        prId = savePR(
          forkId,
          parsedForkedPr.prNumber,
          null, // title not known
          forkedPrUrl,
          originalPrUrl,
          hasMeaningfulBugs(result),
          bugCount,
          {
            originalPrTitle: originalPrTitle || null,
            originalPrState,
            originalPrMergedAt,
            createdBy,
          }
        );
      }

      // Save the analysis with appropriate fields based on format
      if (isV2AnalysisResult(result)) {
        // New format (V2) - save all the new fields
        analysisId = saveAnalysis(
          prId,
          result.meaningful_bugs_count > 0, // meaningful_bugs_found
          JSON.stringify(result),
          {
            totalCommentsProcessed: result.total_comments_processed,
            meaningfulBugsCount: result.meaningful_bugs_count,
            outreachReadyCount: result.outreach_ready_count,
            bestBugIndex: result.best_bug_for_outreach_index,
            summaryJson: JSON.stringify(result.summary),
            schemaVersion: 2,
          }
        );
      } else {
        // Old format (V1) - save as before
        analysisId = saveAnalysis(
          prId,
          result.meaningful_bugs_found,
          JSON.stringify(result),
          {
            schemaVersion: 1,
          }
        );
      }
    } catch (dbError) {
      console.error("Failed to save analysis to database:", dbError);
      // Continue anyway - the analysis was still successful
    }

    return NextResponse.json<AnalyzeResponse>({
      success: true,
      result,
      forkedPrUrl,
      originalPrUrl,
      originalPrTitle,
      originalPrState,
      originalPrMergedAt,
      cached: false,
      analysisId,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("PR Analysis error:", errorMessage);

    // Check for specific error types
    if (errorMessage.includes("rate limit")) {
      return NextResponse.json<AnalyzeResponse>(
        {
          success: false,
          error: "API rate limit reached. Please try again in a few moments.",
        },
        { status: 429 }
      );
    }

    if (errorMessage.includes("ANTHROPIC_API_KEY")) {
      return NextResponse.json<AnalyzeResponse>(
        { success: false, error: errorMessage },
        { status: 500 }
      );
    }

    return NextResponse.json<AnalyzeResponse>(
      { success: false, error: `Analysis failed: ${errorMessage}` },
      { status: 500 }
    );
  }
}
