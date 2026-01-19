import { loadPrompt, getPromptMetadata } from "./prompt-loader";
import { sendMessage, DEFAULT_MODEL } from "./anthropic";
import { BugSnippet } from "./pr-analyzer";

/**
 * Input for email generation.
 * Only PR and bug data - recipient info will be Attio merge fields.
 */
export interface EmailGenerationInput {
  originalPrUrl: string; // URL to their original PR in their repo
  prTitle?: string; // Optional - will use default based on PR number if not provided
  forkedPrUrl: string; // URL to our fork with Macroscope review
  bug: BugSnippet;
  totalBugs: number;
  model?: string; // Optional model override
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
    model: inputModel,
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

  // Load the prompt and interpolate variables
  const prompt = loadPrompt("email-generation", {
    ORIGINAL_PR_NUMBER: originalPrNumber,
    ORIGINAL_PR_URL: originalPrUrl,
    PR_TITLE: prTitle || `PR #${originalPrNumber}`,
    FORKED_PR_URL: forkedPrUrl,
    BUG_TITLE: bug.title,
    BUG_EXPLANATION: bug.explanation,
    BUG_SEVERITY: bug.severity,
    TOTAL_BUGS: totalBugs.toString(),
  });

  // Use input model if provided, otherwise get from prompt metadata, fallback to default
  const metadata = getPromptMetadata("email-generation");
  const model = inputModel || metadata.model || DEFAULT_MODEL;

  // Send to Claude and get response (not JSON, just text)
  const email = await sendMessage(prompt, {
    model,
    maxTokens: 2048,
    temperature: 0.3, // Slight creativity for natural language
  });

  return email.trim();
}
