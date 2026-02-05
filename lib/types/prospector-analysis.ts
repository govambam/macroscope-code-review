/**
 * Shared client-safe types, constants, and helpers for analysis/email/Attio.
 *
 * IMPORTANT: Service files (pr-analyzer.ts, email-generator.ts) import server-only
 * modules (Octokit, anthropic SDK). We use `import type` to avoid bundling them
 * in client components. Runtime helpers are duplicated here.
 */

import type {
  PRAnalysisResult as _PRAnalysisResult,
  PRAnalysisResultV1 as _PRAnalysisResultV1,
  PRAnalysisResultV2 as _PRAnalysisResultV2,
  CommentCategory as _CommentCategory,
  AnalysisComment as _AnalysisComment,
  AnalysisSummary as _AnalysisSummary,
  BugSnippet as _BugSnippet,
  MeaningfulBugsResult as _MeaningfulBugsResult,
  NoMeaningfulBugsResult as _NoMeaningfulBugsResult,
} from "@/lib/services/pr-analyzer";

import type {
  EmailEntry as _EmailEntry,
  EmailSequence as _EmailSequence,
  EmailVariables as _EmailVariables,
  AllEmailVariables as _AllEmailVariables,
} from "@/lib/constants/email-templates";

import type {
  EmailBugInput as _EmailBugInput,
} from "@/lib/services/email-generator";

// Re-export types for convenience
export type PRAnalysisResult = _PRAnalysisResult;
export type PRAnalysisResultV1 = _PRAnalysisResultV1;
export type PRAnalysisResultV2 = _PRAnalysisResultV2;
export type CommentCategory = _CommentCategory;
export type AnalysisComment = _AnalysisComment;
export type AnalysisSummary = _AnalysisSummary;
export type BugSnippet = _BugSnippet;
export type MeaningfulBugsResult = _MeaningfulBugsResult;
export type NoMeaningfulBugsResult = _NoMeaningfulBugsResult;
export type EmailEntry = _EmailEntry;
export type EmailSequence = _EmailSequence;
export type EmailBugInput = _EmailBugInput;
export type EmailVariables = _EmailVariables;
export type AllEmailVariables = _AllEmailVariables;

// ── API response types (client-only, not in service layer) ──────────────

export interface AnalysisApiResponse {
  success: boolean;
  result?: PRAnalysisResult;
  error?: string;
  forkedPrUrl?: string;
  originalPrUrl?: string;
  originalPrTitle?: string;
  originalPrState?: "open" | "merged" | "closed";
  originalPrMergedAt?: string | null;
  cached?: boolean;
  analysisId?: number;
  cachedEmail?: string;
  needsOriginalPrUrl?: boolean;
  noCache?: boolean;
}

export interface EmailGenerationResponse {
  success: boolean;
  variables?: EmailVariables;
  dbVariables?: Omit<AllEmailVariables, keyof EmailVariables>;
  previews?: EmailSequence;
  error?: string;
  emailId?: number;
}

// ── CTO Perspective types ────────────────────────────────────────────────

export interface CTOPerspective {
  outreach_score: 1 | 2 | 3 | 4 | 5;  // 5 = perfect for outreach
  outreach_reasoning: string;          // Why this score
  cto_would_care: boolean;             // Would a CTO want to know about this?
  talking_point: string;               // How to frame in conversation
  is_recommended: boolean;             // This is the best bug for outreach
  recommendation_summary?: string;     // Why this bug over others (only on recommended)
}

export interface CTOAnalysisResult {
  perspectives: Record<number, CTOPerspective>;  // Keyed by comment index
  best_bug_index: number | null;
  overall_recommendation: string;  // Guidance for rep
  analysis_timestamp: string;
}

export interface CTOAnalysisApiResponse {
  success: boolean;
  result?: CTOAnalysisResult;
  error?: string;
  cached?: boolean;
}

export type EmailTabKey = "variables" | "email_1" | "email_2" | "email_3" | "email_4";

// ── Display constants ───────────────────────────────────────────────────

export const CATEGORY_COLORS: Record<CommentCategory, string> = {
  bug_critical: "bg-red-100 text-red-800 border-red-200",
  bug_high: "bg-orange-100 text-orange-800 border-orange-200",
  bug_medium: "bg-yellow-100 text-yellow-800 border-yellow-200",
  bug_low: "bg-blue-100 text-blue-800 border-blue-200",
  suggestion: "bg-purple-100 text-purple-800 border-purple-200",
  style: "bg-gray-100 text-gray-800 border-gray-200",
  nitpick: "bg-gray-100 text-gray-600 border-gray-200",
};

export const CATEGORY_LABELS: Record<CommentCategory, string> = {
  bug_critical: "Critical",
  bug_high: "High",
  bug_medium: "Medium",
  bug_low: "Low",
  suggestion: "Suggestion",
  style: "Style",
  nitpick: "Nitpick",
};

export const CATEGORY_ICONS: Record<CommentCategory, string> = {
  bug_critical: "\u{1F534}",
  bug_high: "\u{1F7E0}",
  bug_medium: "\u{1F7E1}",
  bug_low: "\u{1F535}",
  suggestion: "\u{1F4A1}",
  style: "\u{2728}",
  nitpick: "\u{1F4DD}",
};

export const SEVERITY_COLORS: Record<string, string> = {
  critical: "bg-red-100 text-red-800 border-red-200",
  high: "bg-orange-100 text-orange-800 border-orange-200",
  medium: "bg-yellow-100 text-yellow-800 border-yellow-200",
};

export const EMAIL_TABS: ReadonlyArray<{ key: EmailTabKey; label: string; desc: string }> = [
  { key: "variables", label: "Variables", desc: "CRM Export" },
  { key: "email_1", label: "Email 1", desc: "Simulated PR" },
  { key: "email_2", label: "Email 2", desc: "Scale of Review" },
  { key: "email_3", label: "Email 3", desc: "Macroscope Local" },
  { key: "email_4", label: "Email 4", desc: "Multi-Option Close" },
];

// ── Type guards (duplicated from pr-analyzer.ts for client safety) ──────

export function isV2Result(result: PRAnalysisResult): result is PRAnalysisResultV2 {
  return "all_comments" in result && "summary" in result;
}

export function isV1Result(result: PRAnalysisResult): result is PRAnalysisResultV1 {
  return "meaningful_bugs_found" in result;
}

export function resultHasMeaningfulBugs(result: PRAnalysisResult): boolean {
  if (isV2Result(result)) {
    return result.meaningful_bugs_count > 0;
  }
  return (result as { meaningful_bugs_found?: boolean }).meaningful_bugs_found === true;
}

export function getTotalBugCount(result: PRAnalysisResult): number {
  if (isV2Result(result)) {
    return result.meaningful_bugs_count;
  }
  if ((result as MeaningfulBugsResult).meaningful_bugs_found) {
    return (result as MeaningfulBugsResult).total_macroscope_bugs_found;
  }
  return 0;
}

export function getSeverityColor(severity: string): string {
  return SEVERITY_COLORS[severity] || "bg-gray-100 text-gray-800 border-gray-200";
}

// ── Bug conversion helpers ──────────────────────────────────────────────

interface ExtendedBugSnippet extends BugSnippet {
  explanation_short?: string;
  impact_scenario?: string;
  code_suggestion?: string;
  code_snippet_image_url?: string;
}

const SEVERITY_MAP: Partial<Record<CommentCategory, "critical" | "high" | "medium">> = {
  bug_critical: "critical",
  bug_high: "high",
  bug_medium: "medium",
  bug_low: "medium",
};

export function commentToBugSnippet(
  comment: AnalysisComment,
  isMostImpactful: boolean = false
): ExtendedBugSnippet {
  return {
    title: comment.title,
    explanation: comment.explanation,
    explanation_short: comment.explanation_short || undefined,
    impact_scenario: comment.impact_scenario || undefined,
    code_suggestion: comment.code_suggestion || undefined,
    code_snippet_image_url: comment.code_snippet_image_url || undefined,
    file_path: comment.file_path,
    severity: SEVERITY_MAP[comment.category] || "medium",
    is_most_impactful: isMostImpactful,
    macroscope_comment_text: comment.macroscope_comment_text,
  };
}

export function getBestBugForEmail(
  result: PRAnalysisResult,
  selectedBugIndex?: number | null
): ExtendedBugSnippet | null {
  if (isV2Result(result)) {
    // Use selected bug if provided
    if (selectedBugIndex != null) {
      const selected = result.all_comments.find((c) => c.index === selectedBugIndex);
      if (selected) return commentToBugSnippet(selected, true);
    }
    // Fall back to best bug for outreach
    if (result.best_bug_for_outreach_index !== null) {
      const best = result.all_comments.find(
        (c) => c.index === result.best_bug_for_outreach_index
      );
      if (best) return commentToBugSnippet(best, true);
    }
    // Fall back to first meaningful bug
    const firstMeaningful = result.all_comments.find((c) => c.is_meaningful_bug);
    if (firstMeaningful) return commentToBugSnippet(firstMeaningful, true);
    return null;
  }

  // V1 format
  if (!(result as MeaningfulBugsResult).meaningful_bugs_found) return null;
  const v1 = result as MeaningfulBugsResult;
  const mostImpactful = v1.bugs.find((bug) => bug.is_most_impactful);
  return mostImpactful || v1.bugs[0] || null;
}
