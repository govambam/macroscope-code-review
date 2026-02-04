"use client";

import React from "react";

export interface ExistingPR {
  id: number;
  prNumber: number;
  title: string | null;
  originalPrUrl: string | null;
  originalPrTitle: string | null;
  forkedPrUrl: string;
  createdAt: string;
  hasMacroscopeBugs: boolean;
  bugCount: number | null;
  hasAnalysis: boolean;
  state: string | null;
}

interface ExistingPRsListProps {
  forkOwner: string;
  forkRepo: string;
  existingPRs: ExistingPR[];
  onRunAnalysis: (prId: number) => void;
  onViewAnalysis: (prId: number) => void;
  onDeletePR?: (pr: ExistingPR) => void;
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

function StatusBadge({ pr }: { pr: ExistingPR }) {
  if (pr.hasAnalysis) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-green-100 text-green-700">
        Analyzed &middot; {pr.bugCount ?? 0} bug{pr.bugCount !== 1 ? "s" : ""}
      </span>
    );
  }
  if (pr.hasMacroscopeBugs) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-100 text-blue-700">
        Ready for Analysis
      </span>
    );
  }
  if (pr.state === "open") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-yellow-100 text-yellow-700">
        Macroscope Reviewing
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-gray-100 text-gray-600">
      {pr.state === "closed" ? "Closed" : "Pending"}
    </span>
  );
}

export function ExistingPRsList({
  forkOwner,
  forkRepo,
  existingPRs,
  onRunAnalysis,
  onViewAnalysis,
  onDeletePR,
}: ExistingPRsListProps) {
  if (existingPRs.length === 0) return null;

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <div className="px-4 py-3 bg-gray-50 border-b border-border">
        <p className="text-sm font-semibold text-accent">
          Existing Simulated PRs in This Fork
        </p>
        <p className="text-xs text-text-muted mt-0.5">
          You have {existingPRs.length} previously simulated PR{existingPRs.length !== 1 ? "s" : ""}. You can continue working with these or simulate new ones.
        </p>
      </div>

      <div className="divide-y divide-border">
        {existingPRs.map((pr) => (
          <div key={pr.id} className="px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-mono text-text-muted">#{pr.prNumber}</span>
                  <StatusBadge pr={pr} />
                  <span className="text-xs text-text-muted">{timeAgo(pr.createdAt)}</span>
                </div>
                <p className="mt-1 text-sm font-medium text-accent truncate">
                  {pr.title || pr.originalPrTitle || "Simulated PR"}
                </p>
                {pr.originalPrUrl && (
                  <p className="text-xs text-text-muted mt-0.5">
                    Original: {pr.originalPrUrl.replace("https://github.com/", "")}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {pr.hasAnalysis ? (
                  <button
                    type="button"
                    onClick={() => onViewAnalysis(pr.id)}
                    className="px-2.5 py-1.5 text-xs font-medium text-primary border border-primary/30 rounded-md hover:bg-primary/5 transition-colors"
                  >
                    View Analysis
                  </button>
                ) : (pr.hasMacroscopeBugs || pr.state === "closed") ? (
                  <button
                    type="button"
                    onClick={() => onRunAnalysis(pr.id)}
                    className="px-2.5 py-1.5 text-xs font-medium text-white bg-primary hover:bg-primary-hover rounded-md transition-colors"
                  >
                    Run Analysis
                  </button>
                ) : null}
                <a
                  href={pr.forkedPrUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-2.5 py-1.5 text-xs font-medium text-text-secondary border border-border rounded-md hover:bg-gray-50 transition-colors"
                >
                  GitHub
                </a>
                {onDeletePR && (
                  <button
                    type="button"
                    onClick={() => onDeletePR(pr)}
                    className="p-1.5 text-gray-400 hover:text-red-500 transition-colors"
                    title="Remove from database"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
