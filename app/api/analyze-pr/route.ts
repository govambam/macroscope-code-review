import { NextRequest, NextResponse } from "next/server";
import { Octokit } from "@octokit/rest";
import {
  analyzePR,
  extractOriginalPRUrl,
  PRAnalysisResult,
} from "@/lib/services/pr-analyzer";
import {
  getAnalysisByPRUrl,
  saveAnalysis,
  saveFork,
  savePR,
  getPRByUrl,
  getEmailsForAnalysis,
  getLatestPromptVersion,
  updatePROriginalUrl,
} from "@/lib/services/database";
import {
  getCachedAnalysis,
  setCachedAnalysis,
  invalidateForksCache,
} from "@/lib/services/redis";
import { DEFAULT_MODEL } from "@/lib/config/models";
import { getGitHubToken, getAnthropicApiKey } from "@/lib/config/api-keys";

interface AnalyzeRequest {
  forkedPrUrl: string;
  originalPrUrl?: string; // Optional - will try to extract from PR body if not provided
  forceRefresh?: boolean; // Force re-analysis even if cached
  createdByUser?: string; // User ID of who triggered the analysis
}

interface AnalyzeResponse {
  success: boolean;
  result?: PRAnalysisResult;
  error?: string;
  forkedPrUrl?: string;
  originalPrUrl?: string;
  originalPrTitle?: string; // Title of the original PR
  cached?: boolean; // Whether the result was loaded from cache
  analysisId?: number; // Database ID of the analysis
  cachedEmail?: string; // Previously generated email content
  analysisModel?: string; // Model used for analysis
  emailModel?: string; // Model used for email generation
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
    // Check for required API keys (from database settings or environment variables)
    const anthropicKey = await getAnthropicApiKey();
    if (!anthropicKey) {
      return NextResponse.json<AnalyzeResponse>(
        {
          success: false,
          error:
            "ANTHROPIC_API_KEY is not configured. Please configure it in Settings or add it to your .env.local file.",
        },
        { status: 500 }
      );
    }

    const body: AnalyzeRequest = await request.json();
    const { forkedPrUrl, forceRefresh, createdByUser } = body;
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
      // Check Redis cache first (fastest)
      const redisCached = await getCachedAnalysis<AnalyzeResponse>(forkedPrUrl);
      if (redisCached) {
        return NextResponse.json<AnalyzeResponse>({
          ...redisCached,
          cached: true,
        });
      }

      // Fall back to database cache
      try {
        const cachedAnalysis = await getAnalysisByPRUrl(forkedPrUrl);
        if (cachedAnalysis) {
          const result = JSON.parse(cachedAnalysis.analysis_json) as PRAnalysisResult;

          // Get the stored PR record to retrieve originalPrUrl
          const prRecord = await getPRByUrl(forkedPrUrl);
          const storedOriginalUrl = prRecord?.original_pr_url || originalPrUrl;

          // Fetch original PR title from GitHub (quick call, needed for email)
          let originalPrTitle: string | undefined;
          if (storedOriginalUrl) {
            const parsedOriginal = parsePrUrl(storedOriginalUrl);
            if (parsedOriginal) {
              try {
                const githubToken = await getGitHubToken();
                if (githubToken) {
                  const octokit = new Octokit({ auth: githubToken });
                  const { data: originalPr } = await octokit.pulls.get({
                    owner: parsedOriginal.owner,
                    repo: parsedOriginal.repo,
                    pull_number: parsedOriginal.prNumber,
                  });
                  originalPrTitle = originalPr.title;
                }
              } catch {
                // Continue without title
              }
            }
          }

          // Get any previously generated email for this analysis
          let cachedEmail: string | undefined;
          let emailModel: string | undefined;
          try {
            const emails = await getEmailsForAnalysis(cachedAnalysis.id);
            if (emails.length > 0) {
              // Return the most recent email
              cachedEmail = emails[0].email_content;
              emailModel = emails[0].model || undefined;
            }
          } catch {
            // Continue without cached email
          }

          const response: AnalyzeResponse = {
            success: true,
            result,
            forkedPrUrl,
            originalPrUrl: storedOriginalUrl,
            originalPrTitle,
            cached: true,
            analysisId: cachedAnalysis.id,
            cachedEmail,
            analysisModel: cachedAnalysis.model || undefined,
            emailModel,
          };

          // Cache in Redis for faster future access
          await setCachedAnalysis(forkedPrUrl, response);

          return NextResponse.json<AnalyzeResponse>(response);
        }
      } catch (dbError) {
        console.error("Failed to check for cached analysis:", dbError);
        // Continue with fresh analysis
      }
    }

    // No cached result - need to fetch from GitHub and run analysis
    const githubToken = await getGitHubToken();
    if (!githubToken) {
      return NextResponse.json<AnalyzeResponse>(
        {
          success: false,
          error: "GITHUB_TOKEN is not configured. Please configure it in Settings or add it to your .env.local file.",
        },
        { status: 500 }
      );
    }

    const octokit = new Octokit({ auth: githubToken });

    // Fetch the forked PR to extract the original PR URL from the description
    // Format in PR body: "Original PR: https://github.com/owner/repo/pull/123 by @user"
    if (!originalPrUrl) {
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

        if (!originalPrUrl) {
          return NextResponse.json<AnalyzeResponse>(
            {
              success: false,
              error:
                "Could not extract original PR URL from the forked PR description.",
            },
            { status: 400 }
          );
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

    // Fetch the original PR title from GitHub
    let originalPrTitle: string | undefined;
    try {
      const { data: originalPr } = await octokit.pulls.get({
        owner: parsedOriginalPr.owner,
        repo: parsedOriginalPr.repo,
        pull_number: parsedOriginalPr.prNumber,
      });
      originalPrTitle = originalPr.title;
    } catch (error) {
      console.error("Failed to fetch original PR title:", error);
      // Continue without the title - email generation will use a default
    }

    // Get the model from prompt settings
    let analysisModel = DEFAULT_MODEL;
    try {
      const promptVersion = await getLatestPromptVersion("pr-analysis");
      if (promptVersion?.model) {
        analysisModel = promptVersion.model;
      }
    } catch {
      // Use default model if settings can't be fetched
    }

    // Perform the analysis
    const result = await analyzePR({
      forkedPrUrl,
      originalPrUrl,
      model: analysisModel,
    });

    // Save the analysis to the database
    let analysisId: number | undefined;
    try {
      // Ensure PR exists in database
      let prId: number;
      const existingPR = await getPRByUrl(forkedPrUrl);
      if (existingPR) {
        prId = existingPR.id;
        // Update the original PR URL if it wasn't stored before
        if (!existingPR.original_pr_url && originalPrUrl) {
          await updatePROriginalUrl(prId, originalPrUrl);
        }
      } else {
        // Create fork and PR records
        const forkId = await saveFork(
          parsedForkedPr.owner,
          parsedForkedPr.repo,
          `https://github.com/${parsedForkedPr.owner}/${parsedForkedPr.repo}`
        );
        prId = await savePR(
          forkId,
          parsedForkedPr.prNumber,
          null, // title not known
          forkedPrUrl,
          originalPrUrl,
          result.meaningful_bugs_found,
          result.meaningful_bugs_found ? result.total_macroscope_bugs_found : 0
        );
      }

      // Save the analysis with the model used
      analysisId = await saveAnalysis(
        prId,
        result.meaningful_bugs_found,
        JSON.stringify(result),
        createdByUser,
        analysisModel
      );
    } catch (dbError) {
      console.error("Failed to save analysis to database:", dbError);
      // Continue anyway - the analysis was still successful
    }

    const response: AnalyzeResponse = {
      success: true,
      result,
      forkedPrUrl,
      originalPrUrl,
      originalPrTitle,
      cached: false,
      analysisId,
      analysisModel,
    };

    // Cache in Redis for faster future access
    await setCachedAnalysis(forkedPrUrl, response);

    // Invalidate forks cache since analysis status changed
    await invalidateForksCache("default");

    return NextResponse.json<AnalyzeResponse>(response);
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
