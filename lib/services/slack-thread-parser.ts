/**
 * Service for parsing Slack signup notification threads.
 * Uses Claude to extract structured data from unstructured thread text.
 */

import { loadPrompt, getPromptMetadata } from "./prompt-loader";
import { sendMessageAndParseJSON, DEFAULT_MODEL } from "./anthropic";
import type { ParsedSignupData } from "@/lib/types/signup-lead";

/**
 * Parses a Slack signup notification thread and extracts structured lead data.
 *
 * @param rawThread - The raw text content of the Slack thread (copy/pasted)
 * @returns ParsedSignupData with all extracted fields
 */
export async function parseSlackSignupThread(
  rawThread: string
): Promise<ParsedSignupData> {
  if (!rawThread || rawThread.trim().length === 0) {
    throw new Error("Empty thread content provided");
  }

  const prompt = loadPrompt("parse-slack-thread", {
    SLACK_THREAD: rawThread,
  });

  const metadata = getPromptMetadata("parse-slack-thread");
  const model = metadata.model || DEFAULT_MODEL;

  const rawResult = await sendMessageAndParseJSON<ParsedSignupData>(prompt, {
    model,
    maxTokens: 2048,
    temperature: 0,
  });

  // Validate and clean the result
  const cleanedResult: ParsedSignupData = {};

  // Copy over string fields only if they have values
  const stringFields: (keyof ParsedSignupData)[] = [
    "firstName",
    "fullName",
    "githubUsername",
    "githubUrl",
    "linkedinUrl",
    "email",
    "location",
    "currentRole",
    "userSummary",
    "companyName",
    "companyUrl",
    "companyLinkedIn",
    "companyDescription",
    "companyLocation",
    "repositoryName",
    "repositoryLanguage",
    "githubAccountCreated",
    "confidenceScore",
  ];

  for (const field of stringFields) {
    const value = rawResult[field];
    if (value && typeof value === "string" && value.trim().length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (cleanedResult as any)[field] = value.trim();
    }
  }

  // Handle numeric fields
  if (rawResult.companySize && typeof rawResult.companySize === "number") {
    cleanedResult.companySize = rawResult.companySize;
  }
  if (rawResult.engineeringCount && typeof rawResult.engineeringCount === "number") {
    cleanedResult.engineeringCount = rawResult.engineeringCount;
  }

  // Handle accountType enum
  if (rawResult.accountType === "individual" || rawResult.accountType === "organization") {
    cleanedResult.accountType = rawResult.accountType;
  }

  // Handle boolean
  if (typeof rawResult.isPotentialCompetitor === "boolean") {
    cleanedResult.isPotentialCompetitor = rawResult.isPotentialCompetitor;
  }

  return cleanedResult;
}
