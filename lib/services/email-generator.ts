import { loadPrompt, getPromptMetadata } from "./prompt-loader";
import { sendMessageAndParseJSON, DEFAULT_MODEL } from "./anthropic";
import { BugSnippet, AnalysisComment } from "./pr-analyzer";

/**
 * Single email entry in the sequence.
 */
export interface EmailEntry {
  subject: string;
  body: string;
}

/**
 * Complete 4-email outreach sequence returned by the email generator.
 * Contains Apollo merge fields like {{first_name}}, {{company}}, {{sender_first_name}}
 */
export interface EmailSequence {
  email_1: EmailEntry;
  email_2: EmailEntry;
  email_3: EmailEntry;
  email_4: EmailEntry;
}

/**
 * Extended bug info for email generation.
 * Supports both V1 BugSnippet and V2 AnalysisComment-derived data.
 */
export interface EmailBugInput {
  title: string;
  explanation: string;
  explanation_short?: string; // V2: Short version for concise emails
  file_path: string;
  severity: "critical" | "high" | "medium";
  code_suggestion?: string; // V2: Suggested fix
  impact_scenario?: string; // V2: Real-world impact scenario
  macroscope_comment_text?: string; // Original Macroscope comment (may contain code snippet)
  code_snippet_image_url?: string; // URL to syntax-highlighted code image
}

/**
 * Input for email generation.
 * Only PR and bug data - recipient info will be Apollo merge fields.
 */
export interface EmailGenerationInput {
  originalPrUrl: string; // URL to their original PR in their repo
  prTitle?: string; // Optional - will use default based on PR number if not provided
  prStatus?: "open" | "merged" | "closed"; // Status of the original PR
  prMergedAt?: string | null; // ISO timestamp if merged
  forkedPrUrl: string; // URL to our fork with Macroscope review
  bug: BugSnippet | EmailBugInput; // Supports both V1 and V2 formats
  totalBugs: number;
}

/**
 * Extracts company name from a GitHub URL.
 * Example: "https://github.com/growthbook/growthbook/pull/123" → "GrowthBook"
 */
export function extractCompanyFromUrl(url: string): string | null {
  const match = url.match(/github\.com\/([\w.-]+)\//);
  if (!match) return null;

  const orgName = match[1];
  // Capitalize first letter and handle common patterns
  return orgName
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");
}

/**
 * Extracts PR number from a GitHub PR URL.
 */
export function extractPrNumber(url: string): string | null {
  const match = url.match(/\/pull\/(\d+)/);
  return match ? match[1] : null;
}

/**
 * Generates a 4-email outreach sequence using the bug analysis results.
 * Each email will contain Apollo merge fields for personalization:
 * - {{first_name}} - Recipient's first name
 * - {{company}} - Prospect's company name
 * - {{sender_first_name}} - Sender's first name
 *
 * @param input - Email generation parameters (PR and bug data only)
 * @returns EmailSequence object with 4 emails, each containing subject and body
 * @throws Error if prompt loading or API call fails
 */
export async function generateEmail(input: EmailGenerationInput): Promise<EmailSequence> {
  const {
    originalPrUrl,
    prTitle,
    prStatus,
    prMergedAt,
    forkedPrUrl,
    bug,
    totalBugs,
  } = input;

  // Validate required fields
  if (!originalPrUrl || !forkedPrUrl || !bug) {
    throw new Error("Missing required fields for email generation");
  }

  // Extract the PR number from the original PR URL
  const originalPrNumber = extractPrNumber(originalPrUrl);
  if (!originalPrNumber) {
    throw new Error(`Could not extract PR number from original URL: ${originalPrUrl}`);
  }

  // Use explanation_short if available (V2 format), otherwise use full explanation
  const bugInput = bug as EmailBugInput;
  const bugExplanation = bugInput.explanation_short || bug.explanation;

  // Format merged date for context (e.g., "3 days ago" or "January 15, 2024")
  let mergedDateFormatted = "";
  if (prMergedAt) {
    const mergedDate = new Date(prMergedAt);
    if (isNaN(mergedDate.getTime())) {
      mergedDateFormatted = "unknown";
    } else {
      const now = new Date();
      const diffDays = Math.floor((now.getTime() - mergedDate.getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays === 0) {
        mergedDateFormatted = "today";
      } else if (diffDays === 1) {
        mergedDateFormatted = "yesterday";
      } else if (diffDays < 7) {
        mergedDateFormatted = `${diffDays} days ago`;
      } else if (diffDays < 30) {
        const weeks = Math.floor(diffDays / 7);
        mergedDateFormatted = `${weeks} week${weeks > 1 ? "s" : ""} ago`;
      } else {
        mergedDateFormatted = mergedDate.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
      }
    }
  }

  // Load the prompt and interpolate variables
  const prompt = loadPrompt("email-generation", {
    ORIGINAL_PR_NUMBER: originalPrNumber,
    ORIGINAL_PR_URL: originalPrUrl,
    PR_TITLE: prTitle || `PR #${originalPrNumber}`,
    PR_STATUS: prStatus || "open",
    PR_MERGED_DATE: mergedDateFormatted || "unknown",
    FORKED_PR_URL: forkedPrUrl,
    BUG_TITLE: bug.title,
    BUG_EXPLANATION: bugExplanation,
    BUG_SEVERITY: bug.severity,
    TOTAL_BUGS: totalBugs.toString(),
    // Optional V2 fields
    ...(bugInput.code_suggestion && { BUG_FIX_SUGGESTION: bugInput.code_suggestion }),
    ...(bugInput.code_suggestion && { CODE_SNIPPET: bugInput.code_suggestion }),
    ...(bugInput.impact_scenario && { IMPACT_SCENARIO: bugInput.impact_scenario }),
    ...(bugInput.macroscope_comment_text && { MACROSCOPE_COMMENT: bugInput.macroscope_comment_text }),
    ...(bugInput.code_snippet_image_url && { CODE_SNIPPET_IMAGE_URL: bugInput.code_snippet_image_url }),
  });

  // Get model from prompt metadata, fallback to Sonnet
  const metadata = getPromptMetadata("email-generation");
  const model = metadata.model || DEFAULT_MODEL;

  // Send to Claude and parse JSON response
  const emailSequence = await sendMessageAndParseJSON<EmailSequence>(prompt, {
    model,
    maxTokens: 4096, // Increased for 4-email sequence
    temperature: 0.3, // Slight creativity for natural language
  });

  return emailSequence;
}
