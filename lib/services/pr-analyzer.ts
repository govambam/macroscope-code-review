import { loadPrompt, getPromptMetadata } from "./prompt-loader";
import { sendMessageAndParseJSON, DEFAULT_MODEL } from "./anthropic";
import { Octokit } from "@octokit/rest";
import { config } from "../config";

/**
 * A review comment from Macroscope bot.
 */
export interface MacroscopeComment {
  id: number;
  path: string;
  line: number | null;
  body: string;
  diff_hunk: string;
  created_at: string;
}

/**
 * Result when no meaningful bugs are found.
 */
export interface NoMeaningfulBugsResult {
  meaningful_bugs_found: false;
  reason: string;
  macroscope_comments_found?: number;
}

/**
 * Information about a single bug.
 */
export interface BugSnippet {
  title: string;
  explanation: string;
  file_path: string;
  severity: "critical" | "high" | "medium";
  is_most_impactful: boolean;
  macroscope_comment_text?: string; // The original Macroscope comment
}

/**
 * Result when meaningful bugs are found.
 */
export interface MeaningfulBugsResult {
  meaningful_bugs_found: true;
  bugs: BugSnippet[];
  total_macroscope_bugs_found: number;
  macroscope_comments_found?: number;
}

/**
 * Union type for all possible analysis results.
 */
export type PRAnalysisResult = NoMeaningfulBugsResult | MeaningfulBugsResult;

/**
 * Input for PR analysis.
 */
export interface PRAnalysisInput {
  forkedPrUrl: string;
  originalPrUrl: string;
}

/**
 * Parsed PR URL components.
 */
interface ParsedPRUrl {
  owner: string;
  repo: string;
  prNumber: number;
}

/**
 * Validates that a URL is a valid GitHub PR URL.
 */
function isValidPRUrl(url: string): boolean {
  return /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/.test(url);
}

/**
 * Parses a GitHub PR URL into its components.
 */
function parsePRUrl(url: string): ParsedPRUrl | null {
  const match = url.match(/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/);
  if (!match) return null;
  return {
    owner: match[1],
    repo: match[2],
    prNumber: parseInt(match[3], 10),
  };
}

/**
 * Fetches review comments from Macroscope bot on a PR.
 */
async function fetchMacroscopeComments(
  owner: string,
  repo: string,
  prNumber: number
): Promise<MacroscopeComment[]> {
  const githubToken = config.githubToken;
  if (!githubToken) {
    throw new Error("GITHUB_BOT_TOKEN is required to fetch PR comments");
  }

  const octokit = new Octokit({ auth: githubToken });

  // Fetch review comments (comments on specific code lines)
  const { data: reviewComments } = await octokit.pulls.listReviewComments({
    owner,
    repo,
    pull_number: prNumber,
    per_page: 100,
  });

  // Filter for Macroscope bot comments
  const macroscopeComments = reviewComments
    .filter((comment) => comment.user?.login === "macroscopeapp[bot]")
    .map((comment) => ({
      id: comment.id,
      path: comment.path,
      line: comment.line || comment.original_line || null,
      body: comment.body,
      diff_hunk: comment.diff_hunk,
      created_at: comment.created_at,
    }));

  return macroscopeComments;
}

/**
 * Formats Macroscope comments for inclusion in the prompt.
 */
function formatCommentsForPrompt(comments: MacroscopeComment[]): string {
  if (comments.length === 0) {
    return "No Macroscope review comments found on this PR.";
  }

  return comments
    .map((comment, index) => {
      return `
### Comment ${index + 1}: ${comment.path}${comment.line ? `:${comment.line}` : ""}

**Code context:**
\`\`\`
${comment.diff_hunk}
\`\`\`

**Macroscope's finding:**
${comment.body}
`;
    })
    .join("\n---\n");
}

/**
 * Extracts the original PR URL from a forked PR URL by parsing the PR body.
 * This is a fallback if the original URL is not provided.
 */
export function extractOriginalPRUrl(prBody: string): string | null {
  // Look for patterns like "Original PR: https://github.com/..." or "Recreated from https://github.com/..."
  const patterns = [
    /Original PR:\s*(https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+)/i,
    /Recreated from\s*(https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+)/i,
    /\*\*Original PR:\*\*\s*(https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+)/i,
  ];

  for (const pattern of patterns) {
    const match = prBody.match(pattern);
    if (match) {
      return match[1];
    }
  }

  return null;
}

/**
 * Analyzes a PR using Claude to determine if Macroscope found meaningful bugs.
 *
 * This function:
 * 1. Fetches Macroscope's review comments from the forked PR via GitHub API
 * 2. Sends those comments to Claude for evaluation
 * 3. Claude determines which comments represent real, meaningful bugs
 *
 * @param input - The forked PR URL (with Macroscope comments) and original PR URL
 * @returns Analysis result indicating whether meaningful bugs were found
 * @throws Error if URLs are invalid or API call fails
 */
export async function analyzePR(input: PRAnalysisInput): Promise<PRAnalysisResult> {
  const { forkedPrUrl, originalPrUrl } = input;

  // Validate URLs
  if (!isValidPRUrl(forkedPrUrl)) {
    throw new Error(`Invalid forked PR URL: ${forkedPrUrl}`);
  }

  if (!isValidPRUrl(originalPrUrl)) {
    throw new Error(`Invalid original PR URL: ${originalPrUrl}`);
  }

  // Parse the forked PR URL to get owner/repo/number
  const parsed = parsePRUrl(forkedPrUrl);
  if (!parsed) {
    throw new Error(`Could not parse forked PR URL: ${forkedPrUrl}`);
  }

  // Fetch Macroscope comments from GitHub
  const macroscopeComments = await fetchMacroscopeComments(
    parsed.owner,
    parsed.repo,
    parsed.prNumber
  );

  if (macroscopeComments.length === 0) {
    // No Macroscope comments found - return early
    return {
      meaningful_bugs_found: false,
      reason: "No Macroscope review comments were found on this PR. The bot may not have reviewed it yet, or there were no issues to report.",
    };
  }

  // Format comments for the prompt
  const formattedComments = formatCommentsForPrompt(macroscopeComments);

  // Load the prompt and interpolate variables
  const prompt = loadPrompt("pr-analysis", {
    FORKED_PR_URL: forkedPrUrl,
    ORIGINAL_PR_URL: originalPrUrl,
    MACROSCOPE_COMMENTS: formattedComments,
    TOTAL_COMMENTS: macroscopeComments.length.toString(),
  });

  // Get model from prompt metadata, fallback to default
  const metadata = getPromptMetadata("pr-analysis");
  const model = metadata.model || DEFAULT_MODEL;

  // Send to Claude and parse response
  const result = await sendMessageAndParseJSON<PRAnalysisResult>(prompt, {
    model,
    maxTokens: 8192, // Increased for multiple bugs
    temperature: 0, // Deterministic output for analysis
  });

  // Validate the response structure
  if (typeof result.meaningful_bugs_found !== "boolean") {
    throw new Error("Invalid response: missing meaningful_bugs_found field");
  }

  if (result.meaningful_bugs_found) {
    // Validate MeaningfulBugsResult structure
    const bugsResult = result as MeaningfulBugsResult;
    if (!bugsResult.bugs || !Array.isArray(bugsResult.bugs)) {
      throw new Error("Invalid response: missing bugs array for meaningful bugs");
    }
    if (bugsResult.bugs.length === 0) {
      throw new Error("Invalid response: bugs array is empty");
    }
    // Validate each bug has required fields
    for (const bug of bugsResult.bugs) {
      if (!bug.title || !bug.explanation || !bug.file_path || !bug.severity) {
        throw new Error("Invalid response: bug missing required fields");
      }
    }
  } else {
    // Validate NoMeaningfulBugsResult structure
    const nobugsResult = result as NoMeaningfulBugsResult;
    if (!nobugsResult.reason) {
      throw new Error("Invalid response: missing reason for no meaningful bugs");
    }
  }

  return result;
}

/**
 * Type guard to check if result has meaningful bugs.
 */
export function hasMeaningfulBugs(
  result: PRAnalysisResult
): result is MeaningfulBugsResult {
  return result.meaningful_bugs_found === true;
}

/**
 * Gets the most impactful bug from the analysis result.
 */
export function getMostImpactfulBug(result: MeaningfulBugsResult): BugSnippet | null {
  const mostImpactful = result.bugs.find(bug => bug.is_most_impactful);
  return mostImpactful || result.bugs[0] || null;
}
