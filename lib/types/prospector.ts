import { PRCandidate, DiscoverResponse } from "./discover";

// PR Analysis types (imported from page.tsx patterns)
export type CommentCategory =
  | "bug_critical"
  | "bug_high"
  | "bug_medium"
  | "bug_low"
  | "suggestion"
  | "style"
  | "nitpick";

export interface AnalysisComment {
  index: number;
  macroscope_comment_text: string;
  file_path: string;
  line_number: number | null;
  category: CommentCategory;
  title: string;
  explanation: string;
  explanation_short: string | null;
  impact_scenario: string | null;
  code_suggestion: string | null;
  is_meaningful_bug: boolean;
  outreach_ready: boolean;
  outreach_skip_reason: string | null;
}

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

export interface PRAnalysisResultV2 {
  total_comments_processed: number;
  meaningful_bugs_count: number;
  outreach_ready_count: number;
  best_bug_for_outreach_index: number | null;
  all_comments: AnalysisComment[];
  summary: AnalysisSummary;
}

// V1 format for backwards compatibility
export interface BugSnippet {
  title: string;
  explanation: string;
  file_path: string;
  severity: "critical" | "high" | "medium";
  is_most_impactful: boolean;
  macroscope_comment_text?: string;
}

export interface NoMeaningfulBugsResult {
  meaningful_bugs_found: false;
  reason: string;
  macroscope_comments_found?: number;
}

export interface MeaningfulBugsResult {
  meaningful_bugs_found: true;
  bugs: BugSnippet[];
  total_macroscope_bugs_found: number;
  macroscope_comments_found?: number;
}

export type PRAnalysisResultV1 = NoMeaningfulBugsResult | MeaningfulBugsResult;
export type PRAnalysisResult = PRAnalysisResultV1 | PRAnalysisResultV2;

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
}

// Prospector-specific types
export type PRSimulationStatus =
  | "idle"
  | "queued"
  | "simulating"
  | "analyzing"
  | "complete"
  | "error";

export interface PRStatusInfo {
  status: PRSimulationStatus;
  progress?: string;
  error?: string;
}

export interface ProspectorState {
  // Section 1: Input
  repoUrl: string;
  searchMode: "fast" | "advanced";

  // Section 2: Candidates
  candidates: PRCandidate[];
  isDiscovering: boolean;
  discoveryError: string | null;
  discoveryResult: DiscoverResponse | null;

  // Multi-select
  selectedPRNumbers: Set<number>;

  // Simulation queue
  simulationQueue: number[];
  currentlySimulating: number | null;

  // Status per PR (keyed by PR number)
  prStatus: Record<number, PRStatusInfo>;

  // Results per PR (keyed by PR number)
  analysisResults: Record<number, AnalysisApiResponse | null>;
  generatedEmails: Record<number, string | null>;
  simulatedPRUrls: Record<number, string>;

  // Section 3: Currently viewing
  viewingPRNumber: number | null;
}

// Type guards
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
  return result.meaningful_bugs_found === true;
}

export function getTotalBugCount(result: PRAnalysisResult): number {
  if (isV2Result(result)) {
    return result.meaningful_bugs_count;
  }
  if (result.meaningful_bugs_found) {
    return result.total_macroscope_bugs_found;
  }
  return 0;
}

export function getOutreachReadyCount(result: PRAnalysisResult): number {
  if (isV2Result(result)) {
    return result.outreach_ready_count;
  }
  return 0;
}

// Extended BugSnippet for email generation
export interface ExtendedBugSnippet extends BugSnippet {
  explanation_short?: string;
  code_suggestion?: string;
}

export function commentToBugSnippet(
  comment: AnalysisComment,
  isMostImpactful: boolean = false
): ExtendedBugSnippet {
  const severityMap: Partial<Record<CommentCategory, "critical" | "high" | "medium">> = {
    bug_critical: "critical",
    bug_high: "high",
    bug_medium: "medium",
    bug_low: "medium",
  };

  return {
    title: comment.title,
    explanation: comment.explanation,
    explanation_short: comment.explanation_short || undefined,
    code_suggestion: comment.code_suggestion || undefined,
    file_path: comment.file_path,
    severity: severityMap[comment.category] || "medium",
    is_most_impactful: isMostImpactful,
    macroscope_comment_text: comment.macroscope_comment_text,
  };
}

export function getBestBugForEmail(result: PRAnalysisResult): ExtendedBugSnippet | null {
  if (isV2Result(result)) {
    // Find the best bug for outreach
    const bestIndex = result.best_bug_for_outreach_index;
    if (bestIndex !== null && result.all_comments[bestIndex]) {
      return commentToBugSnippet(result.all_comments[bestIndex], true);
    }
    // Fallback to first outreach-ready bug
    const outreachReady = result.all_comments.find(c => c.outreach_ready);
    if (outreachReady) {
      return commentToBugSnippet(outreachReady, true);
    }
    // Fallback to first meaningful bug
    const firstBug = result.all_comments.find(c => c.is_meaningful_bug);
    if (firstBug) {
      return commentToBugSnippet(firstBug, true);
    }
    return null;
  }

  // V1 format
  if (result.meaningful_bugs_found) {
    const mostImpactful = result.bugs.find(b => b.is_most_impactful);
    return mostImpactful || result.bugs[0] || null;
  }
  return null;
}
