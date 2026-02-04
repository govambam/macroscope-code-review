"use client";

import React, { useState, useCallback } from "react";
import {
  type AnalysisApiResponse,
  type PRAnalysisResultV2,
  type MeaningfulBugsResult,
  type NoMeaningfulBugsResult,
  isV2Result,
  resultHasMeaningfulBugs,
  CATEGORY_COLORS,
  CATEGORY_LABELS,
  CATEGORY_ICONS,
  getSeverityColor,
} from "@/lib/types/prospector-analysis";

/**
 * Cleans Macroscope comment text for display:
 * - Strips leading severity prefix (e.g. "🟢 **Medium** " or "🟡 **Medium")
 * - Removes inline code blocks (```...```)
 * - Removes the Macroscope CTA ("🚀 **Want me to fix this?...")
 */
function cleanCommentText(text: string): string {
  let cleaned = text;
  // Strip severity prefix — handle both "**Medium**" and "**Medium" (without closing **)
  cleaned = cleaned.replace(/^[^*]*\*\*(Critical|High|Medium|Low|Info)(\*\*)?\s*/i, "");
  // Remove fenced code blocks (```...```)
  cleaned = cleaned.replace(/```[\s\S]*?```/g, "");
  // Remove Macroscope CTA (🚀 Want me to fix this? ...)
  cleaned = cleaned.replace(/\s*>?\s*🚀\s*\*?\*?Want me to fix this\?[\s\S]*$/, "");
  return cleaned.trim();
}

interface AnalysisSectionProps {
  forkedPrUrl: string;
  onAnalysisComplete: (data: {
    analysisResult: AnalysisApiResponse;
    analysisId: number | null;
    selectedBugIndex: number | null;
  }) => void;
  onGenerateEmailClick: () => void;
  onBackToPRSelection?: () => void;
}

export function AnalysisSection({
  forkedPrUrl,
  onAnalysisComplete,
  onGenerateEmailClick,
  onBackToPRSelection,
}: AnalysisSectionProps) {
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AnalysisApiResponse | null>(null);
  const [selectedBugIndex, setSelectedBugIndex] = useState<number | null>(null);
  const [copiedBugIndex, setCopiedBugIndex] = useState<number | null>(null);
  const [currentAnalysisId, setCurrentAnalysisId] = useState<number | null>(null);
  const [isViewingCached, setIsViewingCached] = useState(false);
  const [showUrlPrompt, setShowUrlPrompt] = useState(false);
  const [analysisOriginalUrl, setAnalysisOriginalUrl] = useState("");
  const [pendingForceRefresh, setPendingForceRefresh] = useState(false);
  const [hasRun, setHasRun] = useState(false);

  const runAnalysis = useCallback(
    async (forceRefresh = false) => {
      setHasRun(true);
      setAnalysisLoading(true);
      setAnalysisResult(null);
      setSelectedBugIndex(null);
      setCopiedBugIndex(null);
      setCurrentAnalysisId(null);
      setIsViewingCached(false);
      setShowUrlPrompt(false);

      try {
        const res = await fetch("/api/get-macroscope-review", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            forkedPrUrl,
            originalPrUrl: analysisOriginalUrl || undefined,
            forceRefresh,
          }),
        });

        const data: AnalysisApiResponse = await res.json();

        if (data.needsOriginalPrUrl) {
          setShowUrlPrompt(true);
          setPendingForceRefresh(forceRefresh);
          setAnalysisLoading(false);
          return;
        }

        setAnalysisResult(data);

        const bugIdx: number | null = null;
        // Don't auto-select a bug — let the user choose explicitly

        if (data.analysisId) {
          setCurrentAnalysisId(data.analysisId);
        }
        if (data.cached) {
          setIsViewingCached(true);
        }

        onAnalysisComplete({
          analysisResult: data,
          analysisId: data.analysisId ?? null,
          selectedBugIndex: bugIdx,
        });
      } catch (error) {
        const errorResult: AnalysisApiResponse = {
          success: false,
          error: error instanceof Error ? error.message : "Analysis failed",
        };
        setAnalysisResult(errorResult);
      } finally {
        setAnalysisLoading(false);
      }
    },
    [forkedPrUrl, analysisOriginalUrl, onAnalysisComplete]
  );

  function handleOriginalUrlSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!analysisOriginalUrl.trim()) return;
    setShowUrlPrompt(false);
    runAnalysis(pendingForceRefresh);
  }

  function handleBugSelect(bugIndex: number) {
    setSelectedBugIndex(bugIndex);
    // Notify parent of selection change
    if (analysisResult) {
      onAnalysisComplete({
        analysisResult,
        analysisId: currentAnalysisId,
        selectedBugIndex: bugIndex,
      });
    }
  }

  async function copyBugExplanation(text: string, index: number) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedBugIndex(index);
      setTimeout(() => setCopiedBugIndex(null), 2000);
    } catch {
      // Clipboard not available
    }
  }

  // ── Loading skeleton ──────────────────────────────────────────────────

  if (analysisLoading) {
    return (
      <div className="space-y-6">
        <div>
          <div className="h-6 bg-gray-200 rounded w-32 mb-3 animate-pulse" />
          <div className="space-y-2">
            <div className="h-4 bg-gray-200 rounded w-full animate-pulse" />
            <div className="h-4 bg-gray-200 rounded w-5/6 animate-pulse" />
            <div className="h-4 bg-gray-200 rounded w-4/5 animate-pulse" />
          </div>
        </div>
        <div>
          <div className="h-6 bg-gray-200 rounded w-48 mb-3 animate-pulse" />
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="border border-gray-200 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="h-5 w-16 bg-gray-200 rounded-full animate-pulse" />
                  <div className="h-5 w-48 bg-gray-200 rounded animate-pulse" />
                </div>
                <div className="space-y-2">
                  <div className="h-4 bg-gray-200 rounded w-full animate-pulse" />
                  <div className="h-4 bg-gray-200 rounded w-full animate-pulse" />
                  <div className="h-4 bg-gray-200 rounded w-2/3 animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="pt-4 border-t border-gray-200">
          <div className="flex items-center justify-center gap-2 text-sm text-gray-500">
            <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            <span>Fetching Macroscope review...</span>
          </div>
        </div>
      </div>
    );
  }

  // ── URL prompt ────────────────────────────────────────────────────────

  if (showUrlPrompt) {
    return (
      <div className="py-6 px-4">
        <div className="max-w-md mx-auto">
          <div className="text-center mb-6">
            <svg className="mx-auto h-12 w-12 text-amber-500 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
            <h3 className="text-lg font-medium text-accent mb-2">Original PR URL Required</h3>
            <p className="text-sm text-text-secondary">
              We couldn&apos;t determine the original PR URL automatically. Please enter it below to continue.
            </p>
          </div>
          <form onSubmit={handleOriginalUrlSubmit} className="space-y-4">
            <div>
              <label htmlFor="original-pr-url" className="block text-sm font-medium text-text-primary mb-1">
                Original PR URL
              </label>
              <input
                id="original-pr-url"
                type="url"
                value={analysisOriginalUrl}
                onChange={(e) => setAnalysisOriginalUrl(e.target.value)}
                placeholder="https://github.com/owner/repo/pull/123"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary text-sm"
                autoFocus
              />
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setShowUrlPrompt(false)}
                className="flex-1 px-4 py-2 border border-gray-300 text-text-secondary hover:bg-gray-50 font-medium rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!analysisOriginalUrl.trim()}
                className="flex-1 px-4 py-2 bg-primary hover:bg-primary-hover disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
              >
                Continue Analysis
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  // ── Not yet run ──────────────────────────────────────────────────────

  if (!hasRun && !analysisResult) {
    return (
      <div className="space-y-5">
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <svg className="h-6 w-6 text-blue-600 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <h3 className="font-medium text-blue-800">Waiting for Macroscope Review</h3>
              <p className="text-sm text-blue-700 mt-1">
                The Macroscope bot needs time to review the PR and leave comments before analysis can find bugs.
                This typically takes 1-3 minutes after the PR is created.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => runAnalysis()}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary hover:bg-primary-hover text-white font-medium rounded-lg transition-colors"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Get Macroscope Review
          </button>
          <span className="text-xs text-text-muted">
            Fetch Macroscope review comments
          </span>
        </div>

        {forkedPrUrl && (
          <p className="text-xs text-text-muted">
            PR:{" "}
            <a href={forkedPrUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
              {forkedPrUrl.replace("https://github.com/", "")}
            </a>
          </p>
        )}
      </div>
    );
  }

  if (!analysisResult) {
    return (
      <div className="text-center py-8">
        <p className="text-sm text-text-muted italic">Waiting for analysis to start...</p>
      </div>
    );
  }

  // ── Error state ───────────────────────────────────────────────────────

  if (!analysisResult.success || !analysisResult.result) {
    return (
      <div className="space-y-4">
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm font-medium text-red-800">Analysis Failed</p>
          <p className="text-sm text-red-700 mt-1">{analysisResult.error || "An unexpected error occurred."}</p>
        </div>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => runAnalysis()}
            className="px-4 py-2 text-sm font-medium text-white bg-primary hover:bg-primary-hover rounded-lg transition-colors"
          >
            Try Again
          </button>
          {onBackToPRSelection && (
            <button
              type="button"
              onClick={onBackToPRSelection}
              className="px-4 py-2 text-sm font-medium text-text-secondary border border-border rounded-lg hover:bg-gray-50 transition-colors"
            >
              Back to PR Selection
            </button>
          )}
        </div>
      </div>
    );
  }

  // ── Analysis results ──────────────────────────────────────────────────

  const result = analysisResult.result;
  const hasBugs = resultHasMeaningfulBugs(result);

  return (
    <div className="space-y-6">
      {/* Cache indicator */}
      {isViewingCached && (
        <div className="flex items-center justify-between bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
          <div className="flex items-center gap-2 text-blue-700">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-sm font-medium">Viewing cached analysis</span>
          </div>
          <button
            onClick={() => runAnalysis(true)}
            className="text-sm text-blue-700 hover:text-blue-800 font-medium underline"
          >
            Regenerate
          </button>
        </div>
      )}

      {hasBugs ? (
        <>
          {/* V2 format display */}
          {isV2Result(result) ? (
            <>
              {/* Summary header */}
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <div className="flex items-center gap-2 text-amber-800">
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <span className="font-semibold">
                      {result.total_comments_processed} comments analyzed
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <span className="text-amber-700">
                      {result.meaningful_bugs_count} meaningful bug{result.meaningful_bugs_count !== 1 ? "s" : ""}
                    </span>
                    {result.outreach_ready_count > 0 && (
                      <span className="text-green-700">
                        {result.outreach_ready_count} outreach ready
                      </span>
                    )}
                  </div>
                </div>
                {result.summary.recommendation && (
                  <p className="mt-3 text-sm text-amber-800 border-t border-amber-200 pt-3">
                    <span className="font-medium">Recommendation:</span> {result.summary.recommendation}
                  </p>
                )}
              </div>

              {/* Comment cards */}
              <div className="space-y-4">
                {result.all_comments.map((comment, index) => {
                  const isBestForOutreach = comment.index === (result as PRAnalysisResultV2).best_bug_for_outreach_index;
                  const isSelected = comment.index === selectedBugIndex;

                  return (
                    <div
                      key={index}
                      onClick={comment.is_meaningful_bug ? () => handleBugSelect(comment.index) : undefined}
                      className={`border rounded-lg overflow-hidden transition-colors ${
                        isSelected ? "border-primary ring-1 ring-primary/20" : "border-border"
                      } ${comment.is_meaningful_bug ? "cursor-pointer hover:border-primary/50" : ""}`}
                    >
                      <div className="px-4 py-3 bg-bg-subtle border-b border-border flex items-center justify-between">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`px-2 py-0.5 text-xs font-medium rounded border ${CATEGORY_COLORS[comment.category]}`}>
                            {CATEGORY_ICONS[comment.category]} {CATEGORY_LABELS[comment.category]}
                          </span>
                          {comment.is_meaningful_bug && (
                            <span className="px-2 py-0.5 text-xs font-medium rounded bg-amber-100 text-amber-800 border border-amber-200">
                              Bug
                            </span>
                          )}
                          {comment.outreach_ready && (
                            <span className="px-2 py-0.5 text-xs font-medium rounded bg-green-100 text-green-800 border border-green-200">
                              Outreach Ready
                            </span>
                          )}
                          {isBestForOutreach && (
                            <span className="px-2 py-0.5 text-xs font-medium rounded bg-primary/10 text-primary border border-primary/20">
                              Best for Outreach
                            </span>
                          )}
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            copyBugExplanation(comment.explanation, index);
                          }}
                          className="text-xs text-text-secondary hover:text-accent flex items-center gap-1"
                        >
                          {copiedBugIndex === index ? (
                            <>
                              <svg className="h-4 w-4 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                              Copied!
                            </>
                          ) : (
                            <>
                              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                              </svg>
                              Copy
                            </>
                          )}
                        </button>
                      </div>
                      <div className="p-4">
                        {cleanCommentText(comment.title) && (
                          <h4 className="font-medium text-accent mb-2">{cleanCommentText(comment.title)}</h4>
                        )}
                        <p className="text-sm text-text-secondary mb-3">{cleanCommentText(comment.explanation)}</p>
                        {comment.impact_scenario && (
                          <p className="text-sm text-amber-700 bg-amber-50 p-2 rounded mb-3">
                            <span className="font-medium">Impact:</span> {comment.impact_scenario}
                          </p>
                        )}
                        {comment.code_snippet_image_url ? (
                          <div className="mb-3">
                            <p className="text-xs text-text-muted mb-1">Suggested fix:</p>
                            <img
                              src={comment.code_snippet_image_url}
                              alt="Code suggestion"
                              className="max-w-full rounded shadow-sm"
                            />
                          </div>
                        ) : comment.code_suggestion ? (
                          <div className="mb-3">
                            <p className="text-xs text-text-muted mb-1">Suggested fix:</p>
                            <div className="text-xs rounded border border-gray-200 overflow-x-auto font-mono">
                              {comment.code_suggestion.split("\n").map((line, i) => {
                                const isRemoval = line.startsWith("-");
                                const isAddition = line.startsWith("+");
                                const isHunkHeader = line.startsWith("@@");
                                return (
                                  <div
                                    key={i}
                                    className={
                                      isRemoval
                                        ? "bg-red-50 text-red-800 px-2 py-px"
                                        : isAddition
                                          ? "bg-green-50 text-green-800 px-2 py-px"
                                          : isHunkHeader
                                            ? "bg-blue-50 text-blue-700 px-2 py-px"
                                            : "bg-gray-50 px-2 py-px"
                                    }
                                  >
                                    <pre className="whitespace-pre">{line || " "}</pre>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ) : null}
                        <div className="flex items-center gap-2 flex-wrap">
                          <div className="text-xs text-text-muted font-mono bg-bg-subtle px-2 py-1 rounded">
                            {comment.file_path}{comment.line_number ? `:${comment.line_number}` : ""}
                          </div>
                          {!comment.outreach_ready && comment.outreach_skip_reason && (
                            <div className="text-xs text-gray-500 italic">
                              Skip reason: {comment.outreach_skip_reason}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            /* V1 format display */
            <>
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                <div className="flex items-center gap-2 text-amber-800">
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <span className="font-semibold">
                    Found {(result as MeaningfulBugsResult).total_macroscope_bugs_found} bug
                    {(result as MeaningfulBugsResult).total_macroscope_bugs_found !== 1 ? "s" : ""}
                  </span>
                </div>
              </div>
              <div className="space-y-4">
                {(result as MeaningfulBugsResult).bugs.map((bug, index) => (
                  <div
                    key={index}
                    className={`border rounded-lg overflow-hidden ${
                      bug.is_most_impactful ? "border-primary ring-1 ring-primary/20" : "border-border"
                    }`}
                  >
                    <div className="px-4 py-3 bg-bg-subtle border-b border-border flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 text-xs font-medium rounded border ${getSeverityColor(bug.severity)}`}>
                          {bug.severity}
                        </span>
                        {bug.is_most_impactful && (
                          <span className="px-2 py-0.5 text-xs font-medium rounded bg-primary/10 text-primary border border-primary/20">
                            Most Impactful
                          </span>
                        )}
                      </div>
                      <button
                        onClick={() => copyBugExplanation(bug.explanation, index)}
                        className="text-xs text-text-secondary hover:text-accent flex items-center gap-1"
                      >
                        {copiedBugIndex === index ? (
                          <>
                            <svg className="h-4 w-4 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                            Copied!
                          </>
                        ) : (
                          <>
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                            </svg>
                            Copy
                          </>
                        )}
                      </button>
                    </div>
                    <div className="p-4">
                      <h4 className="font-medium text-accent mb-2">{bug.title}</h4>
                      <p className="text-sm text-text-secondary mb-3">{bug.explanation}</p>
                      <div className="text-xs text-text-muted font-mono bg-bg-subtle px-2 py-1 rounded inline-block">
                        {bug.file_path}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Generate Email Sequence button */}
          <div className="border-t border-border pt-5">
            {selectedBugIndex === null && (
              <p className="text-sm text-text-muted mb-3">
                Select a bug above to generate an email sequence for outreach.
              </p>
            )}
            <button
              type="button"
              onClick={onGenerateEmailClick}
              disabled={selectedBugIndex === null}
              className={`inline-flex items-center gap-2 px-5 py-2.5 font-medium rounded-lg transition-colors ${
                selectedBugIndex === null
                  ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                  : "bg-primary hover:bg-primary-hover text-white"
              }`}
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              Generate Email Sequence
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </button>
          </div>
        </>
      ) : (
        /* No meaningful bugs */
        <div className="space-y-6">
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <div className="flex items-center gap-3">
              <svg className="h-6 w-6 text-green-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div>
                <h3 className="font-medium text-green-800">No Meaningful Bugs Found</h3>
                <p className="text-sm text-green-700 mt-1">
                  {isV2Result(result)
                    ? result.summary.recommendation
                    : (result as NoMeaningfulBugsResult).reason}
                </p>
              </div>
            </div>
            {isV2Result(result) && result.all_comments.length > 0 && (
              <p className="text-xs text-green-600 mt-3 pt-3 border-t border-green-200">
                {result.total_comments_processed} comment{result.total_comments_processed !== 1 ? "s" : ""} analyzed below
              </p>
            )}
          </div>

          {/* Show all comments even when no meaningful bugs (V2 only) */}
          {isV2Result(result) && result.all_comments.length > 0 && (
            <div className="space-y-4">
              <h4 className="text-sm font-medium text-text-secondary">All Macroscope Comments</h4>
              {result.all_comments.map((comment, index) => (
                <div key={index} className="border border-border rounded-lg overflow-hidden opacity-75">
                  <div className="px-4 py-3 bg-bg-subtle border-b border-border flex items-center justify-between">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`px-2 py-0.5 text-xs font-medium rounded border ${CATEGORY_COLORS[comment.category]}`}>
                        {CATEGORY_ICONS[comment.category]} {CATEGORY_LABELS[comment.category]}
                      </span>
                    </div>
                    <button
                      onClick={() => copyBugExplanation(comment.explanation, index)}
                      className="text-xs text-text-secondary hover:text-accent flex items-center gap-1"
                    >
                      {copiedBugIndex === index ? (
                        <>
                          <svg className="h-4 w-4 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                          Copied!
                        </>
                      ) : (
                        <>
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                          Copy
                        </>
                      )}
                    </button>
                  </div>
                  <div className="p-4">
                    {cleanCommentText(comment.title) && (
                      <h4 className="font-medium text-accent mb-2">{cleanCommentText(comment.title)}</h4>
                    )}
                    <p className="text-sm text-text-secondary mb-3">{cleanCommentText(comment.explanation)}</p>
                    <div className="text-xs text-text-muted font-mono bg-bg-subtle px-2 py-1 rounded inline-block">
                      {comment.file_path}{comment.line_number ? `:${comment.line_number}` : ""}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="border-t border-border pt-5">
            <p className="text-sm text-text-secondary mb-3">
              No bugs suitable for outreach were found. Consider simulating a different PR.
            </p>
            {onBackToPRSelection && (
              <button
                type="button"
                onClick={onBackToPRSelection}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-text-secondary border border-border rounded-lg hover:bg-gray-50 transition-colors"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11 17l-5-5m0 0l5-5m-5 5h12" />
                </svg>
                Back to PR Selection
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
