"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { PRCandidate, DiscoverResponse } from "@/lib/types/discover";

const MAX_SELECTIONS = 10;

interface PRScoreDisplayProps {
  overall: number;
  complexity: number;
  recency: number;
}

function PRScoreDisplay({ overall, complexity, recency }: PRScoreDisplayProps) {
  const [showTooltip, setShowTooltip] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleMouseEnter = () => {
    timeoutRef.current = setTimeout(() => {
      setShowTooltip(true);
    }, 500);
  };

  const handleMouseLeave = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    setShowTooltip(false);
  };

  return (
    <div
      className="relative inline-block"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <span className="text-sm font-semibold text-gray-900">
        Score: {overall}
      </span>

      {showTooltip && (
        <div className="absolute z-50 right-0 top-full mt-2 bg-gray-900 text-white text-xs rounded-lg shadow-lg p-3 min-w-[180px]">
          <div className="font-semibold mb-2 border-b border-gray-700 pb-2">
            Overall Score: {overall}
          </div>
          <div className="space-y-1.5">
            <div className="flex justify-between">
              <span className="text-gray-300">Complexity:</span>
              <span className="font-medium">{complexity}/100</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-300">Recency:</span>
              <span className="font-medium">{recency}/100</span>
            </div>
          </div>
          <div className="absolute -top-1 right-4 w-2 h-2 bg-gray-900 transform rotate-45" />
        </div>
      )}
    </div>
  );
}

interface SimulationProgress {
  total: number;
  completed: number;
  current: string | null;
  errors: string[];
}

export function DiscoverPRs({ onSelectPR }: { onSelectPR?: (prUrl: string) => void }) {
  const router = useRouter();
  const [repoUrl, setRepoUrl] = useState("");
  const [mode, setMode] = useState<"fast" | "advanced">("fast");
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState<DiscoverResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Filter state
  const [includeOpen, setIncludeOpen] = useState(true);
  const [includeMerged, setIncludeMerged] = useState(true);
  const [mergedWithinDays, setMergedWithinDays] = useState(30);
  const [minLinesChanged, setMinLinesChanged] = useState(50);
  const [showFilters, setShowFilters] = useState(false);

  // Multi-select state
  const [selectedPRs, setSelectedPRs] = useState<Set<string>>(new Set());
  const [isSimulating, setIsSimulating] = useState(false);
  const [simulationProgress, setSimulationProgress] = useState<SimulationProgress | null>(null);

  async function handleDiscover() {
    if (!repoUrl.trim()) return;

    setIsLoading(true);
    setError(null);
    setResults(null);
    setSelectedPRs(new Set());

    try {
      const response = await fetch("/api/discover-prs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repo_url: repoUrl,
          mode,
          filters: {
            include_open: includeOpen,
            include_merged: includeMerged,
            merged_within_days: mergedWithinDays,
            min_lines_changed: minLinesChanged,
            max_results: 10,
          },
        }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Failed to discover PRs");
      }

      const data: DiscoverResponse = await response.json();
      setResults(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  }

  const handleToggleSelect = useCallback((prUrl: string) => {
    setSelectedPRs((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(prUrl)) {
        newSet.delete(prUrl);
      } else {
        if (newSet.size >= MAX_SELECTIONS) {
          return prev;
        }
        newSet.add(prUrl);
      }
      return newSet;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    if (!results) return;
    const maxSelectable = Math.min(results.candidates.length, MAX_SELECTIONS);
    if (selectedPRs.size === maxSelectable) {
      setSelectedPRs(new Set());
    } else {
      const limited = results.candidates.slice(0, MAX_SELECTIONS).map((pr) => pr.html_url);
      setSelectedPRs(new Set(limited));
    }
  }, [results, selectedPRs.size]);

  const handleSimulateSelected = async () => {
    if (selectedPRs.size === 0) return;

    setIsSimulating(true);
    setSimulationProgress({
      total: selectedPRs.size,
      completed: 0,
      current: null,
      errors: [],
    });

    try {
      // Get unique repos from selected PRs for caching
      const repos = new Set<string>();
      selectedPRs.forEach((prUrl) => {
        const match = prUrl.match(/github\.com\/([^\/]+\/[^\/]+)/);
        if (match) {
          repos.add(match[1]);
        }
      });

      // Cache all repos first (parallel)
      setSimulationProgress((prev) => prev ? { ...prev, current: "Caching repositories..." } : null);

      const cachePromises = Array.from(repos).map((repo) =>
        fetch("/api/cache/clone", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            repoUrl: `https://github.com/${repo}`,
            shallow: true
          }),
        }).catch(() => null) // Ignore cache errors, simulation can still work
      );

      await Promise.all(cachePromises);

      // Simulate PRs sequentially (to avoid overwhelming the system)
      const prUrls = Array.from(selectedPRs);
      const errors: string[] = [];

      for (let i = 0; i < prUrls.length; i++) {
        const prUrl = prUrls[i];
        const prMatch = prUrl.match(/\/pull\/(\d+)/);
        const prNumber = prMatch ? prMatch[1] : prUrl;

        setSimulationProgress((prev) => prev ? {
          ...prev,
          current: `Simulating PR #${prNumber}...`,
          completed: i,
        } : null);

        try {
          const response = await fetch("/api/create-pr", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              prUrl,
              cacheRepo: true,
            }),
          });

          // Read SSE stream to completion, accumulating content
          if (response.body) {
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let streamContent = "";
            let done = false;

            while (!done) {
              const { value, done: readerDone } = await reader.read();
              done = readerDone;
              if (value) {
                streamContent += decoder.decode(value, { stream: !done });
              }
            }

            // Check for errors in accumulated stream content
            if (streamContent.includes('"type":"error"')) {
              const errorMatch = streamContent.match(/"message":"([^"]+)"/);
              if (errorMatch) {
                errors.push(`PR #${prNumber}: ${errorMatch[1]}`);
              }
            }
          }
        } catch (err) {
          errors.push(`PR #${prNumber}: ${err instanceof Error ? err.message : "Unknown error"}`);
        }
      }

      setSimulationProgress((prev) => prev ? {
        ...prev,
        completed: prUrls.length,
        current: null,
        errors,
      } : null);

      // Navigate to PR Reviews page after a short delay
      setTimeout(() => {
        router.push("/");
        router.refresh();
      }, 1500);

    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to simulate selected PRs");
    } finally {
      setIsSimulating(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Input Section */}
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            GitHub Repository
          </label>
          <input
            type="text"
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
            placeholder="owner/repo or https://github.com/owner/repo"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            onKeyDown={(e) => e.key === "Enter" && handleDiscover()}
            disabled={isSimulating}
          />
        </div>

        {/* Search Mode Toggle */}
        <div className="flex items-center gap-4 flex-wrap">
          <span className="text-sm font-medium text-gray-700">Search mode:</span>
          <div className="flex rounded-lg border border-gray-300 overflow-hidden">
            <button
              onClick={() => setMode("fast")}
              disabled={isSimulating}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                mode === "fast"
                  ? "bg-indigo-600 text-white"
                  : "bg-white text-gray-700 hover:bg-gray-50"
              } disabled:opacity-50`}
            >
              Fast
            </button>
            <button
              onClick={() => setMode("advanced")}
              disabled={isSimulating}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                mode === "advanced"
                  ? "bg-indigo-600 text-white"
                  : "bg-white text-gray-700 hover:bg-gray-50"
              } disabled:opacity-50`}
            >
              Advanced
            </button>
          </div>
          <span className="text-xs text-gray-500">
            {mode === "fast" ? "~5 seconds" : "~15 seconds, uses AI analysis"}
          </span>
        </div>

        {/* Filters (collapsible) */}
        <div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            disabled={isSimulating}
            className="text-sm text-indigo-600 hover:text-indigo-800 flex items-center gap-1 disabled:opacity-50"
          >
            <svg
              className={`w-4 h-4 transition-transform ${showFilters ? "rotate-90" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
            {showFilters ? "Hide filters" : "Show filters"}
          </button>

          {showFilters && (
            <div className="mt-3 p-4 bg-gray-50 rounded-lg grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeOpen}
                  onChange={(e) => setIncludeOpen(e.target.checked)}
                  disabled={isSimulating}
                  className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span className="text-sm">Include open PRs</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeMerged}
                  onChange={(e) => setIncludeMerged(e.target.checked)}
                  disabled={isSimulating}
                  className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span className="text-sm">Include merged PRs</span>
              </label>

              <div>
                <label className="block text-sm text-gray-600 mb-1">Merged within (days)</label>
                <input
                  type="number"
                  value={mergedWithinDays}
                  onChange={(e) => setMergedWithinDays(parseInt(e.target.value) || 30)}
                  min={1}
                  max={365}
                  disabled={isSimulating}
                  className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-indigo-500 focus:border-indigo-500 disabled:opacity-50"
                />
              </div>

              <div>
                <label className="block text-sm text-gray-600 mb-1">Min lines changed</label>
                <input
                  type="number"
                  value={minLinesChanged}
                  onChange={(e) => {
                    const parsed = parseInt(e.target.value);
                    setMinLinesChanged(Number.isNaN(parsed) ? 50 : parsed);
                  }}
                  min={0}
                  disabled={isSimulating}
                  className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-indigo-500 focus:border-indigo-500 disabled:opacity-50"
                />
              </div>
            </div>
          )}
        </div>

        {/* Discover Button */}
        <button
          onClick={handleDiscover}
          disabled={isLoading || !repoUrl.trim() || isSimulating}
          className="w-full px-4 py-2.5 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
        >
          {isLoading ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                  fill="none"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
              {mode === "fast" ? "Analyzing..." : "Analyzing with AI..."}
            </span>
          ) : (
            "Discover High-Value PRs"
          )}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* Simulation Progress */}
      {simulationProgress && (
        <div className="p-4 bg-indigo-50 border border-indigo-200 rounded-lg">
          <div className="flex items-center gap-3 mb-2">
            <svg className="animate-spin h-5 w-5 text-indigo-600" viewBox="0 0 24 24">
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
                fill="none"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            <span className="font-medium text-indigo-900">
              Simulating PRs ({simulationProgress.completed}/{simulationProgress.total})
            </span>
          </div>
          {simulationProgress.current && (
            <p className="text-sm text-indigo-700 ml-8">{simulationProgress.current}</p>
          )}
          {simulationProgress.completed === simulationProgress.total && (
            <p className="text-sm text-indigo-700 ml-8 mt-2">
              Redirecting to PR Reviews...
            </p>
          )}
          {simulationProgress.errors.length > 0 && (
            <div className="mt-3 ml-8">
              <p className="text-sm font-medium text-red-600">Some simulations failed:</p>
              <ul className="text-xs text-red-600 mt-1 space-y-0.5">
                {simulationProgress.errors.map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Results */}
      {results && !simulationProgress && (
        <div className="space-y-4">
          {/* Results Header with Selection Controls */}
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-600">
                Found {results.candidates.length} candidate{results.candidates.length !== 1 ? "s" : ""}{" "}
                from {results.total_prs_analyzed} PRs analyzed
              </span>
              {results.candidates.length > 0 && (
                <button
                  onClick={handleSelectAll}
                  disabled={isSimulating}
                  className="text-sm text-indigo-600 hover:text-indigo-700 font-medium disabled:opacity-50"
                >
                  {selectedPRs.size === Math.min(results.candidates.length, MAX_SELECTIONS) ? "Deselect All" : "Select All"}
                </button>
              )}
            </div>

            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-500">
                {(results.analysis_time_ms / 1000).toFixed(1)}s
              </span>
              {selectedPRs.size > 0 && (
                <>
                  <span className="text-sm text-gray-600">
                    {selectedPRs.size} selected
                  </span>
                  <button
                    onClick={handleSimulateSelected}
                    disabled={isSimulating}
                    className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                  >
                    {isSimulating ? (
                      <>
                        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                          <circle
                            className="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="4"
                            fill="none"
                          />
                          <path
                            className="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                          />
                        </svg>
                        Simulating...
                      </>
                    ) : (
                      <>Simulate Selected ({selectedPRs.size})</>
                    )}
                  </button>
                </>
              )}
            </div>
          </div>

          {results.candidates.length === 0 ? (
            <div className="p-8 text-center bg-gray-50 rounded-lg">
              <svg
                className="w-16 h-16 mx-auto mb-4 text-gray-300"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
              <p className="text-lg font-medium text-gray-700">No high-value PRs found</p>
              <p className="text-sm text-gray-500 mt-2">
                Try a different repository or adjust the search filters
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {results.candidates.map((pr, index) => (
                <PRCandidateCard
                  key={pr.number}
                  pr={pr}
                  rank={index + 1}
                  isSelected={selectedPRs.has(pr.html_url)}
                  onToggleSelect={() => handleToggleSelect(pr.html_url)}
                  onSimulate={onSelectPR ? () => onSelectPR(pr.html_url) : undefined}
                  disabled={isSimulating}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PRCandidateCard({
  pr,
  rank,
  isSelected,
  onToggleSelect,
  onSimulate,
  disabled,
}: {
  pr: PRCandidate;
  rank: number;
  isSelected: boolean;
  onToggleSelect: () => void;
  onSimulate?: () => void;
  disabled?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={`border rounded-lg overflow-hidden transition-colors bg-white ${
        isSelected
          ? "border-indigo-500 bg-indigo-50/50 ring-1 ring-indigo-500"
          : "border-gray-200 hover:border-indigo-300"
      }`}
    >
      <div className="p-4">
        <div className="flex items-start gap-3">
          {/* Checkbox */}
          <div className="flex-shrink-0 pt-0.5">
            <input
              type="checkbox"
              checked={isSelected}
              onChange={onToggleSelect}
              disabled={disabled}
              className="w-4 h-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            />
          </div>

          {/* Main content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                {/* Header row */}
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="text-lg font-semibold text-indigo-600">#{rank}</span>
                  <span
                    className={`px-2 py-0.5 text-xs font-medium rounded ${
                      pr.state === "open"
                        ? "bg-green-100 text-green-700"
                        : "bg-purple-100 text-purple-700"
                    }`}
                  >
                    {pr.state === "open" ? "Open" : "Merged"}
                  </span>
                  <span className="text-sm text-gray-500">PR #{pr.number}</span>
                </div>

                {/* Title */}
                <a
                  href={pr.html_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-base font-medium text-gray-900 hover:text-indigo-600 line-clamp-2"
                >
                  {pr.title}
                </a>

                {/* Metadata row */}
                <div className="flex items-center gap-4 mt-2 text-sm text-gray-600 flex-wrap">
                  <span className="flex items-center gap-1">
                    <span className="text-green-600">+{pr.additions}</span>
                    <span className="text-red-600">-{pr.deletions}</span>
                  </span>
                  <span>{pr.changed_files} files</span>
                  <span>{pr.commits} commits</span>
                </div>

                {/* Risk categories (from advanced search) */}
                {pr.risk_categories && pr.risk_categories.length > 0 && (
                  <div className="flex items-center gap-1 mt-2 flex-wrap">
                    {pr.risk_categories.map((cat) => (
                      <span key={cat} className="px-2 py-0.5 bg-red-50 text-red-600 text-xs rounded">
                        {cat}
                      </span>
                    ))}
                  </div>
                )}

                {/* Risk assessment (from advanced search) */}
                {pr.risk_assessment && (
                  <p className="mt-2 text-sm text-gray-600 italic">&quot;{pr.risk_assessment}&quot;</p>
                )}
              </div>

              {/* Right side: Score + Action */}
              <div className="flex flex-col items-end gap-2 flex-shrink-0">
                <PRScoreDisplay
                  overall={pr.overall_score}
                  complexity={pr.complexity_score}
                  recency={pr.recency_score}
                />

                {/* Individual simulate button (when not selected) */}
                {onSimulate && !isSelected && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onSimulate();
                    }}
                    disabled={disabled}
                    className="px-3 py-1.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-md transition-colors whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Simulate
                  </button>
                )}
              </div>
            </div>

            {/* Expandable file list */}
            {pr.files_changed && pr.files_changed.length > 0 && (
              <div className="mt-3">
                <button
                  onClick={() => setExpanded(!expanded)}
                  disabled={disabled}
                  className="text-xs text-indigo-600 hover:text-indigo-800 flex items-center gap-1 disabled:opacity-50"
                >
                  <svg
                    className={`w-3 h-3 transition-transform ${expanded ? "rotate-90" : ""}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                  {expanded ? "Hide files" : `Show ${pr.files_changed.length} files`}
                </button>

                {expanded && (
                  <div className="mt-2 p-2 bg-gray-50 rounded text-xs font-mono max-h-40 overflow-auto">
                    {pr.files_changed.map((file) => (
                      <div key={file} className="text-gray-600 truncate">
                        {file}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
