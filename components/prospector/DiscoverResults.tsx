"use client";

import React, { useState, useMemo } from "react";
import { InfoTooltip } from "./InfoTooltip";

export interface DiscoveredPR {
  number: number;
  title: string;
  url: string;
  state: "open" | "closed";
  created_at: string;
  updated_at: string;
  user: { login: string; avatar_url: string };
  additions: number;
  deletions: number;
  changed_files: number;
  comments: number;
  score: number;
  scoreBreakdown: { size: number; files: number; activity: number; recency: number };
}

type SortKey = "score" | "recent" | "changed";

interface DiscoverResultsProps {
  prs: DiscoveredPR[];
  repoFullName: string;
  onSimulateSingle: (pr: DiscoveredPR) => void;
  onSimulateSelected: (prs: DiscoveredPR[]) => void;
}

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function scoreColor(score: number): string {
  if (score >= 80) return "bg-green-100 text-green-800";
  if (score >= 60) return "bg-yellow-100 text-yellow-800";
  return "bg-gray-100 text-gray-600";
}

const INITIAL_SHOW = 10;

export function DiscoverResults({
  prs,
  repoFullName,
  onSimulateSingle,
  onSimulateSelected,
}: DiscoverResultsProps) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [showCount, setShowCount] = useState(INITIAL_SHOW);

  const filtered = useMemo(() => {
    let list = prs;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (pr) =>
          pr.title.toLowerCase().includes(q) ||
          `#${pr.number}`.includes(q) ||
          pr.user.login.toLowerCase().includes(q)
      );
    }

    const sorted = [...list];
    switch (sortKey) {
      case "score":
        sorted.sort((a, b) => b.score - a.score);
        break;
      case "recent":
        sorted.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        break;
      case "changed":
        sorted.sort((a, b) => b.additions + b.deletions - (a.additions + a.deletions));
        break;
    }
    return sorted;
  }, [prs, search, sortKey]);

  const visible = filtered.slice(0, showCount);
  const hasMore = showCount < filtered.length;

  function toggleSelect(prNumber: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(prNumber)) next.delete(prNumber);
      else next.add(prNumber);
      return next;
    });
  }

  function handleSimulateSelected() {
    const chosen = prs.filter((pr) => selected.has(pr.number));
    if (chosen.length > 0) onSimulateSelected(chosen);
  }

  return (
    <div className="mt-5 border border-border rounded-lg overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 bg-gray-50 border-b border-border">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <p className="text-sm font-semibold text-accent">
            Discovered PRs in {repoFullName}
            <span className="ml-1.5 font-normal text-text-secondary">
              ({filtered.length} PR{filtered.length !== 1 ? "s" : ""} from last 30 days)
            </span>
          </p>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search PRs..."
              className="px-2.5 py-1.5 bg-white border border-border rounded-md text-xs w-40 focus:ring-1 focus:ring-primary focus:border-primary"
            />
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              className="px-2.5 py-1.5 bg-white border border-border rounded-md text-xs focus:ring-1 focus:ring-primary focus:border-primary"
            >
              <option value="score">Sort: Score</option>
              <option value="recent">Sort: Recent</option>
              <option value="changed">Sort: Changed</option>
            </select>
          </div>
        </div>
      </div>

      {/* PR list */}
      <div className="divide-y divide-border">
        {visible.map((pr) => (
          <div
            key={pr.number}
            className={`px-4 py-3 flex items-start gap-3 hover:bg-gray-50/50 transition-colors ${
              selected.has(pr.number) ? "bg-primary/5" : ""
            }`}
          >
            {/* Checkbox */}
            <label className="mt-0.5 shrink-0">
              <input
                type="checkbox"
                checked={selected.has(pr.number)}
                onChange={() => toggleSelect(pr.number)}
                className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary cursor-pointer"
              />
            </label>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-mono text-text-muted">#{pr.number}</span>
                <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold ${scoreColor(pr.score)}`}>
                  {pr.score}
                  <InfoTooltip
                    content={
                      <div className="space-y-1">
                        <p className="font-semibold">Score Breakdown</p>
                        <p>Size: {pr.scoreBreakdown.size}</p>
                        <p>Files: {pr.scoreBreakdown.files}</p>
                        <p>Activity: {pr.scoreBreakdown.activity}</p>
                        <p>Recency: {pr.scoreBreakdown.recency}</p>
                      </div>
                    }
                  />
                </span>
                <span
                  className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${
                    pr.state === "open"
                      ? "bg-green-100 text-green-700"
                      : "bg-purple-100 text-purple-700"
                  }`}
                >
                  {pr.state === "open" ? "Open" : "Closed"}
                </span>
              </div>

              <a
                href={pr.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block mt-1 text-sm font-medium text-accent hover:text-primary transition-colors truncate"
              >
                {pr.title}
              </a>

              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-text-muted">
                <span className="text-green-700">+{pr.additions}</span>
                <span className="text-red-600">-{pr.deletions}</span>
                <span>{pr.changed_files} file{pr.changed_files !== 1 ? "s" : ""}</span>
                <span>{timeAgo(pr.created_at)}</span>
                <span>by {pr.user.login}</span>
              </div>
            </div>

            {/* Simulate button */}
            <button
              type="button"
              onClick={() => onSimulateSingle(pr)}
              className="shrink-0 px-3 py-1.5 text-xs font-medium text-primary border border-primary/30 rounded-md hover:bg-primary/5 transition-colors"
            >
              Simulate
            </button>
          </div>
        ))}
      </div>

      {/* Show more */}
      {hasMore && (
        <div className="px-4 py-2 border-t border-border">
          <button
            type="button"
            onClick={() => setShowCount((c) => c + 10)}
            className="text-xs text-primary hover:text-primary-hover font-medium"
          >
            Show {Math.min(10, filtered.length - showCount)} more...
          </button>
        </div>
      )}

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="px-4 py-3 border-t border-border bg-primary/5 flex items-center justify-between">
          <span className="text-sm text-accent font-medium">
            {selected.size} PR{selected.size !== 1 ? "s" : ""} selected
          </span>
          <button
            type="button"
            onClick={handleSimulateSelected}
            className="px-4 py-2 text-sm font-medium text-white bg-primary hover:bg-primary-hover rounded-lg transition-colors"
          >
            Simulate Selected PRs
          </button>
        </div>
      )}

      {/* Empty filtered */}
      {filtered.length === 0 && (
        <div className="px-4 py-8 text-center text-sm text-text-muted">
          {search ? "No PRs match your search." : "No PRs found."}
        </div>
      )}
    </div>
  );
}
