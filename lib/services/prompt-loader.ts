import * as fs from "fs";
import * as path from "path";
import { getPrompt, savePrompt } from "./database";

/**
 * Loads a prompt from the database first, falling back to file system.
 * Interpolates variables into the prompt content.
 *
 * @param promptName - The name of the prompt (without .md extension)
 * @param variables - Optional key-value pairs to interpolate into the prompt
 * @returns The interpolated prompt string
 * @throws Error if the prompt doesn't exist in database or file system
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

  // Try to load from database first
  const dbPrompt = getPrompt(promptName);

  if (dbPrompt) {
    // Use database content directly (already extracted body)
    promptContent = dbPrompt.content;
  } else {
    // Fall back to file system
    const promptPath = path.join(process.cwd(), "prompts", `${promptName}.md`);

    if (!fs.existsSync(promptPath)) {
      throw new Error(`Prompt not found: ${promptName}`);
    }

    // Read the prompt file
    let fileContent = fs.readFileSync(promptPath, "utf-8");

    // Extract metadata from header
    let model: string | null = null;
    let purpose: string | null = null;
    const headerMatch = fileContent.match(/^#.*?\n([\s\S]*?)---/);
    if (headerMatch) {
      const header = headerMatch[1];
      const modelMatch = header.match(/Model:\s*(.+)/);
      const purposeMatch = header.match(/Purpose:\s*(.+)/);
      model = modelMatch ? modelMatch[1].trim() : null;
      purpose = purposeMatch ? purposeMatch[1].trim() : null;
    }

    // Extract just the prompt body (between the header separator and variables section)
    const parts = fileContent.split("---");
    if (parts.length >= 2) {
      const bodyParts = parts.slice(1);
      const variablesIndex = bodyParts.findIndex((part) =>
        part.trim().startsWith("Variables:")
      );
      if (variablesIndex !== -1) {
        promptContent = bodyParts.slice(0, variablesIndex).join("---").trim();
      } else {
        promptContent = bodyParts.join("---").trim();
      }
    } else {
      promptContent = fileContent;
    }

    // Save to database for future use
    try {
      savePrompt(promptName, promptContent, model, purpose);
    } catch (e) {
      // Ignore save errors - file system is the fallback
      console.warn(`Failed to save prompt ${promptName} to database:`, e);
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
 * Extracts metadata from a prompt (database first, then file).
 *
 * @param promptName - The name of the prompt (without .md extension)
 * @returns Object containing model and purpose
 */
export function getPromptMetadata(promptName: string): {
  model?: string;
  purpose?: string;
} {
  // Try database first
  const dbPrompt = getPrompt(promptName);
  if (dbPrompt) {
    return {
      model: dbPrompt.model || undefined,
      purpose: dbPrompt.purpose || undefined,
    };
  }

  // Fall back to file system
  const promptPath = path.join(process.cwd(), "prompts", `${promptName}.md`);

  if (!fs.existsSync(promptPath)) {
    throw new Error(`Prompt not found: ${promptName}`);
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
 * Lists all available prompts (from database and file system).
 *
 * @returns Array of prompt names (without .md extension)
 */
export function listPrompts(): string[] {
  const { getAllPrompts } = require("./database");
  const dbPrompts = getAllPrompts();
  const dbNames = new Set<string>(dbPrompts.map((p: { name: string }) => p.name));

  // Also check file system for any prompts not yet in database
  const promptsDir = path.join(process.cwd(), "prompts");
  if (fs.existsSync(promptsDir)) {
    const fileNames = fs
      .readdirSync(promptsDir)
      .filter((file) => file.endsWith(".md") && file !== "README.md")
      .map((file) => file.replace(".md", ""));

    fileNames.forEach((name) => dbNames.add(name));
  }

  return Array.from(dbNames).sort();
}
