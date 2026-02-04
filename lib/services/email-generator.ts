import { loadPrompt, getPromptMetadata } from "./prompt-loader";
import { sendMessageAndParseJSON, DEFAULT_MODEL } from "./anthropic";
import {
  EmailVariables,
  AllEmailVariables,
  EmailSequence,
  EmailEntry,
  renderEmailSequence,
} from "../constants/email-templates";

// Re-export types that other files depend on
export type { EmailEntry, EmailSequence };
export type { EmailVariables, AllEmailVariables } from "../constants/email-templates";

/**
 * Bug data needed for email variable generation.
 */
export interface EmailBugInput {
  title: string;
  explanation: string;
  file_path: string;
  severity: "critical" | "high" | "medium";
  code_suggestion?: string;
  macroscope_comment_text?: string;
  code_snippet_image_url?: string;
}

/**
 * Input for email generation.
 */
export interface EmailGenerationInput {
  originalPrUrl: string;
  prTitle?: string;
  forkedPrUrl: string;
  bug: EmailBugInput;
}

/**
 * Result of email generation: LLM variables, DB variables, and rendered previews.
 */
export interface EmailGenerationResult {
  variables: EmailVariables;
  dbVariables: Omit<AllEmailVariables, keyof EmailVariables>;
  previews: EmailSequence;
}

/**
 * Extracts company name from a GitHub URL.
 * Example: "https://github.com/growthbook/growthbook/pull/123" → "GrowthBook"
 */
export function extractCompanyFromUrl(url: string): string | null {
  const match = url.match(/github\.com\/([\w.-]+)\//);
  if (!match) return null;

  const orgName = match[1];
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
 * Calls the LLM to generate 4 email variables from a Macroscope comment.
 */
export async function generateEmailVariables(
  macroscopeComment: string,
  filePath: string,
  codeSuggestion: string | null
): Promise<EmailVariables> {
  // Build the code suggestion section conditionally
  const codeSuggestionSection = codeSuggestion
    ? `**Code suggestion:**\n\`\`\`\n${codeSuggestion}\n\`\`\``
    : "";

  const prompt = loadPrompt("email-variables", {
    FILE_PATH: filePath,
    CODE_SUGGESTION_SECTION: codeSuggestionSection,
    MACROSCOPE_COMMENT: macroscopeComment,
  });

  const metadata = getPromptMetadata("email-variables");
  const model = metadata.model || DEFAULT_MODEL;

  const variables = await sendMessageAndParseJSON<EmailVariables>(prompt, {
    model,
    maxTokens: 1024,
    temperature: 0.3,
  });

  return variables;
}

/**
 * Generates email variables from a Macroscope comment and renders preview emails.
 *
 * @param input - PR and bug data
 * @returns LLM-generated variables, DB-sourced variables, and rendered email previews
 */
export async function generateEmail(input: EmailGenerationInput): Promise<EmailGenerationResult> {
  const { originalPrUrl, prTitle, forkedPrUrl, bug } = input;

  if (!originalPrUrl || !forkedPrUrl || !bug) {
    throw new Error("Missing required fields for email generation");
  }

  // Step 1: LLM generates the 4 variables from the Macroscope comment
  const variables = await generateEmailVariables(
    bug.macroscope_comment_text || bug.explanation,
    bug.file_path || "unknown",
    bug.code_suggestion || null
  );

  // Step 2: Gather DB variables from input
  const dbVariables = {
    PR_NAME: prTitle || `PR #${extractPrNumber(originalPrUrl) || "unknown"}`,
    PR_LINK: originalPrUrl,
    BUG_FIX_URL: bug.code_snippet_image_url || "",
    SIMULATED_PR_LINK: forkedPrUrl,
  };

  // Step 3: Render templates with all variables
  const previews = renderEmailSequence({ ...variables, ...dbVariables });

  return { variables, dbVariables, previews };
}
