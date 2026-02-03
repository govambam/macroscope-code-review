"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { UserMenu } from "@/components/UserMenu";
import { MobileMenu } from "@/components/MobileMenu";

type SessionStatus = "all" | "in_progress" | "completed";
type SortBy = "updated_at" | "created_at" | "company_name";

interface SessionWithStats {
  id: number;
  company_name: string;
  github_org: string | null;
  github_repo: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  status: "in_progress" | "completed";
  notes: string | null;
  pr_count: number;
  bugs_found: number;
  emails_sent: number;
}

export default function ProspectorPage() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<SessionStatus>("all");
  const [sortBy, setSortBy] = useState<SortBy>("updated_at");

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Fetch sessions
  const {
    data: sessionsData,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["sessions", debouncedSearch, statusFilter, sortBy],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (statusFilter !== "all") params.set("status", statusFilter);
      params.set("sortBy", sortBy);
      params.set("sortOrder", "desc");

      const response = await fetch(`/api/sessions?${params}`);
      const data = await response.json();
      if (!data.success) throw new Error(data.error);
      return data as { sessions: SessionWithStats[]; total: number };
    },
    staleTime: 30 * 1000,
  });

  const sessions = sessionsData?.sessions || [];

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return "just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
    });
  };

  return (
    <div className="min-h-screen flex">
      {/* Mobile Menu */}
      <MobileMenu />

      {/* Left Sidebar */}
      <aside className="hidden md:flex w-64 bg-white border-r border-border flex-col shrink-0 sticky top-0 h-screen overflow-y-auto">
        <div className="h-16 flex items-center px-6 border-b border-border">
          <div className="flex flex-col">
            <span className="text-lg font-semibold text-accent tracking-tight" style={{ fontFamily: 'var(--font-geist-mono)' }}>Code Review Studio</span>
            <span className="text-xs text-text-muted">Powered by <span className="text-primary">Macroscope</span></span>
          </div>
        </div>

        <nav className="flex-1 px-4 py-6">
          <div className="space-y-1">
            <div className="w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-lg bg-primary/10 text-primary">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              Prospector
            </div>
            <Link
              href="/"
              className="w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-lg text-text-secondary hover:bg-bg-subtle hover:text-accent transition-colors"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              PR Reviews
            </Link>
            <Link
              href="/settings"
              className="w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-lg text-text-secondary hover:bg-bg-subtle hover:text-accent transition-colors"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Settings
            </Link>
          </div>
        </nav>
        <UserMenu />
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 bg-bg-subtle min-h-screen md:h-screen overflow-y-auto pt-14 md:pt-0">
        {/* Header Section */}
        <div className="md:sticky md:top-0 z-10 bg-bg-subtle px-4 md:px-8 pt-4 md:pt-8 pb-4 border-b border-border md:shadow-sm">
          <div className="flex flex-col gap-3 mb-4">
            <div className="flex items-start justify-between">
              <div>
                <h1 className="text-xl md:text-2xl font-semibold text-accent tracking-tight">Prospector</h1>
                <p className="mt-1 md:mt-2 text-sm md:text-base text-text-secondary">
                  Guided prospecting sessions - one company at a time
                </p>
              </div>
              <Link
                href="/prospector/new"
                className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-primary hover:bg-primary-hover text-white text-sm font-medium rounded-lg transition-colors"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                New Session
              </Link>
            </div>
          </div>

          {/* Search and Filters */}
          <div className="flex items-center gap-3 flex-wrap">
            {/* Search */}
            <div className="relative flex-1 min-w-[200px] max-w-md">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by company name..."
                className="w-full pl-9 pr-3 py-2 min-h-[44px] bg-white border border-border rounded-lg text-sm focus:ring-2 focus:ring-primary focus:border-primary"
              />
            </div>

            {/* Status Filter */}
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as SessionStatus)}
              className="px-3 py-2 min-h-[44px] bg-white border border-border rounded-lg text-sm text-accent focus:ring-2 focus:ring-primary focus:border-primary"
            >
              <option value="all">All Status</option>
              <option value="in_progress">In Progress</option>
              <option value="completed">Completed</option>
            </select>

            {/* Sort */}
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortBy)}
              className="px-3 py-2 min-h-[44px] bg-white border border-border rounded-lg text-sm text-accent focus:ring-2 focus:ring-primary focus:border-primary"
            >
              <option value="updated_at">Last Updated</option>
              <option value="created_at">Created</option>
              <option value="company_name">Company Name</option>
            </select>

            {/* Count */}
            {sessionsData && (
              <span className="text-sm text-text-muted">
                {sessionsData.total} session{sessionsData.total !== 1 ? "s" : ""}
              </span>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="px-4 md:px-8 py-4 md:py-6">
          <div className="bg-white border border-border rounded-xl shadow-sm overflow-hidden">
            {isLoading ? (
              <div className="flex items-center justify-center py-16">
                <svg className="animate-spin h-8 w-8 text-primary" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              </div>
            ) : error ? (
              <div className="p-6 text-center">
                <p className="text-error text-sm">{error instanceof Error ? error.message : "Failed to load sessions"}</p>
              </div>
            ) : sessions.length === 0 ? (
              <div className="text-center py-16 px-6">
                <svg className="mx-auto h-16 w-16 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                <h3 className="mt-4 text-lg font-medium text-accent">
                  {debouncedSearch || statusFilter !== "all"
                    ? "No sessions match your filters"
                    : "No prospecting sessions yet"}
                </h3>
                <p className="mt-2 text-sm text-text-muted max-w-sm mx-auto">
                  {debouncedSearch || statusFilter !== "all"
                    ? "Try adjusting your search or filters."
                    : "Start a new session to begin prospecting a company. Each session guides you through finding PRs, running analysis, and generating outreach."}
                </p>
                {!debouncedSearch && statusFilter === "all" && (
                  <Link
                    href="/prospector/new"
                    className="mt-6 inline-flex items-center gap-1.5 px-4 py-2.5 bg-primary hover:bg-primary-hover text-white text-sm font-medium rounded-lg transition-colors"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                    </svg>
                    Create First Session
                  </Link>
                )}
              </div>
            ) : (
              <>
                {/* Table Header */}
                <div className="hidden md:grid grid-cols-[1fr_120px_100px_100px_140px_120px] gap-4 px-6 py-3 bg-gray-50 border-b border-border text-xs font-medium text-text-muted uppercase tracking-wide">
                  <div>Company</div>
                  <div>Status</div>
                  <div className="text-center">PRs</div>
                  <div className="text-center">Bugs</div>
                  <div>Last Updated</div>
                  <div>Created By</div>
                </div>

                {/* Session Rows */}
                {sessions.map((session) => (
                  <div
                    key={session.id}
                    onClick={() => router.push(`/prospector/${session.id}`)}
                    className="grid grid-cols-1 md:grid-cols-[1fr_120px_100px_100px_140px_120px] gap-2 md:gap-4 px-6 py-4 border-b border-border last:border-b-0 hover:bg-bg-subtle cursor-pointer transition-colors"
                  >
                    {/* Company Name */}
                    <div className="flex flex-col min-w-0">
                      <span className="font-medium text-accent truncate">{session.company_name}</span>
                      {(session.github_org || session.github_repo) && (
                        <span className="text-xs text-text-muted truncate mt-0.5">
                          {session.github_org
                            ? `org: ${session.github_org}`
                            : session.github_repo
                              ? `repo: ${session.github_repo}`
                              : ""}
                        </span>
                      )}
                    </div>

                    {/* Status Badge */}
                    <div className="flex items-center">
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${
                        session.status === "in_progress"
                          ? "bg-blue-50 text-blue-700"
                          : "bg-green-50 text-green-700"
                      }`}>
                        {session.status === "in_progress" ? "In Progress" : "Completed"}
                      </span>
                    </div>

                    {/* PR Count */}
                    <div className="flex items-center justify-center md:justify-center">
                      <span className="text-sm text-accent tabular-nums">{session.pr_count}</span>
                      <span className="text-xs text-text-muted ml-1 md:hidden">PRs</span>
                    </div>

                    {/* Bugs Found */}
                    <div className="flex items-center justify-center md:justify-center">
                      <span className={`text-sm tabular-nums ${session.bugs_found > 0 ? "text-orange-600 font-medium" : "text-text-muted"}`}>
                        {session.bugs_found}
                      </span>
                      <span className="text-xs text-text-muted ml-1 md:hidden">bugs</span>
                    </div>

                    {/* Last Updated */}
                    <div className="flex items-center">
                      <span className="text-sm text-text-muted">{formatDate(session.updated_at)}</span>
                    </div>

                    {/* Created By */}
                    <div className="flex items-center">
                      <span className="text-sm text-text-muted truncate">{session.created_by}</span>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
