"use client";

import { useState } from "react";
import Image from "next/image";
import { PRCandidate, DiscoverResponse } from "@/lib/types/discover";

export function DiscoverPRs({ onSelectPR }: { onSelectPR?: (prUrl: string) => void }) {
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

  async function handleDiscover() {
    if (!repoUrl.trim()) return;

    setIsLoading(true);
    setError(null);
    setResults(null);

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
                  onChange={(e) => setMinLinesChanged(parseInt(e.target.value) || 50)}
                  min={0}
                  className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>
            </div>
          )}
        </div>

        {/* Discover Button */}
        <button
          onClick={handleDiscover}
          disabled={isLoading || !repoUrl.trim()}
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

      {/* Results */}
      {results && (
        <div className="space-y-4">
          <div className="flex items-center justify-between text-sm text-gray-600">
            <span>
              Found {results.candidates.length} candidate{results.candidates.length !== 1 ? "s" : ""}{" "}
              from {results.total_prs_analyzed} PRs analyzed
            </span>
            <span>{(results.analysis_time_ms / 1000).toFixed(1)}s</span>
          </div>

          {results.candidates.length === 0 ? (
            <div className="p-8 text-center text-gray-500 bg-gray-50 rounded-lg">
              No PRs found matching your criteria. Try adjusting the filters.
            </div>
          ) : (
            <div className="space-y-3">
              {results.candidates.map((pr, index) => (
                <PRCandidateCard
                  key={pr.number}
                  pr={pr}
                  rank={index + 1}
                  onSimulate={onSelectPR ? () => onSelectPR(pr.html_url) : undefined}
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
  onSimulate,
}: {
  pr: PRCandidate;
  rank: number;
  onSimulate?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden hover:border-indigo-300 transition-colors bg-white">
      <div className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
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

            <a
              href={pr.html_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-base font-medium text-gray-900 hover:text-indigo-600 line-clamp-2"
            >
              {pr.title}
            </a>

            <div className="flex items-center gap-4 mt-2 text-sm text-gray-600 flex-wrap">
              <span className="flex items-center gap-1">
                <span className="text-green-600">+{pr.additions}</span>
                <span className="text-red-600">-{pr.deletions}</span>
              </span>
              <span>{pr.changed_files} files</span>
              <span>{pr.commits} commits</span>
              <span className="flex items-center gap-1">
                <Image
                  src={pr.author_avatar_url}
                  alt={pr.author}
                  width={16}
                  height={16}
                  className="rounded-full"
                  unoptimized
                />
                {pr.author}
              </span>
            </div>

            {/* Score badges */}
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <span className="px-2 py-0.5 bg-orange-100 text-orange-700 text-xs rounded font-medium">
                Score: {pr.overall_score}
              </span>
              <span className="px-2 py-0.5 bg-blue-50 text-blue-600 text-xs rounded">
                Complexity: {pr.complexity_score}
              </span>
              <span className="px-2 py-0.5 bg-green-50 text-green-600 text-xs rounded">
                Recency: {pr.recency_score}
              </span>
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

          {/* Action button */}
          {onSimulate && (
            <button
              onClick={onSimulate}
              className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors whitespace-nowrap flex-shrink-0"
            >
              Simulate
            </button>
          )}
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
  );
}
