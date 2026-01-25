import { loadPrompt, getPromptMetadata } from "./prompt-loader";
import { sendMessage, DEFAULT_MODEL } from "./anthropic";
import { BugSnippet, AnalysisComment } from "./pr-analyzer";

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
}

/**
 * Input for email generation.
 * Only PR and bug data - recipient info will be Attio merge fields.
 */
export interface EmailGenerationInput {
  originalPrUrl: string; // URL to their original PR in their repo
  prTitle?: string; // Optional - will use default based on PR number if not provided
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
 * Generates an outreach email using the bug analysis results.
 * The email will contain Attio merge fields for personalization:
 * - { First Name } - Recipient's first name
 * - { Company Name } - Prospect's company name
 * - { Sender Name } - Sender's name
 *
 * @param input - Email generation parameters (PR and bug data only)
 * @returns Generated email text with Attio merge fields
 * @throws Error if prompt loading or API call fails
 */
export async function generateEmail(input: EmailGenerationInput): Promise<string> {
  const {
    originalPrUrl,
    prTitle,
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

  // Load the prompt and interpolate variables
  const prompt = loadPrompt("email-generation", {
    ORIGINAL_PR_NUMBER: originalPrNumber,
    ORIGINAL_PR_URL: originalPrUrl,
    PR_TITLE: prTitle || `PR #${originalPrNumber}`,
    FORKED_PR_URL: forkedPrUrl,
    BUG_TITLE: bug.title,
    BUG_EXPLANATION: bugExplanation,
    BUG_SEVERITY: bug.severity,
    TOTAL_BUGS: totalBugs.toString(),
    // Optional: code suggestion for V2 format
    ...(bugInput.code_suggestion && { BUG_FIX_SUGGESTION: bugInput.code_suggestion }),
  });

  // Get model from prompt metadata, fallback to Sonnet
  const metadata = getPromptMetadata("email-generation");
  const model = metadata.model || DEFAULT_MODEL;

  // Send to Claude and get response (not JSON, just text)
  const email = await sendMessage(prompt, {
    model,
    maxTokens: 2048,
    temperature: 0.3, // Slight creativity for natural language
  });

  return email.trim();
}
