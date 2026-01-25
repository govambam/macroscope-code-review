import * as fs from "fs";
import * as path from "path";
import { getPrompt } from "./database";

/**
 * Loads a prompt, checking the database first then falling back to the filesystem.
 * Database prompts take precedence over filesystem prompts.
 *
 * @param promptName - The name of the prompt (e.g., 'email-generation', 'pr-analysis')
 * @param variables - Optional key-value pairs to interpolate into the prompt
 * @returns The interpolated prompt string
 * @throws Error if the prompt doesn't exist in database or filesystem
 *
 * @example
 * const prompt = loadPrompt('pr-analysis', {
 *   FORKED_PR_URL: 'https://github.com/user/repo/pull/1',
 *   ORIGINAL_PR_URL: 'https://github.com/owner/repo/pull/123'
 * });
 */
export function loadPrompt(
  promptName: string,
  variables?: Record<string, string>
): string {
  let promptContent: string;

  // First, try to load from database (user-customized prompts)
  const dbPrompt = getPrompt(promptName);
  if (dbPrompt) {
    promptContent = dbPrompt.content;
  } else {
    // Fall back to filesystem
    const promptPath = path.join(process.cwd(), "prompts", `${promptName}.md`);

    if (!fs.existsSync(promptPath)) {
      throw new Error(`Prompt not found: ${promptName} (checked database and prompts/${promptName}.md)`);
    }

    // Read the prompt file
    promptContent = fs.readFileSync(promptPath, "utf-8");

    // Extract just the prompt body (between the header separator and variables section)
    // The format is: Header --- Body --- Variables
    const parts = promptContent.split("---");
    if (parts.length >= 2) {
      // Take everything after the first separator, up to the Variables section
      const bodyParts = parts.slice(1);
      // Find where the Variables section starts and exclude it
      const variablesIndex = bodyParts.findIndex((part) =>
        part.trim().startsWith("Variables:")
      );
      if (variablesIndex !== -1) {
        promptContent = bodyParts.slice(0, variablesIndex).join("---").trim();
      } else {
        promptContent = bodyParts.join("---").trim();
      }
    }
  }

  // Interpolate variables
  if (variables) {
    for (const [key, value] of Object.entries(variables)) {
      const placeholder = `{${key}}`;
      promptContent = promptContent.split(placeholder).join(value);
    }
  }

  return promptContent;
}

/**
 * Extracts metadata from a prompt, checking database first then filesystem.
 *
 * @param promptName - The name of the prompt
 * @returns Object containing model and purpose
 */
export function getPromptMetadata(promptName: string): {
  model?: string;
  purpose?: string;
} {
  // First, try to get metadata from database
  const dbPrompt = getPrompt(promptName);
  if (dbPrompt) {
    return {
      model: dbPrompt.model || undefined,
      purpose: dbPrompt.purpose || undefined,
    };
  }

  // Fall back to filesystem
  const promptPath = path.join(process.cwd(), "prompts", `${promptName}.md`);

  if (!fs.existsSync(promptPath)) {
    return {};
  }

  const content = fs.readFileSync(promptPath, "utf-8");
  const headerMatch = content.match(/^#.*?\n([\s\S]*?)---/);

  if (!headerMatch) {
    return {};
  }

  const header = headerMatch[1];
  const modelMatch = header.match(/Model:\s*(.+)/);
  const purposeMatch = header.match(/Purpose:\s*(.+)/);

  return {
    model: modelMatch ? modelMatch[1].trim() : undefined,
    purpose: purposeMatch ? purposeMatch[1].trim() : undefined,
  };
}

/**
 * Lists all available prompts in the prompts directory.
 *
 * @returns Array of prompt names (without .md extension)
 */
export function listPrompts(): string[] {
  const promptsDir = path.join(process.cwd(), "prompts");

  if (!fs.existsSync(promptsDir)) {
    return [];
  }

  return fs
    .readdirSync(promptsDir)
    .filter((file) => file.endsWith(".md") && file !== "README.md")
    .map((file) => file.replace(".md", ""));
}
