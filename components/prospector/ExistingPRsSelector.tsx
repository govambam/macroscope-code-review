"use client";

import React, { useState, useEffect, useMemo } from "react";

export interface OrgPR {
  id: number;
  prNumber: number;
  title: string | null;
  forkedPrUrl: string;
  originalPrUrl: string | null;
  originalPrTitle: string | null;
  hasMacroscopeBugs: boolean;
  bugCount: number | null;
  hasAnalysis: boolean;
  analysisId: number | null;
  state: string | null;
  createdAt: string;
  repoName: string;
  forkOwner: string;
}

interface RepoGroup {
  repoName: string;
  fullName: string;
  forkOwner: string;
  prs: OrgPR[];
}

interface ExistingPRsSelectorProps {
  orgName: string;
  onSelectPR: (pr: OrgPR) => void;
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

function StatusBadge({ pr }: { pr: OrgPR }) {
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

export function ExistingPRsSelector({ orgName, onSelectPR }: ExistingPRsSelectorProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [repos, setRepos] = useState<RepoGroup[]>([]);
  const [totalPRs, setTotalPRs] = useState(0);
  const [searchFilter, setSearchFilter] = useState("");
  const [expandedRepos, setExpandedRepos] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!orgName) return;

    setLoading(true);
    setError(null);

    fetch(`/api/orgs/${encodeURIComponent(orgName)}/prs`)
      .then((r) => r.json())
      .then((data) => {
        if (data.success && data.repos) {
          const groups: RepoGroup[] = data.repos.map(
            (r: { repoName: string; fullName: string; forkOwner: string; prs: Array<Record<string, unknown>> }) => ({
              repoName: r.repoName,
              fullName: r.fullName,
              forkOwner: r.forkOwner,
              prs: r.prs.map(
                (p: Record<string, unknown>) =>
                  ({
                    id: p.id as number,
                    prNumber: p.prNumber as number,
                    title: p.title as string | null,
                    forkedPrUrl: p.forkedPrUrl as string,
                    originalPrUrl: p.originalPrUrl as string | null,
                    originalPrTitle: p.originalPrTitle as string | null,
                    hasMacroscopeBugs: p.hasMacroscopeBugs as boolean,
                    bugCount: p.bugCount as number | null,
                    hasAnalysis: p.hasAnalysis as boolean,
                    analysisId: p.analysisId as number | null,
                    state: p.state as string | null,
                    createdAt: p.createdAt as string,
                    repoName: r.repoName,
                    forkOwner: r.forkOwner,
                  }) as OrgPR
              ),
            })
          );
          setRepos(groups);
          setTotalPRs(data.totalPRs);
          // Default expand: all repos if <= 3, otherwise first only
          if (groups.length <= 3) {
            setExpandedRepos(new Set(groups.map((g: RepoGroup) => g.repoName)));
          } else if (groups.length > 0) {
            setExpandedRepos(new Set([groups[0].repoName]));
          }
        } else {
          setError(data.error || "Failed to load existing PRs");
        }
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load existing PRs");
      })
      .finally(() => setLoading(false));
  }, [orgName]);

  const filteredRepos = useMemo(() => {
    if (!searchFilter.trim()) return repos;
    const q = searchFilter.toLowerCase();
    return repos
      .map((repo) => ({
        ...repo,
        prs: repo.prs.filter(
          (pr) =>
            `#${pr.prNumber}`.includes(q) ||
            (pr.title && pr.title.toLowerCase().includes(q)) ||
            (pr.originalPrTitle && pr.originalPrTitle.toLowerCase().includes(q))
        ),
      }))
      .filter((repo) => repo.prs.length > 0);
  }, [repos, searchFilter]);

  function toggleRepo(repoName: string) {
    setExpandedRepos((prev) => {
      const next = new Set(prev);
      if (next.has(repoName)) {
        next.delete(repoName);
      } else {
        next.add(repoName);
      }
      return next;
    });
  }

  if (loading) {
    return (
      <div className="border border-border rounded-lg overflow-hidden animate-pulse">
        <div className="px-4 py-3 bg-gray-50 border-b border-border">
          <div className="h-5 bg-gray-200 rounded w-56" />
          <div className="h-3 bg-gray-200 rounded w-80 mt-2" />
        </div>
        <div className="divide-y divide-border">
          {[1, 2, 3].map((i) => (
            <div key={i} className="px-4 py-3 flex items-center gap-3">
              <div className="h-4 bg-gray-200 rounded w-8" />
              <div className="h-4 bg-gray-200 rounded flex-1" />
              <div className="h-6 bg-gray-200 rounded w-16" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
        <p className="text-sm text-red-800">{error}</p>
      </div>
    );
  }

  if (totalPRs === 0) return null;

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 bg-gray-50 border-b border-border">
        <h3 className="text-sm font-semibold text-accent">
          Use Existing Simulated PR
        </h3>
        <p className="text-xs text-text-muted mt-0.5">
          You have {totalPRs} simulated PR{totalPRs !== 1 ? "s" : ""} from{" "}
          <span className="font-medium text-text-secondary">{orgName}</span> repositories.
          Select one to continue with analysis.
        </p>
      </div>

      {/* Search */}
      {totalPRs > 3 && (
        <div className="px-4 py-2 border-b border-border">
          <input
            type="text"
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
            placeholder="Search existing PRs..."
            className="w-full px-3 py-1.5 bg-white border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          />
        </div>
      )}

      {/* Repo groups */}
      <div className="max-h-[400px] overflow-y-auto">
        {filteredRepos.map((repo) => {
          const isExpanded = expandedRepos.has(repo.repoName);
          return (
            <div key={repo.repoName}>
              {/* Repo header */}
              <button
                type="button"
                onClick={() => toggleRepo(repo.repoName)}
                className="w-full flex items-center gap-2 px-4 py-2.5 bg-gray-50 border-b border-border hover:bg-gray-100 transition-colors text-left"
              >
                <svg
                  className={`h-4 w-4 text-gray-500 transition-transform duration-200 flex-shrink-0 ${
                    isExpanded ? "rotate-90" : ""
                  }`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
                <span className="text-sm font-medium text-accent flex-1 truncate">
                  {repo.fullName}
                </span>
                <span className="text-xs text-text-muted shrink-0">
                  ({repo.prs.length} PR{repo.prs.length !== 1 ? "s" : ""})
                </span>
              </button>

              {/* PR list */}
              {isExpanded && (
                <div className="divide-y divide-border">
                  {repo.prs.map((pr) => (
                    <div key={pr.id} className="px-4 py-3 hover:bg-gray-50/50 transition-colors">
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
                            <p className="text-xs text-text-muted mt-0.5 truncate">
                              Original: {pr.originalPrUrl.replace("https://github.com/", "")}
                            </p>
                          )}
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => onSelectPR(pr)}
                            className="px-3 py-1.5 text-xs font-medium text-white bg-primary hover:bg-primary-hover rounded-md transition-colors"
                          >
                            Select
                          </button>
                          <a
                            href={pr.forkedPrUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-2.5 py-1.5 text-xs font-medium text-text-secondary border border-border rounded-md hover:bg-gray-50 transition-colors"
                          >
                            GitHub
                          </a>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {filteredRepos.length === 0 && searchFilter && (
          <div className="px-4 py-6 text-center">
            <p className="text-sm text-text-muted">No PRs match &ldquo;{searchFilter}&rdquo;</p>
          </div>
        )}
      </div>
    </div>
  );
}
