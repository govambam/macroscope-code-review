import { NextRequest, NextResponse } from "next/server";
import { Octokit } from "@octokit/rest";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { config } from "@/lib/config";
import {
  fetchMacroscopeComments,
  convertMacroscopeCommentsToV2,
  extractOriginalPRUrl,
  PRAnalysisResult,
  isV2AnalysisResult,
  AnalysisComment,
} from "@/lib/services/pr-analyzer";
import { generateCodeImage, isCodeImageGenerationAvailable } from "@/lib/services/code-image";
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

interface GetMacroscopeReviewRequest {
  forkedPrUrl: string;
  originalPrUrl?: string;
  forceRefresh?: boolean;
}

interface GetMacroscopeReviewResponse {
  success: boolean;
  result?: PRAnalysisResult;
  error?: string;
  forkedPrUrl?: string;
  originalPrUrl?: string;
  originalPrTitle?: string;
  originalPrState?: "open" | "merged" | "closed";
  originalPrMergedAt?: string | null;
  cached?: boolean;
  analysisId?: number;
  cachedEmail?: string;
  needsOriginalPrUrl?: boolean;
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
 * POST /api/get-macroscope-review
 *
 * Fetches Macroscope bot review comments and converts them to analysis format.
 * Does NOT use Claude — displays raw Macroscope comments as the analysis.
 * Generates code fix images for comments with code suggestions.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await getServerSession(authOptions);
    const createdBy = session?.user?.login || null;

    const body: GetMacroscopeReviewRequest = await request.json();
    const { forkedPrUrl, forceRefresh } = body;
    let { originalPrUrl } = body;

    if (!forkedPrUrl) {
      return NextResponse.json<GetMacroscopeReviewResponse>(
        { success: false, error: "forkedPrUrl is required" },
        { status: 400 }
      );
    }

    const parsedForkedPr = parsePrUrl(forkedPrUrl);
    if (!parsedForkedPr) {
      return NextResponse.json<GetMacroscopeReviewResponse>(
        {
          success: false,
          error: "Invalid forkedPrUrl format. Expected: https://github.com/owner/repo/pull/123",
        },
        { status: 400 }
      );
    }

    // CHECK CACHE FIRST
    if (!forceRefresh) {
      try {
        const cachedAnalysis = getAnalysisByPRUrl(forkedPrUrl);
        if (cachedAnalysis) {
          const result = JSON.parse(cachedAnalysis.analysis_json) as PRAnalysisResult;
          const prRecord = getPRByUrl(forkedPrUrl);
          const storedOriginalUrl = prRecord?.original_pr_url || originalPrUrl;
          const originalPrTitle = prRecord?.original_pr_title || undefined;
          const originalPrState = (prRecord?.original_pr_state as "open" | "merged" | "closed") || undefined;
          const originalPrMergedAt = prRecord?.original_pr_merged_at || undefined;

          let cachedEmail: string | undefined;
          try {
            const emails = getEmailsForAnalysis(cachedAnalysis.id);
            if (emails.length > 0) {
              cachedEmail = emails[0].email_content;
            }
          } catch {
            // Continue without cached email
          }

          return NextResponse.json<GetMacroscopeReviewResponse>({
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
      }
    }

    // Need GitHub token for fetching comments
    const githubToken = config.githubToken;
    if (!githubToken) {
      return NextResponse.json<GetMacroscopeReviewResponse>(
        {
          success: false,
          error: "GITHUB_BOT_TOKEN is not configured. Required to fetch PR comments.",
        },
        { status: 500 }
      );
    }

    const octokit = new Octokit({ auth: githubToken });

    // Resolve original PR URL from multiple sources
    if (!originalPrUrl) {
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
      try {
        const { data: forkedPr } = await octokit.pulls.get({
          owner: parsedForkedPr.owner,
          repo: parsedForkedPr.repo,
          pull_number: parsedForkedPr.prNumber,
        });

        if (forkedPr.body) {
          const extractedUrl = extractOriginalPRUrl(forkedPr.body);
          if (extractedUrl) {
            originalPrUrl = extractedUrl;
          }
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return NextResponse.json<GetMacroscopeReviewResponse>(
          {
            success: false,
            error: `Failed to fetch forked PR details: ${errorMessage}`,
          },
          { status: 500 }
        );
      }
    }

    if (!originalPrUrl) {
      return NextResponse.json<GetMacroscopeReviewResponse>(
        {
          success: false,
          needsOriginalPrUrl: true,
          forkedPrUrl,
          error: "Could not determine the original PR URL. Please provide it manually.",
        },
        { status: 200 }
      );
    }

    const parsedOriginalPr = parsePrUrl(originalPrUrl);
    if (!parsedOriginalPr) {
      return NextResponse.json<GetMacroscopeReviewResponse>(
        {
          success: false,
          error: "Invalid originalPrUrl format. Expected: https://github.com/owner/repo/pull/123",
        },
        { status: 400 }
      );
    }

    // Fetch original PR details
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
    }

    // Fetch Macroscope comments
    const macroscopeComments = await fetchMacroscopeComments(
      parsedForkedPr.owner,
      parsedForkedPr.repo,
      parsedForkedPr.prNumber
    );

    if (macroscopeComments.length === 0) {
      return NextResponse.json<GetMacroscopeReviewResponse>({
        success: true,
        result: {
          meaningful_bugs_found: false,
          reason: "No Macroscope review comments were found on this PR. The bot may not have reviewed it yet, or there were no issues to report.",
        },
        forkedPrUrl,
        originalPrUrl,
        originalPrTitle,
        originalPrState,
        originalPrMergedAt,
        cached: false,
      });
    }

    // Convert to V2 format
    const result = convertMacroscopeCommentsToV2(macroscopeComments);

    // Generate code snippet images for comments with code suggestions
    if (isCodeImageGenerationAvailable()) {
      const prIdForImage = parsedForkedPr.prNumber.toString();
      const commentsWithSuggestions = result.all_comments.filter((c) => c.code_suggestion);
      console.log(`Code image generation: ${commentsWithSuggestions.length} comments with code suggestions out of ${result.all_comments.length} total`);

      for (const comment of commentsWithSuggestions) {
        try {
          const ext = comment.file_path.split(".").pop()?.toLowerCase() || "js";
          const langMap: Record<string, string> = {
            ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
            py: "python", rb: "ruby", go: "go", rs: "rust", java: "java",
            cs: "csharp", cpp: "cpp", c: "c", php: "php", swift: "swift",
          };
          const language = langMap[ext] || ext;

          const imageResult = await generateCodeImage({
            code: comment.code_suggestion!,
            language,
            prId: `${prIdForImage}-${comment.index}`,
          });

          if (imageResult.success) {
            (comment as AnalysisComment).code_snippet_image_url = imageResult.url;
            console.log(`Generated code image for comment ${comment.index}:`, imageResult.url);
          } else {
            console.warn(`Code image generation failed for comment ${comment.index}:`, imageResult.error);
          }
        } catch (imageError) {
          console.error(`Failed to generate image for comment ${comment.index}:`, imageError);
        }
      }
    } else {
      console.log("Code image generation skipped: R2 storage is not configured");
    }

    // Save to database
    let analysisId: number | undefined;
    try {
      let prId: number;
      const existingPR = getPRByUrl(forkedPrUrl);
      if (existingPR) {
        prId = existingPR.id;
        if (originalPrUrl) {
          updatePROriginalInfo(prId, originalPrUrl, originalPrTitle || null, originalPrState, originalPrMergedAt);
        }
        updatePRBugCount(prId, result.meaningful_bugs_count);
      } else {
        const forkId = saveFork(
          parsedForkedPr.owner,
          parsedForkedPr.repo,
          `https://github.com/${parsedForkedPr.owner}/${parsedForkedPr.repo}`
        );

        prId = savePR(
          forkId,
          parsedForkedPr.prNumber,
          null,
          forkedPrUrl,
          originalPrUrl,
          true,
          result.meaningful_bugs_count,
          {
            originalPrTitle: originalPrTitle || null,
            originalPrState,
            originalPrMergedAt,
            createdBy,
          }
        );
      }

      analysisId = saveAnalysis(
        prId,
        result.meaningful_bugs_count > 0,
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
    } catch (dbError) {
      console.error("Failed to save analysis to database:", dbError);
    }

    return NextResponse.json<GetMacroscopeReviewResponse>({
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
    console.error("Get Macroscope review error:", errorMessage);

    if (errorMessage.includes("rate limit")) {
      return NextResponse.json<GetMacroscopeReviewResponse>(
        {
          success: false,
          error: "API rate limit reached. Please try again in a few moments.",
        },
        { status: 429 }
      );
    }

    return NextResponse.json<GetMacroscopeReviewResponse>(
      { success: false, error: `Failed to get Macroscope review: ${errorMessage}` },
      { status: 500 }
    );
  }
}
