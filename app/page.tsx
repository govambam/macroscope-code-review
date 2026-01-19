"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import Image from "next/image";
import {
  useForksFromDb,
  useRefreshForksFromGitHub,
  useCheckPRBugs,
  useDeleteForksAndPRs,
  useAddCreatedPR,
  ForkRecord,
} from "@/lib/hooks/use-api";
import { CreatePRModal } from "@/components/CreatePRModal";
import { AnalysisModal } from "@/components/AnalysisModal";
import { UserDropdown } from "@/components/UserDropdown";
import { UserSelectionModal } from "@/components/UserSelectionModal";
import { TeamManagementSection, ApiConfigSection, PromptManagementSection } from "@/components/settings";

type MainTab = "forks" | "settings";

interface Selection {
  repos: Set<string>;
  prs: Set<string>; // Format: "repoName:prNumber"
}

export default function Home() {
  // Main tab state
  const [mainTab, setMainTab] = useState<MainTab>("forks");

  // My Forks state - using React Query
  const { data: forks = [], isLoading: forksInitialLoading } = useForksFromDb();
  const refreshForksMutation = useRefreshForksFromGitHub();
  const checkBugsMutation = useCheckPRBugs();
  const deleteMutation = useDeleteForksAndPRs();
  const addCreatedPR = useAddCreatedPR();

  const [searchQuery, setSearchQuery] = useState("");
  const [selection, setSelection] = useState<Selection>({ repos: new Set(), prs: new Set() });
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteResult, setDeleteResult] = useState<{ success: boolean; message: string } | null>(null);
  const [showOnlyWithIssues, setShowOnlyWithIssues] = useState(false);
  const [createdByFilter, setCreatedByFilter] = useState<string>("all");

  // Modal state
  const [createPRModalOpen, setCreatePRModalOpen] = useState(false);
  const [analysisModalOpen, setAnalysisModalOpen] = useState(false);
  const [analysisTargetPR, setAnalysisTargetPR] = useState<{ url: string; hasAnalysis: boolean } | null>(null);

  // Mobile sidebar state
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Auto-check missing bug counts when viewing forks tab
  useEffect(() => {
    if (mainTab === "forks" && forks.length > 0 && !checkBugsMutation.isPending) {
      for (const fork of forks) {
        for (const pr of fork.prs) {
          if (pr.macroscopeBugs === undefined) {
            checkBugsMutation.mutate({ repoName: fork.repoName, prNumber: pr.prNumber });
            return;
          }
        }
      }
    }
  }, [mainTab, forks, checkBugsMutation]);

  // Handle PR created from modal
  const handlePRCreated = (prUrl: string, forkUrl: string, prTitle: string, commitCount: number) => {
    addCreatedPR(prUrl, forkUrl, prTitle, commitCount);
  };

  // Handle analyze PR from create modal
  const handleAnalyzePRFromCreate = (prUrl: string) => {
    setCreatePRModalOpen(false);
    setAnalysisTargetPR({ url: prUrl, hasAnalysis: false });
    setAnalysisModalOpen(true);
  };

  // Open analysis modal from forks list
  const openAnalysisModal = (prUrl: string, hasAnalysis: boolean) => {
    setAnalysisTargetPR({ url: prUrl, hasAnalysis });
    setAnalysisModalOpen(true);
  };

  // Close analysis modal
  const closeAnalysisModal = () => {
    setAnalysisModalOpen(false);
    setAnalysisTargetPR(null);
  };

  // My Forks functions
  const refreshFromGitHub = useCallback(() => {
    setDeleteResult(null);
    refreshForksMutation.mutate();
  }, [refreshForksMutation]);

  const checkSinglePRBugs = (repoName: string, prNumber: number) => {
    checkBugsMutation.mutate({ repoName, prNumber });
  };

  // Derive unique creators from all PRs
  const uniqueCreators = useMemo(() => {
    const creators = new Set<string>();
    forks.forEach((fork) => {
      fork.prs.forEach((pr) => {
        if (pr.createdByUser) {
          creators.add(pr.createdByUser);
        }
      });
    });
    return Array.from(creators).sort();
  }, [forks]);

  const filteredForks = useMemo(() => {
    let result = forks;

    if (searchQuery.trim()) {
      const lowerQuery = searchQuery.toLowerCase();
      result = result
        .filter((fork) => {
          if (fork.repoName.toLowerCase().includes(lowerQuery)) return true;
          if (fork.prs.some((pr) => pr.prTitle.toLowerCase().includes(lowerQuery))) return true;
          return false;
        })
        .map((fork) => ({
          ...fork,
          prs: fork.prs.filter(
            (pr) =>
              fork.repoName.toLowerCase().includes(lowerQuery) ||
              pr.prTitle.toLowerCase().includes(lowerQuery)
          ),
        }));
    }

    if (showOnlyWithIssues) {
      result = result
        .map((fork) => ({
          ...fork,
          prs: fork.prs.filter((pr) => pr.macroscopeBugs !== undefined && pr.macroscopeBugs > 0),
        }))
        .filter((fork) => fork.prs.length > 0);
    }

    if (createdByFilter !== "all") {
      result = result
        .map((fork) => ({
          ...fork,
          prs: fork.prs.filter((pr) => pr.createdByUser === createdByFilter),
        }))
        .filter((fork) => fork.prs.length > 0);
    }

    return result;
  }, [forks, searchQuery, showOnlyWithIssues, createdByFilter]);

  const toggleRepoSelection = (repoName: string) => {
    setSelection((prev) => {
      const newRepos = new Set(prev.repos);
      const newPrs = new Set(prev.prs);
      const fork = forks.find((f) => f.repoName === repoName);

      if (newRepos.has(repoName)) {
        newRepos.delete(repoName);
        fork?.prs.forEach((pr) => newPrs.delete(`${repoName}:${pr.prNumber}`));
      } else {
        newRepos.add(repoName);
        fork?.prs.forEach((pr) => newPrs.add(`${repoName}:${pr.prNumber}`));
      }

      return { repos: newRepos, prs: newPrs };
    });
  };

  const togglePrSelection = (repoName: string, prNumber: number) => {
    setSelection((prev) => {
      const newPrs = new Set(prev.prs);
      const newRepos = new Set(prev.repos);
      const prKey = `${repoName}:${prNumber}`;
      const fork = forks.find((f) => f.repoName === repoName);

      if (newPrs.has(prKey)) {
        newPrs.delete(prKey);
        const hasOtherPrs = fork?.prs.some((pr) => newPrs.has(`${repoName}:${pr.prNumber}`));
        if (!hasOtherPrs) {
          newRepos.delete(repoName);
        }
      } else {
        newPrs.add(prKey);
        const allSelected = fork?.prs.every((pr) => newPrs.has(`${repoName}:${pr.prNumber}`));
        if (allSelected) {
          newRepos.add(repoName);
        }
      }

      return { repos: newRepos, prs: newPrs };
    });
  };

  const getRepoCheckboxState = (repoName: string): "checked" | "unchecked" | "indeterminate" => {
    const fork = forks.find((f) => f.repoName === repoName);
    if (!fork) return "unchecked";

    const selectedCount = fork.prs.filter((pr) => selection.prs.has(`${repoName}:${pr.prNumber}`)).length;

    if (selectedCount === 0) return "unchecked";
    if (selectedCount === fork.prs.length) return "checked";
    return "indeterminate";
  };

  const getSelectedCounts = () => {
    const reposToDelete = new Set<string>();
    const prsToDelete: { repo: string; prNumber: number; branchName: string }[] = [];

    forks.forEach((fork) => {
      const allPrsSelected = fork.prs.every((pr) =>
        selection.prs.has(`${fork.repoName}:${pr.prNumber}`)
      );
      if (allPrsSelected && fork.prs.length > 0) {
        reposToDelete.add(fork.repoName);
      }
    });

    selection.prs.forEach((prKey) => {
      const [repoName, prNumberStr] = prKey.split(":");
      if (!reposToDelete.has(repoName)) {
        const fork = forks.find((f) => f.repoName === repoName);
        const pr = fork?.prs.find((p) => p.prNumber === parseInt(prNumberStr));
        if (pr) {
          prsToDelete.push({ repo: repoName, prNumber: pr.prNumber, branchName: pr.branchName });
        }
      }
    });

    return { reposToDelete: Array.from(reposToDelete), prsToDelete };
  };

  const handleDelete = async () => {
    const { reposToDelete, prsToDelete } = getSelectedCounts();
    setShowDeleteConfirm(false);

    deleteMutation.mutate(
      { repos: reposToDelete, prs: prsToDelete },
      {
        onSuccess: (data) => {
          setSelection({ repos: new Set(), prs: new Set() });
          const message =
            data.errors.length > 0
              ? `Deleted ${data.deletedRepos.length} repos and ${data.deletedPRs.length} PRs. Some errors occurred.`
              : `Successfully deleted ${data.deletedRepos.length} repos and ${data.deletedPRs.length} PRs.`;
          setDeleteResult({ success: data.errors.length === 0, message });
        },
        onError: (error) => {
          setDeleteResult({
            success: false,
            message: error instanceof Error ? error.message : "Failed to delete",
          });
        },
      }
    );
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const totalSelected = selection.prs.size;
  const { reposToDelete, prsToDelete } = getSelectedCounts();

  // Derived loading states
  const forksLoading = refreshForksMutation.isPending;
  const deleteLoading = deleteMutation.isPending;
  const checkingPR = checkBugsMutation.isPending ? checkBugsMutation.variables : null;

  // Navigation items configuration
  const navItems = [
    {
      id: "forks" as MainTab,
      label: "My Forks",
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 00-1.883 2.542l.857 6a2.25 2.25 0 002.227 1.932H19.05a2.25 2.25 0 002.227-1.932l.857-6a2.25 2.25 0 00-1.883-2.542m-16.5 0V6A2.25 2.25 0 016 3.75h3.879a1.5 1.5 0 011.06.44l2.122 2.12a1.5 1.5 0 001.06.44H18A2.25 2.25 0 0120.25 9v.776" />
        </svg>
      ),
    },
    {
      id: "settings" as MainTab,
      label: "Settings",
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      ),
    },
  ];

  // Get page title based on current tab
  const getPageTitle = () => {
    switch (mainTab) {
      case "forks":
        return "My Forks";
      case "settings":
        return "Settings";
      default:
        return "PR Creator";
    }
  };

  return (
    <div className="min-h-screen flex bg-bg-subtle">
      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Left Sidebar */}
      <aside className={`
        w-64 bg-white border-r border-border flex flex-col fixed h-screen z-50
        transition-transform duration-200 ease-in-out
        ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
        lg:translate-x-0
      `}>
        {/* Logo/Branding */}
        <div className="h-16 flex items-center justify-between px-5 border-b border-border">
          <Image
            src="/Macroscope-text-logo.png"
            alt="Macroscope"
            width={140}
            height={28}
            className="h-7 w-auto"
            priority
          />
          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden p-1 text-text-secondary hover:text-accent"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4">
          <ul className="space-y-1">
            {navItems.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => {
                    setMainTab(item.id);
                    setSidebarOpen(false);
                  }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    mainTab === item.id
                      ? "bg-primary-light text-primary"
                      : "text-text-secondary hover:bg-bg-subtle hover:text-accent"
                  }`}
                >
                  {item.icon}
                  {item.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        {/* Sidebar Footer */}
        <div className="px-3 py-4 border-t border-border">
          <div className="text-xs text-text-muted">
            PR Creator Tool
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 lg:ml-64">
        {/* Top Header */}
        <header className="h-16 bg-white border-b border-border flex items-center justify-between px-4 lg:px-8 sticky top-0 z-10">
          <div className="flex items-center">
            {/* Mobile menu button */}
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden p-2 -ml-2 mr-2 text-text-secondary hover:text-accent"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <div className="flex items-center gap-3">
              {navItems.find(item => item.id === mainTab)?.icon && (
                <span className="text-text-secondary hidden sm:block">
                  {navItems.find(item => item.id === mainTab)?.icon}
                </span>
              )}
              <h1 className="text-lg font-semibold text-accent">{getPageTitle()}</h1>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Create New PR button - only show on forks tab */}
            {mainTab === "forks" && (
              <button
                onClick={() => setCreatePRModalOpen(true)}
                className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary-hover text-white font-medium rounded-lg transition-colors"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                <span className="hidden sm:inline">Create New PR</span>
                <span className="sm:hidden">New PR</span>
              </button>
            )}

            {/* User dropdown */}
            <UserDropdown />
          </div>
        </header>

        {/* Page Content */}
        <main className="p-4 lg:p-8">
          {mainTab === "forks" ? (
            <div>
              {/* My Forks Card */}
              <div className="bg-white border border-border rounded-xl shadow-sm p-6">
                {/* Search and Refresh */}
                <div className="flex gap-3 mb-6">
                  <div className="flex-1 relative">
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search repos or PR titles..."
                      className="w-full pl-10 pr-4 py-2.5 bg-white border border-border rounded-lg text-black placeholder:text-text-muted focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors"
                    />
                    <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  </div>
                  <button
                    onClick={refreshFromGitHub}
                    disabled={forksLoading}
                    className="px-4 py-2.5 bg-white border border-border rounded-lg text-accent font-medium hover:bg-bg-subtle transition-colors disabled:opacity-50 flex items-center gap-2"
                  >
                    {forksLoading ? (
                      <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                    ) : (
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                    )}
                    <span className="hidden sm:inline">Refresh</span>
                  </button>
                </div>

                {/* Filter options */}
                <div className="flex flex-wrap items-center gap-4 mb-4">
                  <div className="flex items-center">
                    <input
                      type="checkbox"
                      id="showOnlyWithIssues"
                      checked={showOnlyWithIssues}
                      onChange={(e) => setShowOnlyWithIssues(e.target.checked)}
                      className="h-4 w-4 rounded border-border text-primary focus:ring-primary focus:ring-offset-0 cursor-pointer"
                    />
                    <label
                      htmlFor="showOnlyWithIssues"
                      className="ml-2 text-sm text-text-secondary cursor-pointer select-none"
                    >
                      Show only PRs with issues
                    </label>
                  </div>

                  {uniqueCreators.length > 0 && (
                    <div className="flex items-center gap-2">
                      <label htmlFor="createdByFilter" className="text-sm text-text-secondary">
                        Created by:
                      </label>
                      <select
                        id="createdByFilter"
                        value={createdByFilter}
                        onChange={(e) => setCreatedByFilter(e.target.value)}
                        className="px-3 py-1.5 text-sm bg-white border border-border rounded-lg text-accent focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                      >
                        <option value="all">All users</option>
                        {uniqueCreators.map((creator) => (
                          <option key={creator} value={creator}>
                            {creator}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                {/* Error display */}
                {refreshForksMutation.isError && (
                  <div className="mb-4 p-3 rounded-lg bg-error-light border border-error/20 text-sm text-error">
                    {refreshForksMutation.error instanceof Error ? refreshForksMutation.error.message : "Failed to fetch forks"}
                  </div>
                )}

                {/* Delete result */}
                {deleteResult && (
                  <div className={`mb-4 p-3 rounded-lg border text-sm ${deleteResult.success ? "bg-success-light border-success/20 text-success" : "bg-error-light border-error/20 text-error"}`}>
                    {deleteResult.message}
                  </div>
                )}

                {/* Forks list */}
                {forksInitialLoading ? (
                  <div className="text-center py-12">
                    <svg className="animate-spin h-8 w-8 mx-auto text-primary" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    <p className="mt-4 text-sm text-text-muted">Loading forks...</p>
                  </div>
                ) : forks.length === 0 ? (
                  <div className="text-center py-12">
                    <svg className="mx-auto h-12 w-12 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                    </svg>
                    <h3 className="mt-4 text-sm font-medium text-accent">No forks tracked yet</h3>
                    <p className="mt-2 text-sm text-text-muted">
                      Click &quot;Create New PR&quot; to get started, or click &quot;Refresh&quot; to load existing forks from GitHub.
                    </p>
                    <button
                      onClick={() => setCreatePRModalOpen(true)}
                      className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary-hover text-white font-medium rounded-lg transition-colors"
                    >
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                      </svg>
                      Create New PR
                    </button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {filteredForks.map((fork) => {
                      const checkboxState = getRepoCheckboxState(fork.repoName);
                      return (
                        <div key={fork.repoName} className="border border-border rounded-lg overflow-hidden">
                          {/* Repo header */}
                          <div className="flex items-center gap-3 p-4 bg-bg-subtle border-b border-border">
                            <input
                              type="checkbox"
                              checked={checkboxState === "checked"}
                              ref={(el) => {
                                if (el) el.indeterminate = checkboxState === "indeterminate";
                              }}
                              onChange={() => toggleRepoSelection(fork.repoName)}
                              className="h-4 w-4 rounded border-border text-primary focus:ring-primary focus:ring-offset-0 cursor-pointer"
                            />
                            <div className="flex-1 min-w-0">
                              <a
                                href={fork.forkUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary hover:underline font-medium"
                              >
                                {fork.repoName}
                              </a>
                              <span className="ml-2 text-xs text-text-muted">
                                ({fork.prs.length} PR{fork.prs.length !== 1 ? "s" : ""})
                              </span>
                            </div>
                          </div>

                          {/* PRs table */}
                          {fork.prs.length > 0 && (
                            <div className="overflow-x-auto">
                              <table className="w-full text-sm">
                                <thead>
                                  <tr className="border-b border-border bg-white">
                                    <th className="w-16 pl-8 pr-2 py-2.5 text-left"></th>
                                    <th className="pl-0 pr-3 py-2.5 text-left font-medium text-text-secondary text-xs uppercase tracking-wide min-w-0">PR Name</th>
                                    <th className="px-3 py-2.5 text-center font-medium text-text-secondary text-xs uppercase tracking-wide whitespace-nowrap w-28">Action</th>
                                    <th className="px-3 py-2.5 text-center font-medium text-text-secondary text-xs uppercase tracking-wide whitespace-nowrap w-14">Bugs</th>
                                    <th className="px-3 py-2.5 text-left font-medium text-text-secondary text-xs uppercase tracking-wide whitespace-nowrap w-24">Created By</th>
                                    <th className="px-3 py-2.5 text-left font-medium text-text-secondary text-xs uppercase tracking-wide whitespace-nowrap w-36">Created</th>
                                    <th className="px-3 py-2.5 text-left font-medium text-text-secondary text-xs uppercase tracking-wide whitespace-nowrap w-36">Updated</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-border">
                                  {fork.prs.map((pr) => (
                                    <tr key={pr.prNumber} className="hover:bg-bg-subtle/50 transition-colors">
                                      {/* Checkbox - indented */}
                                      <td className="w-16 pl-8 pr-2 py-2.5">
                                        <input
                                          type="checkbox"
                                          checked={selection.prs.has(`${fork.repoName}:${pr.prNumber}`)}
                                          onChange={() => togglePrSelection(fork.repoName, pr.prNumber)}
                                          className="h-4 w-4 rounded border-border text-primary focus:ring-primary focus:ring-offset-0 cursor-pointer"
                                        />
                                      </td>

                                      {/* PR Name */}
                                      <td className="pl-0 pr-3 py-2.5 min-w-0 max-w-xs">
                                        <a
                                          href={pr.prUrl}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="text-primary hover:underline text-sm block truncate"
                                          title={`#${pr.prNumber}: ${pr.prTitle}`}
                                        >
                                          #{pr.prNumber}: {pr.prTitle}
                                        </a>
                                      </td>

                                      {/* Action button */}
                                      <td className="px-3 py-2.5 text-center w-28">
                                        <button
                                          onClick={() => openAnalysisModal(pr.prUrl, pr.hasAnalysis || false)}
                                          className={`text-xs px-2.5 py-1 rounded font-medium transition-colors whitespace-nowrap ${
                                            pr.hasAnalysis
                                              ? "bg-success/10 text-success hover:bg-success/20 border border-success/20"
                                              : "bg-primary/10 text-primary hover:bg-primary/20 border border-primary/20"
                                          }`}
                                        >
                                          {pr.hasAnalysis ? "View Analysis" : "Run Analysis"}
                                        </button>
                                      </td>

                                      {/* Bug count */}
                                      <td className="px-3 py-2.5 text-center w-14">
                                        {checkingPR?.repoName === fork.repoName && checkingPR?.prNumber === pr.prNumber ? (
                                          <svg className="w-4 h-4 animate-spin text-gray-400 mx-auto" fill="none" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                          </svg>
                                        ) : pr.macroscopeBugs === undefined ? (
                                          <button
                                            onClick={() => checkSinglePRBugs(fork.repoName, pr.prNumber)}
                                            className="text-gray-400 hover:text-primary transition-colors mx-auto"
                                            title="Check for bugs"
                                          >
                                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                            </svg>
                                          </button>
                                        ) : pr.macroscopeBugs > 0 ? (
                                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-xs font-medium rounded-full bg-orange-100 text-orange-700">
                                            {pr.macroscopeBugs}
                                          </span>
                                        ) : (
                                          <span className="inline-flex items-center px-1.5 py-0.5 text-xs font-medium rounded-full bg-green-100 text-green-700">
                                            0
                                          </span>
                                        )}
                                      </td>

                                      {/* Created by */}
                                      <td className="px-3 py-2.5 text-xs text-text-secondary whitespace-nowrap w-24">
                                        {pr.createdByUser || <span className="text-text-muted">—</span>}
                                      </td>

                                      {/* Created timestamp */}
                                      <td className="px-3 py-2.5 text-xs text-text-muted whitespace-nowrap w-36">
                                        {formatDate(pr.createdAt)}
                                      </td>

                                      {/* Updated timestamp */}
                                      <td className="px-3 py-2.5 text-xs text-text-muted whitespace-nowrap w-36">
                                        {pr.analyzedAt ? formatDate(pr.analyzedAt) : <span className="text-text-muted">—</span>}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Delete button */}
                {totalSelected > 0 && (
                  <div className="mt-6 pt-4 border-t border-border">
                    <button
                      onClick={() => setShowDeleteConfirm(true)}
                      disabled={deleteLoading}
                      className="px-4 py-2.5 bg-error hover:bg-error/90 text-white font-medium rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
                    >
                      {deleteLoading ? (
                        <>
                          <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                          </svg>
                          Deleting...
                        </>
                      ) : (
                        <>
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                          Delete Selected ({totalSelected} item{totalSelected !== 1 ? "s" : ""})
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>

              {/* Summary */}
              {forks.length > 0 && (
                <div className="mt-4 text-center">
                  <p className="text-sm text-text-muted">
                    Showing {filteredForks.length} fork{filteredForks.length !== 1 ? "s" : ""} with{" "}
                    {filteredForks.reduce((acc, f) => acc + f.prs.length, 0)} PR
                    {filteredForks.reduce((acc, f) => acc + f.prs.length, 0) !== 1 ? "s" : ""}
                  </p>
                </div>
              )}
            </div>
          ) : mainTab === "settings" ? (
            <div className="max-w-4xl mx-auto space-y-8">
              {/* Team Management Section */}
              <TeamManagementSection />

              {/* API Configuration Section */}
              <ApiConfigSection />

              {/* Prompt Management Section */}
              <PromptManagementSection />
            </div>
          ) : null}
        </main>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-lg max-w-md w-full p-6">
            <h3 className="text-lg font-semibold text-accent mb-2">Confirm Delete</h3>
            <p className="text-sm text-text-secondary mb-4">
              Are you sure you want to delete{" "}
              {reposToDelete.length > 0 && (
                <span className="font-medium">{reposToDelete.length} repo{reposToDelete.length !== 1 ? "s" : ""}</span>
              )}
              {reposToDelete.length > 0 && prsToDelete.length > 0 && " and "}
              {prsToDelete.length > 0 && (
                <span className="font-medium">{prsToDelete.length} PR{prsToDelete.length !== 1 ? "s" : ""}</span>
              )}
              ? This cannot be undone.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-4 py-2 text-sm font-medium text-text-secondary hover:text-accent transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                className="px-4 py-2 bg-error hover:bg-error/90 text-white text-sm font-medium rounded-lg transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create PR Modal */}
      <CreatePRModal
        isOpen={createPRModalOpen}
        onClose={() => setCreatePRModalOpen(false)}
        onPRCreated={handlePRCreated}
        onAnalyzePR={handleAnalyzePRFromCreate}
      />

      {/* Analysis Modal */}
      <AnalysisModal
        isOpen={analysisModalOpen}
        onClose={closeAnalysisModal}
        prUrl={analysisTargetPR?.url || null}
        hasExistingAnalysis={analysisTargetPR?.hasAnalysis}
      />

      {/* User Selection Modal - shown on first visit */}
      <UserSelectionModal />
    </div>
  );
}
