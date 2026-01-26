"use client";

import { useState, useRef, useCallback, useEffect } from "react";
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

  // Cleanup timeout on unmount to prevent state updates on unmounted component
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

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

interface StatusMessage {
  type: "info" | "success" | "error" | "progress";
  text: string;
  timestamp: string;
  prNumber?: string;
}

interface SimulationProgress {
  total: number;
  completed: number;
  currentPR: string | null;
  errors: string[];
  successCount: number;
}

interface DiscoverPRsProps {
  onSelectPR?: (prUrl: string) => void;
  onSimulationComplete?: () => void;
}

export function DiscoverPRs({ onSelectPR, onSimulationComplete }: DiscoverPRsProps) {
  const [repoUrl, setRepoUrl] = useState("");
  const [mode, setMode] = useState<"fast" | "advanced">("fast");
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState<DiscoverResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

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
  const [statusMessages, setStatusMessages] = useState<StatusMessage[]>([]);
  const [simulationComplete, setSimulationComplete] = useState(false);

  // Auto-scroll ref
  const statusContainerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (statusContainerRef.current) {
      statusContainerRef.current.scrollTop = statusContainerRef.current.scrollHeight;
    }
  }, [statusMessages]);

  const addStatus = useCallback((text: string, type: StatusMessage["type"] = "info", prNumber?: string) => {
    const timestamp = new Date().toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    setStatusMessages((prev) => [...prev, { type, text, timestamp, prNumber }]);
  }, []);

  async function handleDiscover() {
    if (!repoUrl.trim()) {
      setValidationError("Please enter a repository name");
      return;
    }

    setValidationError(null);
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
    setSimulationComplete(false);
    setStatusMessages([]);
    setSimulationProgress({
      total: selectedPRs.size,
      completed: 0,
      currentPR: null,
      errors: [],
      successCount: 0,
    });

    const prUrls = Array.from(selectedPRs);
    const errors: string[] = [];
    let successCount = 0;

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
      if (repos.size > 0) {
        addStatus(`Caching ${repos.size} repository${repos.size > 1 ? "ies" : ""}...`, "info");

        const cachePromises = Array.from(repos).map(async (repo) => {
          try {
            const response = await fetch("/api/cache/clone", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                repoUrl: `https://github.com/${repo}`,
                shallow: true
              }),
            });
            if (response.ok) {
              addStatus(`Cached ${repo}`, "success");
            }
          } catch {
            // Ignore cache errors, simulation can still work
          }
        });

        await Promise.all(cachePromises);
        addStatus("Repository caching complete", "success");
      }

      // Simulate PRs sequentially
      for (let i = 0; i < prUrls.length; i++) {
        const prUrl = prUrls[i];
        const prMatch = prUrl.match(/\/pull\/(\d+)/);
        const prNumber = prMatch ? prMatch[1] : `${i + 1}`;
        const repoMatch = prUrl.match(/github\.com\/([^\/]+\/[^\/]+)/);
        const repoName = repoMatch ? repoMatch[1] : "unknown";

        setSimulationProgress((prev) => prev ? {
          ...prev,
          currentPR: `PR #${prNumber}`,
          completed: i,
        } : null);

        addStatus(`Starting simulation for ${repoName} PR #${prNumber}...`, "info", prNumber);

        try {
          const response = await fetch("/api/create-pr", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              prUrl,
              cacheRepo: true,
            }),
          });

          if (!response.ok) {
            // Handle non-SSE error responses (e.g., 500 errors with JSON/HTML)
            const errorText = await response.text();
            try {
              const errorJson = JSON.parse(errorText);
              throw new Error(errorJson.error || errorJson.message || `Server error: ${response.status}`);
            } catch {
              throw new Error(`Server error: ${response.status}`);
            }
          }

          if (!response.body) {
            throw new Error("No response body");
          }

          // Read SSE stream and parse events
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          let prSuccess = false;
          let prError: string | null = null;

          // Helper to process a single SSE event
          const processEvent = (event: string) => {
            if (!event.trim()) return;

            const dataMatch = event.match(/^data: (.+)$/m);
            if (!dataMatch) return;

            try {
              const data = JSON.parse(dataMatch[1]);

              if (data.eventType === "status") {
                // Show status message with PR context
                const statusType = data.statusType === "error" ? "error" :
                                  data.statusType === "success" ? "success" : "progress";
                addStatus(`[PR #${prNumber}] ${data.message}`, statusType, prNumber);
              } else if (data.eventType === "result") {
                if (data.success) {
                  prSuccess = true;
                  addStatus(`[PR #${prNumber}] Simulation complete!`, "success", prNumber);
                } else {
                  prError = data.error || data.message || "Unknown error";
                }
              }
            } catch {
              // Ignore parse errors for individual events
            }
          };

          while (true) {
            const { done, value } = await reader.read();
            if (value) {
              buffer += decoder.decode(value, { stream: !done });
            }
            if (done) break;

            // Process complete SSE events (separated by double newlines)
            const events = buffer.split("\n\n");
            buffer = events.pop() || "";

            for (const event of events) {
              processEvent(event);
            }
          }

          // Process any remaining buffer content after stream ends
          if (buffer.trim()) {
            processEvent(buffer);
          }

          // Handle case where no success/error was detected (non-SSE response)
          if (!prSuccess && !prError) {
            prError = "No valid response received";
          }

          if (prSuccess) {
            successCount++;
          } else if (prError) {
            errors.push(`PR #${prNumber}: ${prError}`);
            addStatus(`[PR #${prNumber}] Failed: ${prError}`, "error", prNumber);
          }

        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : "Unknown error";
          errors.push(`PR #${prNumber}: ${errorMsg}`);
          addStatus(`[PR #${prNumber}] Error: ${errorMsg}`, "error", prNumber);
        }

        // Update progress
        setSimulationProgress((prev) => prev ? {
          ...prev,
          completed: i + 1,
          errors,
          successCount,
        } : null);
      }

      // Final status
      setSimulationProgress((prev) => prev ? {
        ...prev,
        completed: prUrls.length,
        currentPR: null,
        errors,
        successCount,
      } : null);

      if (successCount > 0) {
        addStatus(`Completed: ${successCount}/${prUrls.length} PRs simulated successfully`, "success");
      }
      if (errors.length > 0) {
        addStatus(`${errors.length} PR${errors.length > 1 ? "s" : ""} failed`, "error");
      }

      setSimulationComplete(true);

    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to simulate selected PRs");
      addStatus(`Bulk simulation failed: ${err instanceof Error ? err.message : "Unknown error"}`, "error");
    } finally {
      setIsSimulating(false);
    }
  };

  const handleFinishSimulation = () => {
    // Reset state and notify parent
    setSimulationProgress(null);
    setStatusMessages([]);
    setSelectedPRs(new Set());
    setSimulationComplete(false);

    // Call the callback to let parent handle modal close and refresh
    if (onSimulationComplete) {
      onSimulationComplete();
    }
  };

  const getStatusColor = (type: StatusMessage["type"]) => {
    switch (type) {
      case "success":
        return "text-green-600";
      case "error":
        return "text-red-600";
      case "progress":
        return "text-indigo-600";
      default:
        return "text-gray-700";
    }
  };

  return (
    <div className="space-y-6">
      {/* Simulation Progress Panel */}
      {(isSimulating || simulationComplete) && simulationProgress && (
        <div className="border border-indigo-200 rounded-lg overflow-hidden bg-white">
          {/* Progress Header */}
          <div className="bg-indigo-50 px-4 py-3 border-b border-indigo-200">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {isSimulating && (
                  <svg className="animate-spin h-5 w-5 text-indigo-600" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                )}
                {simulationComplete && (
                  <svg className="h-5 w-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
                <span className="font-semibold text-indigo-900">
                  {simulationComplete
                    ? `Simulation Complete (${simulationProgress.successCount}/${simulationProgress.total} successful)`
                    : `Simulating PRs (${simulationProgress.completed}/${simulationProgress.total})`
                  }
                </span>
              </div>
              {simulationProgress.currentPR && !simulationComplete && (
                <span className="text-sm text-indigo-700">
                  Current: {simulationProgress.currentPR}
                </span>
              )}
            </div>

            {/* Progress Bar */}
            <div className="mt-3 h-2 bg-indigo-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-indigo-600 transition-all duration-300"
                style={{ width: `${(simulationProgress.completed / simulationProgress.total) * 100}%` }}
              />
            </div>
          </div>

          {/* Status Log */}
          <div
            ref={statusContainerRef}
            className="max-h-64 overflow-y-auto p-4 bg-gray-50 font-mono text-xs space-y-1"
          >
            {statusMessages.map((msg, i) => (
              <div key={i} className={`flex gap-2 ${getStatusColor(msg.type)}`}>
                <span className="text-gray-400 shrink-0">{msg.timestamp}</span>
                <span>{msg.text}</span>
              </div>
            ))}
            {statusMessages.length === 0 && (
              <div className="text-gray-400">Waiting for status updates...</div>
            )}
          </div>

          {/* Actions */}
          {simulationComplete && (
            <div className="px-4 py-3 bg-white border-t border-indigo-200 flex justify-end">
              <button
                onClick={handleFinishSimulation}
                className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
              >
                View PRs in Dashboard
              </button>
            </div>
          )}
        </div>
      )}

      {/* Input Section - hidden during simulation */}
      {!isSimulating && !simulationComplete && (
        <>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                GitHub Repository
              </label>
              <input
                type="text"
                value={repoUrl}
                onChange={(e) => {
                  setRepoUrl(e.target.value);
                  if (validationError) setValidationError(null);
                }}
                placeholder="owner/repo or https://github.com/owner/repo"
                className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 ${
                  validationError ? "border-red-300" : "border-gray-300"
                }`}
                onKeyDown={(e) => e.key === "Enter" && handleDiscover()}
              />
            </div>

            {/* Search Mode Toggle */}
            <div className="flex items-center gap-4 flex-wrap">
              <span className="text-sm font-medium text-gray-700">Search mode:</span>
              <div className="flex rounded-lg border border-gray-300 overflow-hidden">
                <button
                  onClick={() => setMode("fast")}
                  className={`px-4 py-2 text-sm font-medium transition-colors ${
                    mode === "fast"
                      ? "bg-indigo-600 text-white"
                      : "bg-white text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  Fast
                </button>
                <button
                  onClick={() => setMode("advanced")}
                  className={`px-4 py-2 text-sm font-medium transition-colors ${
                    mode === "advanced"
                      ? "bg-indigo-600 text-white"
                      : "bg-white text-gray-700 hover:bg-gray-50"
                  }`}
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
                className="text-sm text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
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
                      className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="text-sm">Include open PRs</span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={includeMerged}
                      onChange={(e) => setIncludeMerged(e.target.checked)}
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
                      className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-indigo-500 focus:border-indigo-500"
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
                      className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-indigo-500 focus:border-indigo-500"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Discover Button */}
            <div>
              <button
                onClick={handleDiscover}
                disabled={isLoading}
                className="w-full px-4 py-2.5 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-70 disabled:cursor-not-allowed transition-colors"
              >
                {isLoading ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    {mode === "fast" ? "Analyzing..." : "Analyzing with AI..."}
                  </span>
                ) : (
                  "Discover High-Value PRs"
                )}
              </button>

              {validationError && (
                <div className="mt-2 flex items-center gap-2 text-sm text-red-600">
                  <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                  {validationError}
                </div>
              )}
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              {error}
            </div>
          )}

          {/* Results */}
          {results && (
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
                      className="text-sm text-indigo-600 hover:text-indigo-700 font-medium"
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
                        className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors flex items-center gap-2"
                      >
                        Simulate Selected ({selectedPRs.size})
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
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </>
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
}: {
  pr: PRCandidate;
  rank: number;
  isSelected: boolean;
  onToggleSelect: () => void;
  onSimulate?: () => void;
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
              className="w-4 h-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500 cursor-pointer"
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
                    className="px-3 py-1.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-md transition-colors whitespace-nowrap"
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
                  className="text-xs text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
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
