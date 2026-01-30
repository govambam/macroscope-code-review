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

// ============================================================================
// OLD FORMAT TYPES (schema version 1) - for backwards compatibility
// ============================================================================

/**
 * Result when no meaningful bugs are found (OLD FORMAT).
 */
export interface NoMeaningfulBugsResult {
  meaningful_bugs_found: false;
  reason: string;
  macroscope_comments_found?: number;
}

/**
 * Information about a single bug (OLD FORMAT).
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
 * Result when meaningful bugs are found (OLD FORMAT).
 */
export interface MeaningfulBugsResult {
  meaningful_bugs_found: true;
  bugs: BugSnippet[];
  total_macroscope_bugs_found: number;
  macroscope_comments_found?: number;
}

/**
 * Union type for old analysis results (schema version 1).
 */
export type PRAnalysisResultV1 = NoMeaningfulBugsResult | MeaningfulBugsResult;

// ============================================================================
// NEW FORMAT TYPES (schema version 2)
// ============================================================================

/**
 * Category for an analyzed comment.
 */
export type CommentCategory =
  | "bug_critical"
  | "bug_high"
  | "bug_medium"
  | "bug_low"
  | "suggestion"
  | "style"
  | "nitpick";

/**
 * A single analyzed comment from the new format.
 */
export interface AnalysisComment {
  index: number;
  macroscope_comment_text: string; // Populated server-side from GitHub API, not from Claude
  file_path: string;
  line_number: number | null;
  category: CommentCategory;
  title: string;
  explanation: string | null; // Full analysis for critical/high, null for others
  explanation_short: string | null; // Only for critical/high bugs
  impact_scenario: string | null; // Only for critical/high bugs
  code_suggestion: string | null;
  code_snippet_image_url?: string | null; // URL to syntax-highlighted code image
  is_meaningful_bug: boolean;
  outreach_ready: boolean;
  outreach_skip_reason: string | null; // Required when outreach_ready is false
}

/**
 * Summary of the analysis by severity and type.
 */
export interface AnalysisSummary {
  bugs_by_severity: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  non_bugs: {
    suggestions: number;
    style: number;
    nitpicks: number;
  };
  recommendation: string;
}

/**
 * New PR analysis response format (schema version 2).
 */
export interface PRAnalysisResultV2 {
  total_comments_processed: number;
  meaningful_bugs_count: number;
  outreach_ready_count: number;
  best_bug_for_outreach_index: number | null;
  all_comments: AnalysisComment[];
  summary: AnalysisSummary;
}

/**
 * Union type for all possible analysis results (supports both formats).
 * Use isV2AnalysisResult() to determine which format you have.
 */
export type PRAnalysisResult = PRAnalysisResultV1 | PRAnalysisResultV2;

/**
 * Type guard to check if result is the new format (V2).
 */
export function isV2AnalysisResult(result: PRAnalysisResult): result is PRAnalysisResultV2 {
  return "all_comments" in result && "summary" in result;
}

/**
 * Type guard to check if result is the old format (V1).
 */
export function isV1AnalysisResult(result: PRAnalysisResult): result is PRAnalysisResultV1 {
  return "meaningful_bugs_found" in result;
}

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
 * Maximum output tokens for PR analysis.
 *
 * Always use the model's maximum (16384 for Sonnet 4 / Opus 4).
 * There's no cost to setting this high — you only pay for tokens
 * actually generated. Dynamic calculation was causing truncation
 * when estimates were wrong.
 */
const MAX_ANALYSIS_TOKENS = 16384;

/**
 * Validates the new format (V2) analysis response.
 * Throws an error if validation fails.
 */
function validateV2Response(data: unknown): PRAnalysisResultV2 {
  if (!data || typeof data !== "object") {
    throw new Error("Response is not an object");
  }

  const response = data as Record<string, unknown>;

  // Check required top-level fields
  const requiredFields = [
    "total_comments_processed",
    "meaningful_bugs_count",
    "outreach_ready_count",
    "all_comments",
    "summary",
  ];

  for (const field of requiredFields) {
    if (!(field in response)) {
      throw new Error(`Missing required field: ${field}`);
    }
  }

  if (!Array.isArray(response.all_comments)) {
    throw new Error("all_comments must be an array");
  }

  // Validate each comment has required fields
  // Note: macroscope_comment_text and explanation are NOT required from Claude
  // (macroscope_comment_text is added server-side, explanation is null for Tier 2 comments)
  for (let i = 0; i < response.all_comments.length; i++) {
    const comment = response.all_comments[i] as Record<string, unknown>;
    const commentRequiredFields = [
      "index",
      "file_path",
      "category",
      "title",
      "is_meaningful_bug",
      "outreach_ready",
    ];

    for (const field of commentRequiredFields) {
      if (!(field in comment)) {
        throw new Error(`Comment ${i} missing required field: ${field}`);
      }
    }
  }

  // Validate summary structure
  const summary = response.summary as Record<string, unknown>;
  if (!summary || typeof summary !== "object") {
    throw new Error("summary must be an object");
  }

  if (!summary.bugs_by_severity || typeof summary.bugs_by_severity !== "object") {
    throw new Error("summary.bugs_by_severity is required");
  }

  if (!summary.recommendation || typeof summary.recommendation !== "string") {
    throw new Error("summary.recommendation is required");
  }

  return data as PRAnalysisResultV2;
}

/**
 * Validates the old format (V1) analysis response.
 * Throws an error if validation fails.
 */
function validateV1Response(result: PRAnalysisResultV1): void {
  if (typeof result.meaningful_bugs_found !== "boolean") {
    throw new Error("Invalid response: missing meaningful_bugs_found field");
  }

  if (result.meaningful_bugs_found) {
    const bugsResult = result as MeaningfulBugsResult;
    if (!bugsResult.bugs || !Array.isArray(bugsResult.bugs)) {
      throw new Error("Invalid response: missing bugs array for meaningful bugs");
    }
    if (bugsResult.bugs.length === 0) {
      throw new Error("Invalid response: bugs array is empty");
    }
    for (const bug of bugsResult.bugs) {
      if (!bug.title || !bug.explanation || !bug.file_path || !bug.severity) {
        throw new Error("Invalid response: bug missing required fields");
      }
    }
  } else {
    const nobugsResult = result as NoMeaningfulBugsResult;
    if (!nobugsResult.reason) {
      throw new Error("Invalid response: missing reason for no meaningful bugs");
    }
  }
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
    // No Macroscope comments found - return early with V1 format for consistency
    return {
      meaningful_bugs_found: false,
      reason: "No Macroscope review comments were found on this PR. The bot may not have reviewed it yet, or there were no issues to report.",
    };
  }

  // Format comments for the prompt
  const formattedComments = formatCommentsForPrompt(macroscopeComments);

  // Load the prompt and interpolate variables
  let prompt = loadPrompt("pr-analysis", {
    FORKED_PR_URL: forkedPrUrl,
    ORIGINAL_PR_URL: originalPrUrl,
    MACROSCOPE_COMMENTS: formattedComments,
    TOTAL_COMMENTS: macroscopeComments.length.toString(),
  });

  // Always append a token-saving directive. This ensures correct behavior
  // regardless of whether the prompt in the database is the old or new version.
  // macroscope_comment_text is populated server-side from GitHub API data.
  prompt += `\n\n---\n**CRITICAL OUTPUT RULES (override any conflicting instructions above):**\n1. Do NOT include "macroscope_comment_text" in your JSON output. It will be populated automatically.\n2. For comments that are NOT bug_critical or bug_high: set explanation, explanation_short, and impact_scenario to null. Still extract code_suggestion if Macroscope provided a fix.\n3. Keep your output as concise as possible to avoid truncation.`;

  // Get model from prompt metadata, fallback to default
  const metadata = getPromptMetadata("pr-analysis");
  const model = metadata.model || DEFAULT_MODEL;

  // Send to Claude and parse response
  const result = await sendMessageAndParseJSON<PRAnalysisResult>(prompt, {
    model,
    maxTokens: MAX_ANALYSIS_TOKENS,
    temperature: 0, // Deterministic output for analysis
  });

  // Determine which format we received and validate accordingly
  if (isV2AnalysisResult(result)) {
    // New format - validate V2 structure
    validateV2Response(result);

    // Post-process: merge original Macroscope comment text and fill defaults
    // Claude doesn't output macroscope_comment_text (to save tokens),
    // so we populate it from the GitHub API data we already fetched.
    for (const comment of result.all_comments) {
      const originalComment = macroscopeComments[comment.index];
      if (originalComment) {
        comment.macroscope_comment_text = originalComment.body;
      } else {
        comment.macroscope_comment_text = "";
      }

      // Ensure nullable fields have defaults for Tier 2 comments
      if (!("explanation" in comment) || comment.explanation === undefined) {
        comment.explanation = null;
      }
      if (!("explanation_short" in comment) || comment.explanation_short === undefined) {
        comment.explanation_short = null;
      }
      if (!("impact_scenario" in comment) || comment.impact_scenario === undefined) {
        comment.impact_scenario = null;
      }
      if (!("code_suggestion" in comment) || comment.code_suggestion === undefined) {
        comment.code_suggestion = null;
      }
      if (!("outreach_skip_reason" in comment) || comment.outreach_skip_reason === undefined) {
        comment.outreach_skip_reason = null;
      }
    }
  } else if (isV1AnalysisResult(result)) {
    // Old format - validate V1 structure
    validateV1Response(result);
  } else {
    throw new Error("Invalid response format: does not match V1 or V2 schema");
  }

  return result;
}

/**
 * Type guard to check if result has meaningful bugs (works with both formats).
 */
export function hasMeaningfulBugs(result: PRAnalysisResult): boolean {
  if (isV2AnalysisResult(result)) {
    return result.meaningful_bugs_count > 0;
  }
  return result.meaningful_bugs_found === true;
}

/**
 * Gets the most impactful bug from the analysis result (OLD FORMAT - V1).
 */
export function getMostImpactfulBug(result: MeaningfulBugsResult): BugSnippet | null {
  const mostImpactful = result.bugs.find(bug => bug.is_most_impactful);
  return mostImpactful || result.bugs[0] || null;
}

/**
 * Gets the best bug for outreach from the analysis result (NEW FORMAT - V2).
 * Returns null if no outreach-ready bug exists.
 */
export function getBestBugForOutreach(result: PRAnalysisResultV2): AnalysisComment | null {
  if (result.best_bug_for_outreach_index === null) {
    return null;
  }
  return result.all_comments.find(c => c.index === result.best_bug_for_outreach_index) || null;
}

/**
 * Gets all meaningful bugs from V2 result, sorted by severity.
 */
export function getMeaningfulBugsV2(result: PRAnalysisResultV2): AnalysisComment[] {
  const severityOrder: Record<CommentCategory, number> = {
    bug_critical: 0,
    bug_high: 1,
    bug_medium: 2,
    bug_low: 3,
    suggestion: 4,
    style: 5,
    nitpick: 6,
  };

  return result.all_comments
    .filter(c => c.is_meaningful_bug)
    .sort((a, b) => severityOrder[a.category] - severityOrder[b.category]);
}

/**
 * Gets outreach-ready comments from V2 result.
 */
export function getOutreachReadyComments(result: PRAnalysisResultV2): AnalysisComment[] {
  return result.all_comments.filter(c => c.outreach_ready);
}

/**
 * Converts a V2 AnalysisComment to a V1 BugSnippet for backwards compatibility.
 * Useful when existing code expects the old format.
 */
export function commentToBugSnippet(comment: AnalysisComment, isMostImpactful: boolean = false): BugSnippet {
  // Map V2 categories to V1 severity
  // Use Object.create(null) to prevent prototype pollution
  const severityMap: Record<string, "critical" | "high" | "medium"> = Object.create(null);
  severityMap["bug_critical"] = "critical";
  severityMap["bug_high"] = "high";
  severityMap["bug_medium"] = "medium";
  severityMap["bug_low"] = "medium";

  return {
    title: comment.title,
    explanation: comment.explanation || comment.macroscope_comment_text || "",
    file_path: comment.file_path,
    severity: Object.hasOwn(severityMap, comment.category) ? severityMap[comment.category] : "medium",
    is_most_impactful: isMostImpactful,
    macroscope_comment_text: comment.macroscope_comment_text,
  };
}

/**
 * Converts a V2 result to V1 format for backwards compatibility.
 * Useful when existing code expects the old format.
 */
export function convertV2ToV1(result: PRAnalysisResultV2): PRAnalysisResultV1 {
  const meaningfulBugs = getMeaningfulBugsV2(result);

  if (meaningfulBugs.length === 0) {
    return {
      meaningful_bugs_found: false,
      reason: result.summary.recommendation || "No meaningful bugs found in this PR.",
      macroscope_comments_found: result.total_comments_processed,
    };
  }

  const bestBugIndex = result.best_bug_for_outreach_index;
  const bugs = meaningfulBugs.map(comment =>
    commentToBugSnippet(comment, comment.index === bestBugIndex)
  );

  return {
    meaningful_bugs_found: true,
    bugs,
    total_macroscope_bugs_found: meaningfulBugs.length,
    macroscope_comments_found: result.total_comments_processed,
  };
}
