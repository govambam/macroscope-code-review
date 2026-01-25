import Anthropic from "@anthropic-ai/sdk";

// Default model for PR analysis
export const DEFAULT_MODEL = "claude-opus-4-20250514";

// Retry configuration
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 1000;

/**
 * Creates and returns an Anthropic client instance.
 * Throws an error if the API key is not configured.
 */
export function getAnthropicClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY environment variable is not set. " +
        "Please add it to your .env.local file."
    );
  }

  return new Anthropic({ apiKey });
}

/**
 * Waits for a specified number of milliseconds.
 */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Determines if an error is retryable (rate limit or temporary server error).
 */
function isRetryableError(error: unknown): boolean {
  if (error instanceof Anthropic.RateLimitError) {
    return true;
  }
  if (error instanceof Anthropic.APIError) {
    // Retry on 5xx server errors
    return error.status >= 500 && error.status < 600;
  }
  return false;
}

/**
 * Sends a message to Claude with retry logic for rate limits.
 *
 * @param prompt - The prompt to send to Claude
 * @param options - Optional configuration
 * @returns The text response from Claude
 * @throws Error if the API call fails after all retries
 */
export async function sendMessage(
  prompt: string,
  options: {
    model?: string;
    maxTokens?: number;
    temperature?: number;
  } = {}
): Promise<string> {
  const client = getAnthropicClient();
  const model = options.model || DEFAULT_MODEL;
  const maxTokens = options.maxTokens || 4096;
  const temperature = options.temperature ?? 0;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await client.messages.create({
        model,
        max_tokens: maxTokens,
        temperature,
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
      });

      // Extract text from response
      const textContent = response.content.find(
        (block) => block.type === "text"
      );
      if (!textContent || textContent.type !== "text") {
        throw new Error("No text content in response");
      }

      return textContent.text;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Check if we should retry
      if (isRetryableError(error) && attempt < MAX_RETRIES - 1) {
        // Exponential backoff: 1s, 2s, 4s
        const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt);
        console.log(
          `Rate limited or server error. Retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})...`
        );
        await wait(delay);
        continue;
      }

      // Not retryable or out of retries
      throw lastError;
    }
  }

  // This should never be reached, but TypeScript needs it
  throw lastError || new Error("Unknown error occurred");
}

/**
 * Checks if a JSON string appears to be complete (not truncated).
 * @param str - The string to check
 * @returns true if JSON looks complete, false if likely truncated
 */
function isCompleteJSON(str: string): boolean {
  const trimmed = str.trim();

  // Check if it ends with a closing brace or bracket
  if (!trimmed.endsWith("}") && !trimmed.endsWith("]")) {
    return false;
  }

  // Try to parse it - if it fails, it's likely truncated
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

/**
 * Extracts and parses JSON from a response that may contain markdown code fences
 * or other formatting. Handles special characters and newlines in string fields.
 *
 * @param response - The raw response string from Claude
 * @returns The parsed JSON object
 * @throws Error if parsing fails or response is truncated
 */
function extractAndParseJSON<T>(response: string): T {
  let jsonStr = response.trim();

  // Step 1: Extract JSON from markdown code fences if present
  // Match ```json ... ``` or just ``` ... ```
  const codeFenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeFenceMatch) {
    jsonStr = codeFenceMatch[1].trim();
  }

  // Step 2: Find the JSON object/array boundaries
  // This handles cases where there's extra text before/after the JSON
  const firstBrace = jsonStr.indexOf("{");
  const firstBracket = jsonStr.indexOf("[");

  let startIndex = -1;
  let isObject = true;

  if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
    startIndex = firstBrace;
    isObject = true;
  } else if (firstBracket !== -1) {
    startIndex = firstBracket;
    isObject = false;
  }

  if (startIndex !== -1) {
    // Find matching closing brace/bracket by counting nesting
    const openChar = isObject ? "{" : "[";
    const closeChar = isObject ? "}" : "]";
    let depth = 0;
    let inString = false;
    let escapeNext = false;

    for (let i = startIndex; i < jsonStr.length; i++) {
      const char = jsonStr[i];

      if (escapeNext) {
        escapeNext = false;
        continue;
      }

      if (char === "\\") {
        escapeNext = true;
        continue;
      }

      if (char === '"') {
        inString = !inString;
        continue;
      }

      if (!inString) {
        if (char === openChar) {
          depth++;
        } else if (char === closeChar) {
          depth--;
          if (depth === 0) {
            jsonStr = jsonStr.substring(startIndex, i + 1);
            break;
          }
        }
      }
    }
  }

  // Step 3: Check for truncation before parsing
  // If the JSON doesn't end properly, it was likely truncated
  if (!isCompleteJSON(jsonStr)) {
    const responseLength = response.length;
    throw new Error(
      `Claude response was truncated (${responseLength} chars). ` +
        `This usually means the PR has too many comments for the token limit. ` +
        `Try a PR with fewer Macroscope comments, or the analysis prompt may need optimization. ` +
        `Response ends with: "${jsonStr.slice(-100)}"`
    );
  }

  // Step 4: Try parsing the JSON
  try {
    return JSON.parse(jsonStr) as T;
  } catch (parseError) {
    // Log the error and raw response for debugging
    console.error("JSON parse error:", parseError);
    console.error("Attempted to parse:", jsonStr.substring(0, 1000));

    // Step 5: Try to fix common issues and retry
    try {
      // Sometimes there are control characters that break parsing
      // Remove control characters except newlines and tabs in strings
      let cleanedJson = jsonStr
        // eslint-disable-next-line no-control-regex
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");

      return JSON.parse(cleanedJson) as T;
    } catch {
      // If still failing, throw with helpful error
      throw new Error(
        `Failed to parse JSON response from Claude. ` +
          `Parse error: ${parseError instanceof Error ? parseError.message : "Unknown error"}. ` +
          `Raw response preview: ${response.substring(0, 500)}...`
      );
    }
  }
}

/**
 * Sends a message and parses the JSON response.
 *
 * @param prompt - The prompt to send to Claude
 * @param options - Optional configuration
 * @returns The parsed JSON response
 * @throws Error if the response is not valid JSON
 */
export async function sendMessageAndParseJSON<T>(
  prompt: string,
  options: {
    model?: string;
    maxTokens?: number;
    temperature?: number;
  } = {}
): Promise<T> {
  const response = await sendMessage(prompt, options);

  return extractAndParseJSON<T>(response);
}
