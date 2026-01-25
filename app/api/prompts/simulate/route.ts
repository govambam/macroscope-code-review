import { NextRequest, NextResponse } from "next/server";
import {
  getRecentPRWithAnalysisAndEmail,
} from "@/lib/services/database";
import {
  PRAnalysisResult,
  isV2AnalysisResult,
  getBestBugForOutreach,
  getMostImpactfulBug,
  MeaningfulBugsResult,
} from "@/lib/services/pr-analyzer";
import { sendMessage, sendMessageAndParseJSON, DEFAULT_MODEL } from "@/lib/services/anthropic";
import { getPromptMetadata } from "@/lib/services/prompt-loader";

interface SimulateRequest {
  promptType: string; // "pr-analysis" or "email-generation"
  promptContent: string; // The full prompt content to test
  model?: string; // Optional: override model from prompt
}

interface SimulateResponse {
  success: boolean;
  error?: string;
  result?: {
    rawOutput: string; // Raw text output from Claude
    parsedOutput?: unknown; // Parsed JSON if applicable
    parseError?: string; // Error if JSON parsing failed
    executionTimeMs: number;
    model: string;
    inputTokensEstimate: number;
    testDataUsed: {
      prId: number;
      forkedPrUrl: string;
      originalPrUrl: string | null;
    };
  };
}

/**
 * Interpolates variables in a prompt template.
 * Variables are in the format {VARIABLE_NAME}.
 */
function interpolatePrompt(template: string, variables: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    // Replace both {VAR} and { VAR } formats
    const patterns = [
      new RegExp(`\\{\\s*${key}\\s*\\}`, "g"),
      new RegExp(`\\$\\{\\s*${key}\\s*\\}`, "g"),
    ];
    for (const pattern of patterns) {
      // Use replacer function to avoid special pattern interpretation ($&, $`, etc.)
      result = result.replace(pattern, () => value);
    }
  }
  return result;
}

/**
 * Extracts PR number from a GitHub PR URL.
 */
function extractPrNumber(url: string): string | null {
  const match = url.match(/\/pull\/(\d+)/);
  return match ? match[1] : null;
}

/**
 * Formats merged date for display.
 */
function formatMergedDate(mergedAt: string | null): string {
  if (!mergedAt) return "unknown";

  const mergedDate = new Date(mergedAt);
  if (isNaN(mergedDate.getTime())) return "unknown";

  const now = new Date();
  const diffDays = Math.floor((now.getTime() - mergedDate.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays <= 0) return "today"; // Handle negative values from clock skew
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) {
    const weeks = Math.floor(diffDays / 7);
    return `${weeks} week${weeks > 1 ? "s" : ""} ago`;
  }

  return mergedDate.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Estimates token count for a string (rough approximation).
 */
function estimateTokens(text: string): number {
  // Rough estimate: ~4 characters per token on average
  return Math.ceil(text.length / 4);
}

/**
 * POST /api/prompts/simulate
 *
 * Simulates running a prompt with test data from a recent PR.
 * This allows testing prompt changes before saving them.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // Check for required environment variables
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json<SimulateResponse>({
        success: false,
        error: "ANTHROPIC_API_KEY is not configured.",
      }, { status: 500 });
    }

    const body: SimulateRequest = await request.json();
    const { promptType, promptContent, model: requestedModel } = body;

    if (!promptType || !promptContent) {
      return NextResponse.json<SimulateResponse>({
        success: false,
        error: "promptType and promptContent are required",
      }, { status: 400 });
    }

    // Get test data
    const testData = getRecentPRWithAnalysisAndEmail();
    if (!testData) {
      return NextResponse.json<SimulateResponse>({
        success: false,
        error: "No PR found with both an analysis (with bugs) and a generated email. Analyze a PR and generate an email first.",
      });
    }

    const { pr, analysis } = testData;

    // Parse the analysis JSON
    let analysisResult: PRAnalysisResult;
    try {
      const parsed = JSON.parse(analysis.analysis_json);
      // Verify parsed result is a valid object (not null/primitive) before using 'in' operator
      if (typeof parsed !== "object" || parsed === null) {
        return NextResponse.json<SimulateResponse>({
          success: false,
          error: "Stored analysis JSON is not a valid object",
        });
      }
      analysisResult = parsed;
    } catch {
      return NextResponse.json<SimulateResponse>({
        success: false,
        error: "Failed to parse stored analysis JSON",
      });
    }

    // Build variables based on prompt type
    let variables: Record<string, string> = {};
    let isJsonPrompt = false;

    if (promptType === "pr-analysis") {
      isJsonPrompt = true;

      // Build macroscope comments text
      let macroscopeCommentsText = "";
      if (isV2AnalysisResult(analysisResult)) {
        macroscopeCommentsText = analysisResult.all_comments
          .map((comment, index) => {
            return `
### Comment ${index + 1}: ${comment.file_path}${comment.line_number ? `:${comment.line_number}` : ""}

**Macroscope's finding:**
${comment.macroscope_comment_text}
`;
          })
          .join("\n---\n");
      }

      variables = {
        FORKED_PR_URL: pr.forked_pr_url,
        ORIGINAL_PR_URL: pr.original_pr_url || "https://github.com/example/repo/pull/1",
        MACROSCOPE_COMMENTS: macroscopeCommentsText || "[No comments available in stored analysis]",
        TOTAL_COMMENTS: isV2AnalysisResult(analysisResult)
          ? (analysisResult.total_comments_processed ?? analysisResult.all_comments.length).toString()
          : "1",
      };
    } else if (promptType === "email-generation") {
      isJsonPrompt = false;

      // Get best bug for outreach (with safe defaults)
      let bugTitle = "Sample Bug";
      let bugExplanation = "Sample bug explanation";
      let bugSeverity = "high";
      let totalBugs = 1;

      if (isV2AnalysisResult(analysisResult)) {
        const best = getBestBugForOutreach(analysisResult);
        if (best) {
          bugTitle = best.title || "Untitled Bug";
          bugExplanation = best.explanation_short || best.explanation || "No explanation available";
          bugSeverity = (best.category?.replace("bug_", "") || "high");
        }
        totalBugs = analysisResult.meaningful_bugs_count ?? 1;
      } else if ("meaningful_bugs_found" in analysisResult && analysisResult.meaningful_bugs_found) {
        const v1Result = analysisResult as MeaningfulBugsResult;
        const best = getMostImpactfulBug(v1Result);
        if (best) {
          bugTitle = best.title || "Untitled Bug";
          bugExplanation = best.explanation || "No explanation available";
          bugSeverity = best.severity || "high";
        }
        totalBugs = v1Result.total_macroscope_bugs_found ?? 1;
      }

      const prNumber = pr.original_pr_url ? extractPrNumber(pr.original_pr_url) : null;
      const prNumberStr = prNumber || "1";

      variables = {
        ORIGINAL_PR_NUMBER: prNumberStr,
        ORIGINAL_PR_URL: pr.original_pr_url || "https://github.com/example/repo/pull/1",
        PR_TITLE: pr.original_pr_title || `PR #${prNumberStr}`,
        PR_STATUS: pr.original_pr_state || "open",
        PR_MERGED_DATE: formatMergedDate(pr.original_pr_merged_at),
        FORKED_PR_URL: pr.forked_pr_url || "https://github.com/example/fork/pull/1",
        BUG_TITLE: bugTitle,
        BUG_EXPLANATION: bugExplanation,
        BUG_SEVERITY: bugSeverity,
        TOTAL_BUGS: String(totalBugs),
      };
    } else {
      return NextResponse.json<SimulateResponse>({
        success: false,
        error: `Unknown prompt type: ${promptType}. Supported types: pr-analysis, email-generation`,
      }, { status: 400 });
    }

    // Interpolate the prompt with variables
    const interpolatedPrompt = interpolatePrompt(promptContent, variables);

    // Determine model to use
    const metadata = getPromptMetadata(promptType);
    const model = requestedModel || metadata.model || DEFAULT_MODEL;

    // Estimate input tokens
    const inputTokensEstimate = estimateTokens(interpolatedPrompt);

    // Execute the prompt
    const startTime = Date.now();
    let rawOutput: string;
    let parsedOutput: unknown = undefined;
    let parseError: string | undefined;

    try {
      if (isJsonPrompt) {
        // For JSON prompts, try to parse the response
        parsedOutput = await sendMessageAndParseJSON<unknown>(interpolatedPrompt, {
          model,
          maxTokens: 8192,
          temperature: 0,
        });
        rawOutput = JSON.stringify(parsedOutput, null, 2);
      } else {
        // For text prompts, just get the raw output
        rawOutput = await sendMessage(interpolatedPrompt, {
          model,
          maxTokens: 2048,
          temperature: 0.3,
        });
      }
    } catch (error) {
      // If parsing failed but we have a response, return it with the error
      if (error instanceof Error && error.message.includes("Failed to parse JSON")) {
        return NextResponse.json<SimulateResponse>({
          success: true,
          result: {
            rawOutput: error.message,
            parseError: error.message,
            executionTimeMs: Date.now() - startTime,
            model,
            inputTokensEstimate,
            testDataUsed: {
              prId: pr.id,
              forkedPrUrl: pr.forked_pr_url,
              originalPrUrl: pr.original_pr_url,
            },
          },
        });
      }
      throw error;
    }

    const executionTimeMs = Date.now() - startTime;

    return NextResponse.json<SimulateResponse>({
      success: true,
      result: {
        rawOutput,
        parsedOutput,
        parseError,
        executionTimeMs,
        model,
        inputTokensEstimate,
        testDataUsed: {
          prId: pr.id,
          forkedPrUrl: pr.forked_pr_url,
          originalPrUrl: pr.original_pr_url,
        },
      },
    });
  } catch (error) {
    console.error("Simulation error:", error);

    // Check for specific error types
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (errorMessage.includes("rate limit")) {
      return NextResponse.json<SimulateResponse>({
        success: false,
        error: "API rate limit reached. Please try again in a few moments.",
      }, { status: 429 });
    }

    return NextResponse.json<SimulateResponse>({
      success: false,
      error: `Simulation failed: ${errorMessage}`,
    }, { status: 500 });
  }
}
