"use client";

import React, { useState, useCallback, useRef, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useQueryClient } from "@tanstack/react-query";
import { UserMenu } from "@/components/UserMenu";
import { MobileMenu } from "@/components/MobileMenu";
import { PRCandidate, DiscoverResponse } from "@/lib/types/discover";
import {
  PRSimulationStatus,
  PRStatusInfo,
  AnalysisApiResponse,
  PRAnalysisResult,
  isV2Result,
  resultHasMeaningfulBugs,
  getTotalBugCount,
  getOutreachReadyCount,
  getBestBugForEmail,
  commentToBugSnippet,
  AnalysisComment,
  CommentCategory,
} from "@/lib/types/prospector";

export default function ProspectorPage() {
  const { data: session, status: sessionStatus } = useSession();
  const queryClient = useQueryClient();

  // Section 1: Input state
  const [repoUrl, setRepoUrl] = useState("");
  const [searchMode, setSearchMode] = useState<"fast" | "advanced">("fast");
  const [showAddPR, setShowAddPR] = useState(false);
  const [showAddCommit, setShowAddCommit] = useState(false);
  const [specificPRUrl, setSpecificPRUrl] = useState("");
  const [commitRepoUrl, setCommitRepoUrl] = useState("");
  const [commitHash, setCommitHash] = useState("");
  const [specifyCommit, setSpecifyCommit] = useState(false);

  // Section 2: Candidates state
  const [candidates, setCandidates] = useState<PRCandidate[]>([]);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const [discoveryResult, setDiscoveryResult] = useState<DiscoverResponse | null>(null);

  // Multi-select
  const [selectedPRNumbers, setSelectedPRNumbers] = useState<Set<number>>(new Set());

  // Simulation queue
  const [simulationQueue, setSimulationQueue] = useState<number[]>([]);
  const [currentlySimulating, setCurrentlySimulating] = useState<number | null>(null);
  const isProcessingQueueRef = useRef(false);

  // Status per PR
  const [prStatus, setPrStatus] = useState<Record<number, PRStatusInfo>>({});

  // Results per PR
  const [analysisResults, setAnalysisResults] = useState<Record<number, AnalysisApiResponse | null>>({});
  const [generatedEmails, setGeneratedEmails] = useState<Record<number, string | null>>({});
  const [simulatedPRUrls, setSimulatedPRUrls] = useState<Record<number, string>>({});

  // Section 3: Currently viewing
  const [viewingPRNumber, setViewingPRNumber] = useState<number | null>(null);

  // Email state
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailCopied, setEmailCopied] = useState(false);

  // Filter state for discovery
  const [includeOpen, setIncludeOpen] = useState(true);
  const [includeMerged, setIncludeMerged] = useState(true);
  const [mergedWithinDays, setMergedWithinDays] = useState(30);
  const [minLinesChanged, setMinLinesChanged] = useState(50);
  const [showFilters, setShowFilters] = useState(false);


  // Helper to update PR status
  const updatePRStatus = useCallback((prNumber: number, status: PRStatusInfo) => {
    setPrStatus(prev => ({ ...prev, [prNumber]: status }));
  }, []);

  // Discover PRs
  const handleDiscover = useCallback(async () => {
    if (!repoUrl.trim()) return;

    setIsDiscovering(true);
    setDiscoveryError(null);
    setCandidates([]);
    setDiscoveryResult(null);
    setSelectedPRNumbers(new Set());
    setPrStatus({});
    setAnalysisResults({});
    setGeneratedEmails({});
    setSimulatedPRUrls({});
    setViewingPRNumber(null);

    try {
      const response = await fetch("/api/discover-prs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repo_url: repoUrl,
          mode: searchMode,
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
      setCandidates(data.candidates);
      setDiscoveryResult(data);
    } catch (err) {
      setDiscoveryError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsDiscovering(false);
    }
  }, [repoUrl, searchMode, includeOpen, includeMerged, mergedWithinDays, minLinesChanged]);

  // Clear results
  const handleClear = useCallback(() => {
    setCandidates([]);
    setDiscoveryResult(null);
    setDiscoveryError(null);
    setSelectedPRNumbers(new Set());
    setPrStatus({});
    setAnalysisResults({});
    setGeneratedEmails({});
    setSimulatedPRUrls({});
    setViewingPRNumber(null);
  }, []);

  // Toggle PR selection
  const togglePRSelection = useCallback((prNumber: number) => {
    setSelectedPRNumbers(prev => {
      const newSet = new Set(prev);
      if (newSet.has(prNumber)) {
        newSet.delete(prNumber);
      } else {
        newSet.add(prNumber);
      }
      return newSet;
    });
  }, []);

  // Select all PRs (only idle ones)
  const handleSelectAll = useCallback(() => {
    const idlePRs = candidates.filter(pr => {
      const status = prStatus[pr.number];
      return !status || status.status === "idle" || status.status === "error";
    });

    const allSelected = idlePRs.every(pr => selectedPRNumbers.has(pr.number));

    if (allSelected) {
      setSelectedPRNumbers(new Set());
    } else {
      setSelectedPRNumbers(new Set(idlePRs.map(pr => pr.number)));
    }
  }, [candidates, prStatus, selectedPRNumbers]);

  // Simulate a single PR
  const simulatePR = useCallback(async (
    prUrl: string,
    prNumber: number,
    cacheRepo: boolean = false
  ): Promise<{ success: boolean; simulatedPRUrl?: string; error?: string }> => {
    try {
      updatePRStatus(prNumber, { status: "simulating", progress: "Starting simulation..." });

      const response = await fetch("/api/create-pr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prUrl, cacheRepo }),
      });

      if (!response.ok || !response.body) {
        throw new Error(`HTTP error: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let simulatedPRUrl: string | undefined;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() || "";

        for (const event of events) {
          if (!event.trim()) continue;
          const dataMatch = event.match(/^data: (.+)$/m);
          if (!dataMatch) continue;

          try {
            const data = JSON.parse(dataMatch[1]);

            if (data.eventType === "status") {
              updatePRStatus(prNumber, {
                status: "simulating",
                progress: data.message,
              });
            } else if (data.eventType === "result") {
              if (data.success && data.prUrl) {
                simulatedPRUrl = data.prUrl;
                // Invalidate forks query so PR Reviews page shows new PR
                queryClient.invalidateQueries({ queryKey: ["forks"] });
              } else if (!data.success) {
                throw new Error(data.error || "Simulation failed");
              }
            }
          } catch (parseError) {
            // Ignore parse errors for individual events
          }
        }
      }

      if (simulatedPRUrl) {
        setSimulatedPRUrls(prev => ({ ...prev, [prNumber]: simulatedPRUrl! }));
        return { success: true, simulatedPRUrl };
      }
      throw new Error("No PR URL returned from simulation");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Simulation failed";
      updatePRStatus(prNumber, { status: "error", error: errorMessage });
      return { success: false, error: errorMessage };
    }
  }, [updatePRStatus, queryClient]);

  // Analyze a simulated PR
  const analyzePR = useCallback(async (
    prNumber: number,
    simulatedPRUrl: string,
    originalPRUrl: string
  ): Promise<AnalysisApiResponse | null> => {
    try {
      updatePRStatus(prNumber, { status: "analyzing", progress: "Analyzing comments..." });

      const response = await fetch("/api/analyze-pr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          forkedPrUrl: simulatedPRUrl,
          originalPrUrl: originalPRUrl,
        }),
      });

      const data: AnalysisApiResponse = await response.json();

      if (data.success) {
        setAnalysisResults(prev => ({ ...prev, [prNumber]: data }));

        // Set cached email if available
        if (data.cachedEmail) {
          setGeneratedEmails(prev => ({ ...prev, [prNumber]: data.cachedEmail! }));
        }

        return data;
      } else {
        throw new Error(data.error || "Analysis failed");
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Analysis failed";
      updatePRStatus(prNumber, { status: "error", error: errorMessage });
      return null;
    }
  }, [updatePRStatus]);

  // Generate email for a PR
  const generateEmail = useCallback(async (
    prNumber: number,
    analysisResponse: AnalysisApiResponse
  ): Promise<string | null> => {
    if (!analysisResponse.result || !analysisResponse.originalPrUrl) return null;
    if (!resultHasMeaningfulBugs(analysisResponse.result)) return null;

    const bestBug = getBestBugForEmail(analysisResponse.result);
    if (!bestBug) return null;

    try {
      const response = await fetch("/api/generate-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          originalPrUrl: analysisResponse.originalPrUrl,
          prTitle: analysisResponse.originalPrTitle,
          prStatus: analysisResponse.originalPrState,
          prMergedAt: analysisResponse.originalPrMergedAt,
          forkedPrUrl: analysisResponse.forkedPrUrl,
          bug: bestBug,
          totalBugs: getTotalBugCount(analysisResponse.result),
          analysisId: analysisResponse.analysisId,
        }),
      });

      const data = await response.json();
      if (data.success && data.email) {
        setGeneratedEmails(prev => ({ ...prev, [prNumber]: data.email }));
        return data.email;
      }
      return null;
    } catch {
      return null;
    }
  }, []);

  // Process simulation queue
  useEffect(() => {
    if (simulationQueue.length === 0 || isProcessingQueueRef.current) return;

    const processQueue = async () => {
      if (isProcessingQueueRef.current) return;
      isProcessingQueueRef.current = true;

      const queue = [...simulationQueue];
      setSimulationQueue([]);

      // Cache the repo for batch operations
      if (queue.length > 1 && discoveryResult) {
        try {
          await fetch("/api/cache/clone", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              owner: discoveryResult.owner,
              repo: discoveryResult.repo,
            }),
          });
        } catch {
          // Continue without caching
        }
      }

      for (const prNumber of queue) {
        const pr = candidates.find(c => c.number === prNumber);
        if (!pr) continue;

        setCurrentlySimulating(prNumber);
        setViewingPRNumber(prNumber);

        // Simulate
        const simResult = await simulatePR(pr.html_url, prNumber, queue.length > 1);

        if (simResult.success && simResult.simulatedPRUrl) {
          // Analyze
          const analysisResult = await analyzePR(prNumber, simResult.simulatedPRUrl, pr.html_url);

          if (analysisResult?.success && analysisResult.result) {
            // Generate email if bugs found
            if (resultHasMeaningfulBugs(analysisResult.result) && getOutreachReadyCount(analysisResult.result) > 0) {
              await generateEmail(prNumber, analysisResult);
            }

            updatePRStatus(prNumber, { status: "complete" });
          }
        }
      }

      setCurrentlySimulating(null);
      isProcessingQueueRef.current = false;
    };

    processQueue();
  }, [simulationQueue, candidates, discoveryResult, simulatePR, analyzePR, generateEmail, updatePRStatus]);

  // Handle batch simulation
  const handleBatchSimulate = useCallback(() => {
    const selected = Array.from(selectedPRNumbers);
    if (selected.length === 0) return;

    // Mark all as queued
    for (const prNumber of selected) {
      updatePRStatus(prNumber, { status: "queued" });
    }
    setSelectedPRNumbers(new Set());

    // Add to queue
    setSimulationQueue(selected);
  }, [selectedPRNumbers, updatePRStatus]);

  // Handle single PR simulation
  const handleSimulateSingle = useCallback((prNumber: number) => {
    updatePRStatus(prNumber, { status: "queued" });
    setSimulationQueue([prNumber]);
  }, [updatePRStatus]);

  // Handle retry
  const handleRetry = useCallback((prNumber: number) => {
    updatePRStatus(prNumber, { status: "idle" });
    setAnalysisResults(prev => {
      const newResults = { ...prev };
      delete newResults[prNumber];
      return newResults;
    });
    handleSimulateSingle(prNumber);
  }, [updatePRStatus, handleSimulateSingle]);

  // Add specific PR
  const handleAddSpecificPR = useCallback(() => {
    if (!specificPRUrl.trim()) return;

    // Parse PR URL to get PR number and details
    const match = specificPRUrl.match(/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/);
    if (!match) {
      setDiscoveryError("Invalid PR URL format. Expected: https://github.com/owner/repo/pull/123");
      return;
    }

    const [, owner, repo, prNumberStr] = match;
    const prNumber = parseInt(prNumberStr, 10);

    // Create a minimal PR candidate
    const newCandidate: PRCandidate = {
      number: prNumber,
      title: `PR #${prNumber}`,
      html_url: specificPRUrl,
      state: "open",
      merged: false,
      merged_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      additions: 0,
      deletions: 0,
      changed_files: 0,
      commits: 0,
      comments: 0,
      review_comments: 0,
      author: "",
      author_avatar_url: "",
      is_bot: false,
      labels: [],
      total_lines_changed: 0,
      complexity_score: 0,
      recency_score: 0,
      activity_score: 0,
      overall_score: 0,
    };

    setCandidates(prev => {
      // Check if already exists
      if (prev.some(c => c.number === prNumber && c.html_url === specificPRUrl)) {
        return prev;
      }
      return [newCandidate, ...prev];
    });

    if (!discoveryResult) {
      setDiscoveryResult({
        owner,
        repo,
        mode: "fast",
        total_prs_analyzed: 1,
        candidates: [newCandidate],
        analysis_time_ms: 0,
      });
    }

    setSpecificPRUrl("");
    setShowAddPR(false);
  }, [specificPRUrl, discoveryResult]);

  // Regenerate email
  const handleRegenerateEmail = useCallback(async () => {
    if (viewingPRNumber === null) return;
    const analysisResponse = analysisResults[viewingPRNumber];
    if (!analysisResponse) return;

    setEmailLoading(true);
    await generateEmail(viewingPRNumber, analysisResponse);
    setEmailLoading(false);
  }, [viewingPRNumber, analysisResults, generateEmail]);

  // Copy email to clipboard
  const handleCopyEmail = useCallback(async () => {
    if (viewingPRNumber === null) return;
    const email = generatedEmails[viewingPRNumber];
    if (!email) return;

    try {
      await navigator.clipboard.writeText(email);
      setEmailCopied(true);
      setTimeout(() => setEmailCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement("textarea");
      textarea.value = email;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setEmailCopied(true);
      setTimeout(() => setEmailCopied(false), 2000);
    }
  }, [viewingPRNumber, generatedEmails]);

  // Get category display info
  const getCategoryInfo = (category: CommentCategory) => {
    const categoryMap: Record<CommentCategory, { icon: string; color: string; label: string }> = {
      bug_critical: { icon: "🔴", color: "bg-red-100 text-red-800", label: "Critical" },
      bug_high: { icon: "🟠", color: "bg-orange-100 text-orange-800", label: "High" },
      bug_medium: { icon: "🟡", color: "bg-yellow-100 text-yellow-800", label: "Medium" },
      bug_low: { icon: "🔵", color: "bg-blue-100 text-blue-800", label: "Low" },
      suggestion: { icon: "💡", color: "bg-purple-100 text-purple-800", label: "Suggestion" },
      style: { icon: "✨", color: "bg-gray-100 text-gray-800", label: "Style" },
      nitpick: { icon: "📝", color: "bg-gray-100 text-gray-600", label: "Nitpick" },
    };
    return categoryMap[category] || { icon: "📝", color: "bg-gray-100 text-gray-800", label: category };
  };

  // Auth check
  if (sessionStatus === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">Welcome to Prospector</h1>
          <p className="text-gray-600 mb-6">Please sign in to continue</p>
          <Link
            href="/auth/signin"
            className="px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
          >
            Sign In
          </Link>
        </div>
      </div>
    );
  }

  const viewingAnalysis = viewingPRNumber !== null ? analysisResults[viewingPRNumber] : null;
  const viewingEmail = viewingPRNumber !== null ? generatedEmails[viewingPRNumber] : null;
  const viewingStatus = viewingPRNumber !== null ? prStatus[viewingPRNumber] : null;
  const viewingCandidate = viewingPRNumber !== null ? candidates.find(c => c.number === viewingPRNumber) : null;
  const viewingSimulatedUrl = viewingPRNumber !== null ? simulatedPRUrls[viewingPRNumber] : null;

  const idlePRs = candidates.filter(pr => {
    const status = prStatus[pr.number];
    return !status || status.status === "idle" || status.status === "error";
  });
  const allIdleSelected = idlePRs.length > 0 && idlePRs.every(pr => selectedPRNumbers.has(pr.number));

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-2">
              <span className="text-2xl hidden md:inline">🎯</span>
              <h1 className="text-xl font-semibold text-gray-900 hidden md:block">Prospector</h1>
            </div>

            <nav className="hidden md:flex items-center gap-6">
              <Link
                href="/prospector"
                className="text-indigo-600 font-medium border-b-2 border-indigo-600 pb-1"
              >
                Prospector
              </Link>
              <Link
                href="/"
                className="text-gray-600 hover:text-gray-900"
              >
                PR Reviews
              </Link>
              <Link
                href="/settings"
                className="text-gray-600 hover:text-gray-900"
              >
                Settings
              </Link>
            </nav>

            <UserMenu />
          </div>
        </div>
      </header>

      <MobileMenu />

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Left Column: Input + Candidates */}
          <div className="space-y-6">
            {/* Section 1: Repository Input */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <div className="mb-6">
                <h2 className="text-lg font-semibold text-gray-900">Find bugs worth emailing about</h2>
              </div>

              <div className="space-y-4">
                {/* Repository Input */}
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
                  <div className="flex rounded-lg border border-gray-300 overflow-hidden">
                    <button
                      onClick={() => setSearchMode("fast")}
                      className={`px-4 py-2 text-sm font-medium transition-colors ${
                        searchMode === "fast"
                          ? "bg-indigo-600 text-white"
                          : "bg-white text-gray-700 hover:bg-gray-50"
                      }`}
                    >
                      ⚡ Fast
                    </button>
                    <button
                      onClick={() => setSearchMode("advanced")}
                      className={`px-4 py-2 text-sm font-medium transition-colors ${
                        searchMode === "advanced"
                          ? "bg-indigo-600 text-white"
                          : "bg-white text-gray-700 hover:bg-gray-50"
                      }`}
                    >
                      🔬 Advanced
                    </button>
                  </div>
                  <span className="text-xs text-gray-500">
                    {searchMode === "fast" ? "~5 sec" : "~20 sec"}
                  </span>
                </div>

                {/* Filters */}
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
                    <div className="mt-3 p-4 bg-gray-50 rounded-lg grid grid-cols-2 gap-4">
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
                          className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
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
                          className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Discover Button */}
                <button
                  onClick={handleDiscover}
                  disabled={isDiscovering || !repoUrl.trim()}
                  className="w-full px-4 py-3 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                >
                  {isDiscovering ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      {searchMode === "fast" ? "Analyzing..." : "Analyzing with AI..."}
                    </span>
                  ) : (
                    <span className="flex items-center justify-center gap-2">
                      <span>🔍</span>
                      Discover High-Value PRs
                    </span>
                  )}
                </button>

                {/* Divider */}
                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-gray-200" />
                  </div>
                  <div className="relative flex justify-center text-sm">
                    <span className="px-2 bg-white text-gray-500">or</span>
                  </div>
                </div>

                {/* Secondary Actions */}
                <div className="flex gap-3">
                  <button
                    onClick={() => {
                      setShowAddPR(!showAddPR);
                      setShowAddCommit(false);
                    }}
                    className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50 transition-colors text-sm"
                  >
                    + Add Specific PR
                  </button>
                  <button
                    onClick={() => {
                      setShowAddCommit(!showAddCommit);
                      setShowAddPR(false);
                    }}
                    className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50 transition-colors text-sm"
                  >
                    + Latest Commit
                  </button>
                </div>

                {/* Add PR Form */}
                {showAddPR && (
                  <div className="p-4 bg-gray-50 rounded-lg space-y-3">
                    <input
                      type="text"
                      value={specificPRUrl}
                      onChange={(e) => setSpecificPRUrl(e.target.value)}
                      placeholder="https://github.com/owner/repo/pull/123"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      onKeyDown={(e) => e.key === "Enter" && handleAddSpecificPR()}
                    />
                    <button
                      onClick={handleAddSpecificPR}
                      disabled={!specificPRUrl.trim()}
                      className="w-full px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:bg-gray-400 text-sm"
                    >
                      Add PR
                    </button>
                  </div>
                )}

                {/* Add Commit Form */}
                {showAddCommit && (
                  <div className="p-4 bg-gray-50 rounded-lg space-y-3">
                    <input
                      type="text"
                      value={commitRepoUrl}
                      onChange={(e) => setCommitRepoUrl(e.target.value)}
                      placeholder="https://github.com/owner/repo"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    />
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={specifyCommit}
                        onChange={(e) => setSpecifyCommit(e.target.checked)}
                        className="rounded border-gray-300 text-indigo-600"
                      />
                      <span className="text-sm text-gray-700">Specify commit hash</span>
                    </label>
                    {specifyCommit && (
                      <input
                        type="text"
                        value={commitHash}
                        onChange={(e) => setCommitHash(e.target.value)}
                        placeholder="abc123..."
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono"
                      />
                    )}
                    <button
                      disabled={!commitRepoUrl.trim()}
                      className="w-full px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:bg-gray-400 text-sm"
                    >
                      Simulate Commit
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Discovery Error */}
            {discoveryError && (
              <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                {discoveryError}
              </div>
            )}

            {/* Section 2: PR Candidates */}
            {candidates.length > 0 && (
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                {/* Header */}
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="font-semibold text-gray-900">PR Candidates</h3>
                    {discoveryResult && (
                      <p className="text-sm text-gray-500">
                        Found {candidates.length} high-value PR{candidates.length !== 1 ? "s" : ""} from {discoveryResult.total_prs_analyzed} analyzed
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {discoveryResult && (
                      <span className="text-sm text-gray-500">
                        {discoveryResult.owner}/{discoveryResult.repo}
                      </span>
                    )}
                    <button
                      onClick={handleClear}
                      className="text-sm text-gray-500 hover:text-gray-700"
                    >
                      Clear ✕
                    </button>
                  </div>
                </div>

                {/* Batch Action Bar */}
                <div className="flex items-center gap-3 mb-4 p-3 bg-gray-50 rounded-lg">
                  <button
                    onClick={handleSelectAll}
                    disabled={idlePRs.length === 0}
                    className="text-sm text-indigo-600 hover:text-indigo-800 disabled:text-gray-400"
                  >
                    {allIdleSelected ? "Deselect All" : "Select All"}
                  </button>
                  <button
                    onClick={handleBatchSimulate}
                    disabled={selectedPRNumbers.size === 0}
                    className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                  >
                    Simulate Selected ({selectedPRNumbers.size})
                  </button>
                </div>

                {/* PR List */}
                <div className="space-y-3 max-h-[600px] overflow-y-auto">
                  {candidates.map((pr, index) => {
                    const status = prStatus[pr.number] || { status: "idle" as const };
                    const isSelectable = status.status === "idle" || status.status === "error";
                    const isSelected = selectedPRNumbers.has(pr.number);
                    const isViewing = viewingPRNumber === pr.number;
                    const bugCount = analysisResults[pr.number]?.result
                      ? getTotalBugCount(analysisResults[pr.number]!.result!)
                      : 0;

                    return (
                      <div
                        key={pr.number}
                        className={`border rounded-lg p-4 transition-colors ${
                          isViewing
                            ? "border-indigo-500 bg-indigo-50"
                            : "border-gray-200 hover:border-indigo-300"
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          {/* Checkbox */}
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => togglePRSelection(pr.number)}
                            disabled={!isSelectable}
                            className="mt-1 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 disabled:opacity-50"
                          />

                          <div className="flex-1 min-w-0">
                            {/* PR Info */}
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <span className="text-lg font-semibold text-indigo-600">#{index + 1}</span>
                              <span className={`px-2 py-0.5 text-xs font-medium rounded ${
                                pr.state === "open"
                                  ? "bg-green-100 text-green-700"
                                  : "bg-purple-100 text-purple-700"
                              }`}>
                                {pr.state === "open" ? "Open" : "Merged"}
                              </span>
                              <span className="text-sm text-gray-500">PR #{pr.number}</span>
                              {pr.overall_score > 0 && (
                                <span className="px-2 py-0.5 bg-orange-100 text-orange-700 text-xs rounded font-medium">
                                  🔥 Score {pr.overall_score}
                                </span>
                              )}
                            </div>

                            <a
                              href={pr.html_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sm font-medium text-gray-900 hover:text-indigo-600 line-clamp-2"
                            >
                              {pr.title}
                            </a>

                            <div className="flex items-center gap-3 mt-1 text-xs text-gray-500 flex-wrap">
                              <span>
                                <span className="text-green-600">+{pr.additions}</span>{" "}
                                <span className="text-red-600">-{pr.deletions}</span>
                              </span>
                              <span>{pr.changed_files} files</span>
                              <span>{pr.commits} commits</span>
                              {pr.author && pr.author_avatar_url && (
                                <span className="flex items-center gap-1">
                                  <Image
                                    src={pr.author_avatar_url}
                                    alt={pr.author}
                                    width={14}
                                    height={14}
                                    className="rounded-full"
                                    unoptimized
                                  />
                                  {pr.author}
                                </span>
                              )}
                            </div>

                            {/* Risk categories */}
                            {pr.risk_categories && pr.risk_categories.length > 0 && (
                              <div className="flex items-center gap-1 mt-2 flex-wrap">
                                <span className="text-xs text-gray-500">Risk:</span>
                                {pr.risk_categories.map(cat => (
                                  <span key={cat} className="px-2 py-0.5 bg-red-50 text-red-600 text-xs rounded">
                                    {cat}
                                  </span>
                                ))}
                              </div>
                            )}

                            {/* Status Display */}
                            {status.status !== "idle" && (
                              <div className="mt-2">
                                {status.status === "queued" && (
                                  <span className="text-sm text-gray-500">Queued...</span>
                                )}
                                {(status.status === "simulating" || status.status === "analyzing") && (
                                  <span className="flex items-center gap-2 text-sm text-indigo-600">
                                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                    </svg>
                                    {status.progress || "Processing..."}
                                  </span>
                                )}
                                {status.status === "complete" && (
                                  <span className="text-sm text-green-600">
                                    ✅ {bugCount > 0 ? `${bugCount} bug${bugCount !== 1 ? "s" : ""} found` : "No bugs"}
                                  </span>
                                )}
                                {status.status === "error" && (
                                  <span className="text-sm text-red-600">
                                    ❌ Error: {status.error}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>

                          {/* Action Button */}
                          <div className="flex-shrink-0">
                            {status.status === "idle" && (
                              <button
                                onClick={() => handleSimulateSingle(pr.number)}
                                className="px-3 py-1.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
                              >
                                Simulate →
                              </button>
                            )}
                            {status.status === "complete" && (
                              <button
                                onClick={() => setViewingPRNumber(pr.number)}
                                className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                                  isViewing
                                    ? "bg-indigo-600 text-white"
                                    : "border border-indigo-600 text-indigo-600 hover:bg-indigo-50"
                                }`}
                              >
                                {isViewing ? "Viewing" : "View Analysis"}
                              </button>
                            )}
                            {status.status === "error" && (
                              <button
                                onClick={() => handleRetry(pr.number)}
                                className="px-3 py-1.5 border border-red-600 text-red-600 text-sm font-medium rounded-lg hover:bg-red-50 transition-colors"
                              >
                                Retry
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Right Column: Section 3 - Analysis & Outreach */}
          <div className="lg:sticky lg:top-24 lg:self-start">
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 min-h-[400px]">
              {/* Empty State */}
              {!viewingPRNumber && !currentlySimulating && (
                <div className="flex flex-col items-center justify-center h-[400px] text-center">
                  <div className="text-4xl mb-4">📋</div>
                  <h3 className="text-lg font-medium text-gray-900 mb-2">
                    Select a PR above to analyze
                  </h3>
                  <p className="text-sm text-gray-500">
                    Discover PRs and click &quot;Simulate&quot; to find bugs
                  </p>
                </div>
              )}

              {/* Loading State */}
              {viewingPRNumber && viewingStatus && (viewingStatus.status === "simulating" || viewingStatus.status === "analyzing" || viewingStatus.status === "queued") && (
                <div>
                  <div className="mb-4">
                    <h3 className="font-semibold text-gray-900">
                      PR #{viewingCandidate?.number} · {viewingCandidate?.title?.substring(0, 50)}...
                    </h3>
                  </div>
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <svg className="animate-spin h-8 w-8 text-indigo-600 mb-4" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    <h4 className="text-lg font-medium text-gray-900 mb-2">
                      {viewingStatus.status === "queued" ? "Queued" : "Simulating PR..."}
                    </h4>
                    <p className="text-sm text-gray-500">
                      {viewingStatus.progress || "This may take 30-60 seconds"}
                    </p>
                  </div>
                </div>
              )}

              {/* Results State */}
              {viewingPRNumber && viewingAnalysis && viewingStatus?.status === "complete" && (
                <div className="space-y-6">
                  {/* PR Header */}
                  <div className="border-b border-gray-200 pb-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="font-semibold text-gray-900">
                          PR #{viewingCandidate?.number} · {viewingCandidate?.title?.substring(0, 40)}...
                        </h3>
                        {viewingSimulatedUrl && (
                          <a
                            href={viewingSimulatedUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm text-indigo-600 hover:text-indigo-800"
                          >
                            View simulated PR ↗
                          </a>
                        )}
                      </div>
                      {viewingCandidate && (
                        <span className={`px-2 py-0.5 text-xs font-medium rounded ${
                          viewingCandidate.state === "open"
                            ? "bg-green-100 text-green-700"
                            : "bg-purple-100 text-purple-700"
                        }`}>
                          {viewingCandidate.state === "open" ? "Open" : "Merged"}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Analysis Section */}
                  {viewingAnalysis.result && (
                    <div className="border border-gray-200 rounded-lg p-4">
                      <h4 className="font-medium text-gray-900 mb-3">Analysis</h4>

                      {isV2Result(viewingAnalysis.result) ? (
                        <>
                          {/* Stats */}
                          <div className="flex flex-wrap gap-4 mb-4 text-sm">
                            <span className="text-gray-600">
                              ⚠️ {viewingAnalysis.result.total_comments_processed} comment{viewingAnalysis.result.total_comments_processed !== 1 ? "s" : ""} analyzed
                            </span>
                            <span className={viewingAnalysis.result.meaningful_bugs_count > 0 ? "text-orange-600 font-medium" : "text-gray-600"}>
                              {viewingAnalysis.result.meaningful_bugs_count} meaningful bug{viewingAnalysis.result.meaningful_bugs_count !== 1 ? "s" : ""}
                            </span>
                            {viewingAnalysis.result.outreach_ready_count > 0 && (
                              <span className="text-green-600 font-medium">
                                {viewingAnalysis.result.outreach_ready_count} outreach ready
                              </span>
                            )}
                          </div>

                          {/* Recommendation */}
                          {viewingAnalysis.result.summary.recommendation && (
                            <p className="text-sm text-gray-700 mb-4 p-3 bg-gray-50 rounded-lg">
                              <span className="font-medium">Recommendation:</span> {viewingAnalysis.result.summary.recommendation}
                            </p>
                          )}

                          {/* Comments */}
                          <div className="space-y-3 max-h-[300px] overflow-y-auto">
                            {viewingAnalysis.result.all_comments.map((comment, index) => {
                              const catInfo = getCategoryInfo(comment.category);
                              const isBestBug = viewingAnalysis.result && isV2Result(viewingAnalysis.result) && viewingAnalysis.result.best_bug_for_outreach_index === index;

                              return (
                                <div
                                  key={index}
                                  className={`p-3 border rounded-lg ${
                                    isBestBug ? "border-yellow-400 bg-yellow-50" : "border-gray-200"
                                  }`}
                                >
                                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                                    <span className={`px-2 py-0.5 text-xs font-medium rounded ${catInfo.color}`}>
                                      {catInfo.icon} {catInfo.label}
                                    </span>
                                    {comment.is_meaningful_bug && (
                                      <span className="px-2 py-0.5 bg-red-100 text-red-700 text-xs rounded">
                                        Bug
                                      </span>
                                    )}
                                    {comment.outreach_ready && (
                                      <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded">
                                        Outreach Ready
                                      </span>
                                    )}
                                    {isBestBug && (
                                      <span className="px-2 py-0.5 bg-yellow-100 text-yellow-800 text-xs rounded font-medium">
                                        ⭐ Best for Outreach
                                      </span>
                                    )}
                                  </div>
                                  <h5 className="font-medium text-gray-900 text-sm">{comment.title}</h5>
                                  <p className="text-sm text-gray-600 mt-1">{comment.explanation_short || comment.explanation}</p>
                                  {comment.impact_scenario && (
                                    <p className="text-xs text-gray-500 mt-2">
                                      <span className="font-medium">Impact:</span> {comment.impact_scenario}
                                    </p>
                                  )}
                                  <p className="text-xs text-gray-400 mt-1">{comment.file_path}</p>
                                </div>
                              );
                            })}
                          </div>
                        </>
                      ) : (
                        // V1 format fallback
                        <div>
                          {resultHasMeaningfulBugs(viewingAnalysis.result) ? (
                            <p className="text-sm text-orange-600">
                              Found {getTotalBugCount(viewingAnalysis.result)} bug(s)
                            </p>
                          ) : (
                            <p className="text-sm text-gray-600">
                              {(viewingAnalysis.result as { reason?: string }).reason || "No meaningful bugs found"}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Email Section */}
                  <div className="border border-gray-200 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="font-medium text-gray-900">Email</h4>
                      {viewingEmail && (
                        <button
                          onClick={handleRegenerateEmail}
                          disabled={emailLoading}
                          className="text-sm text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
                        >
                          {emailLoading ? "Regenerating..." : "Regenerate 🔄"}
                        </button>
                      )}
                    </div>

                    {viewingAnalysis.result && resultHasMeaningfulBugs(viewingAnalysis.result) && getOutreachReadyCount(viewingAnalysis.result) > 0 ? (
                      viewingEmail ? (
                        <>
                          <div className="bg-gray-50 rounded-lg p-4 mb-4 text-sm whitespace-pre-wrap font-mono max-h-[300px] overflow-y-auto">
                            {viewingEmail}
                          </div>
                          <div className="flex gap-3">
                            <button
                              onClick={handleCopyEmail}
                              className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors text-sm font-medium"
                            >
                              {emailCopied ? "✓ Copied!" : "📋 Copy to Clipboard"}
                            </button>
                          </div>
                        </>
                      ) : (
                        <div className="text-center py-6">
                          {emailLoading ? (
                            <div className="flex items-center justify-center gap-2 text-sm text-gray-500">
                              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                              </svg>
                              Generating email...
                            </div>
                          ) : (
                            <button
                              onClick={handleRegenerateEmail}
                              className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm"
                            >
                              Generate Email
                            </button>
                          )}
                        </div>
                      )
                    ) : (
                      <div className="text-center py-6 text-gray-500 text-sm">
                        <p className="font-medium">⚠️ No email generated</p>
                        <p className="mt-1">No bugs suitable for outreach found in this PR.</p>
                        <p className="mt-2">Try analyzing another PR from the candidates above.</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Error State */}
              {viewingPRNumber && viewingStatus?.status === "error" && (
                <div className="flex flex-col items-center justify-center h-[400px] text-center">
                  <div className="text-4xl mb-4">❌</div>
                  <h3 className="text-lg font-medium text-red-600 mb-2">
                    Simulation Failed
                  </h3>
                  <p className="text-sm text-gray-500 mb-4">
                    {viewingStatus.error}
                  </p>
                  <button
                    onClick={() => handleRetry(viewingPRNumber)}
                    className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm"
                  >
                    Retry
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
