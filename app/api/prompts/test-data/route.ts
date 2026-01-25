import { NextResponse } from "next/server";
import {
  getRecentPRWithAnalysisAndEmail,
  PRRecord,
  PRAnalysisRecord,
  GeneratedEmailRecord,
} from "@/lib/services/database";
import {
  PRAnalysisResult,
  isV2AnalysisResult,
  getBestBugForOutreach,
  getMostImpactfulBug,
  MeaningfulBugsResult,
} from "@/lib/services/pr-analyzer";

/**
 * Test data returned for prompt simulation.
 */
interface TestDataResponse {
  success: boolean;
  error?: string;
  testData?: {
    // PR info
    pr: {
      id: number;
      forkedPrUrl: string;
      originalPrUrl: string | null;
      originalPrTitle: string | null;
      originalPrState: string | null;
      originalPrMergedAt: string | null;
    };
    // Analysis data
    analysis: {
      id: number;
      schemaVersion: number;
      meaningfulBugsCount: number;
      totalCommentsProcessed: number | null;
      analysisJson: PRAnalysisResult;
    };
    // Email data
    email: {
      id: number;
      content: string;
    };
    // Best bug for outreach (formatted for email generation)
    bestBug: {
      title: string;
      explanation: string;
      explanationShort: string | null;
      filePath: string;
      severity: string;
      codeSuggestion: string | null;
    } | null;
    // Variables for pr-analysis prompt
    prAnalysisVariables: {
      FORKED_PR_URL: string;
      ORIGINAL_PR_URL: string;
      MACROSCOPE_COMMENTS: string;
      TOTAL_COMMENTS: string;
    } | null;
    // Variables for email-generation prompt
    emailGenerationVariables: {
      ORIGINAL_PR_NUMBER: string;
      ORIGINAL_PR_URL: string;
      PR_TITLE: string;
      PR_STATUS: string;
      PR_MERGED_DATE: string;
      FORKED_PR_URL: string;
      BUG_TITLE: string;
      BUG_EXPLANATION: string;
      BUG_SEVERITY: string;
      TOTAL_BUGS: string;
    } | null;
  };
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
 * GET /api/prompts/test-data
 *
 * Returns test data for prompt simulation.
 * Finds the most recent PR that has an analysis with meaningful bugs and a generated email.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const data = getRecentPRWithAnalysisAndEmail();

    if (!data) {
      return NextResponse.json<TestDataResponse>({
        success: false,
        error: "No PR found with both an analysis (with bugs) and a generated email. Analyze a PR and generate an email first.",
      });
    }

    const { pr, analysis, email } = data;

    // Parse the analysis JSON
    let analysisResult: PRAnalysisResult;
    try {
      analysisResult = JSON.parse(analysis.analysis_json);
    } catch {
      return NextResponse.json<TestDataResponse>({
        success: false,
        error: "Failed to parse analysis JSON",
      });
    }

    // Get the best bug for outreach
    let bestBug: {
      title: string;
      explanation: string;
      explanationShort: string | null;
      filePath: string;
      severity: string;
      codeSuggestion: string | null;
    } | null = null;
    let macroscopeCommentsText = "";
    let meaningfulBugsCount = 0;

    if (isV2AnalysisResult(analysisResult)) {
      const best = getBestBugForOutreach(analysisResult);
      if (best) {
        bestBug = {
          title: best.title,
          explanation: best.explanation,
          explanationShort: best.explanation_short,
          filePath: best.file_path,
          severity: best.category.replace("bug_", ""),
          codeSuggestion: best.code_suggestion,
        };
      }

      // Build macroscope comments text from all_comments
      macroscopeCommentsText = analysisResult.all_comments
        .map((comment, index) => {
          return `
### Comment ${index + 1}: ${comment.file_path}${comment.line_number ? `:${comment.line_number}` : ""}

**Macroscope's finding:**
${comment.macroscope_comment_text}
`;
        })
        .join("\n---\n");

      meaningfulBugsCount = analysisResult.meaningful_bugs_count;
    } else if ("meaningful_bugs_found" in analysisResult && analysisResult.meaningful_bugs_found) {
      const v1Result = analysisResult as MeaningfulBugsResult;
      const best = getMostImpactfulBug(v1Result);
      if (best) {
        bestBug = {
          title: best.title,
          explanation: best.explanation,
          explanationShort: null,
          filePath: best.file_path,
          severity: best.severity,
          codeSuggestion: null,
        };
      }

      // For V1, we don't have the original comments stored
      macroscopeCommentsText = v1Result.bugs
        .map((bug, index) => {
          return `
### Bug ${index + 1}: ${bug.file_path}

**Title:** ${bug.title}
**Severity:** ${bug.severity}
**Explanation:** ${bug.explanation}
`;
        })
        .join("\n---\n");

      meaningfulBugsCount = v1Result.total_macroscope_bugs_found;
    }

    // Build variables for pr-analysis prompt
    const prAnalysisVariables = pr.original_pr_url
      ? {
          FORKED_PR_URL: pr.forked_pr_url,
          ORIGINAL_PR_URL: pr.original_pr_url,
          MACROSCOPE_COMMENTS: macroscopeCommentsText || "[Sample macroscope comments would appear here]",
          TOTAL_COMMENTS: isV2AnalysisResult(analysisResult)
            ? analysisResult.total_comments_processed.toString()
            : meaningfulBugsCount.toString(),
        }
      : null;

    // Build variables for email-generation prompt
    const prNumber = pr.original_pr_url ? extractPrNumber(pr.original_pr_url) : null;
    const emailGenerationVariables =
      bestBug && pr.original_pr_url && prNumber
        ? {
            ORIGINAL_PR_NUMBER: prNumber,
            ORIGINAL_PR_URL: pr.original_pr_url,
            PR_TITLE: pr.original_pr_title || `PR #${prNumber}`,
            PR_STATUS: pr.original_pr_state || "open",
            PR_MERGED_DATE: formatMergedDate(pr.original_pr_merged_at),
            FORKED_PR_URL: pr.forked_pr_url,
            BUG_TITLE: bestBug.title,
            BUG_EXPLANATION: bestBug.explanationShort || bestBug.explanation,
            BUG_SEVERITY: bestBug.severity,
            TOTAL_BUGS: meaningfulBugsCount.toString(),
          }
        : null;

    return NextResponse.json<TestDataResponse>({
      success: true,
      testData: {
        pr: {
          id: pr.id,
          forkedPrUrl: pr.forked_pr_url,
          originalPrUrl: pr.original_pr_url,
          originalPrTitle: pr.original_pr_title,
          originalPrState: pr.original_pr_state,
          originalPrMergedAt: pr.original_pr_merged_at,
        },
        analysis: {
          id: analysis.id,
          schemaVersion: analysis.schema_version,
          meaningfulBugsCount,
          totalCommentsProcessed: analysis.total_comments_processed,
          analysisJson: analysisResult,
        },
        email: {
          id: email.id,
          content: email.email_content,
        },
        bestBug,
        prAnalysisVariables,
        emailGenerationVariables,
      },
    });
  } catch (error) {
    console.error("Error fetching test data:", error);
    return NextResponse.json<TestDataResponse>(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
