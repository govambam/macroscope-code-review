"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import Image from "next/image";
import Link from "next/link";

type CreateMode = "commit" | "pr";

// PR Analysis types
interface BugSnippet {
  title: string;
  explanation: string;
  file_path: string;
  severity: "critical" | "high" | "medium";
  is_most_impactful: boolean;
}

interface NoMeaningfulBugsResult {
  meaningful_bugs_found: false;
  reason: string;
}

interface MeaningfulBugsResult {
  meaningful_bugs_found: true;
  bugs: BugSnippet[];
  total_macroscope_bugs_found: number;
}

type PRAnalysisResult = NoMeaningfulBugsResult | MeaningfulBugsResult;

// Email Generation types
interface EmailGenerationResponse {
  success: boolean;
  email?: string;
  error?: string;
}

interface AnalysisApiResponse {
  success: boolean;
  result?: PRAnalysisResult;
  error?: string;
  forkedPrUrl?: string;
  originalPrUrl?: string;
  originalPrTitle?: string;
  cached?: boolean;
  analysisId?: number;
  cachedEmail?: string;
}

interface ApiResponse {
  success: boolean;
  prUrl?: string;
  message: string;
  commitHash?: string;
  forkUrl?: string;
  error?: string;
  commitCount?: number;
  originalPrNumber?: number;
}

interface StatusMessage {
  type: "info" | "success" | "error" | "progress";
  text: string;
  timestamp: string;
  step?: number;
  totalSteps?: number;
}

interface PRRecord {
  prNumber: number;
  prUrl: string;
  prTitle: string;
  createdAt: string;
  updatedAt?: string | null;
  commitCount: number;
  state: string;
  branchName: string;
  macroscopeBugs?: number;
  hasAnalysis?: boolean;
  analysisId?: number | null;
}

interface ForkRecord {
  repoName: string;
  forkUrl: string;
  createdAt: string;
  prs: PRRecord[];
}

interface Selection {
  repos: Set<string>;
  prs: Set<string>; // Format: "repoName:prNumber"
}

export default function Home() {
  // Create PR modal state
  const [showCreatePRModal, setShowCreatePRModal] = useState(false);
  const [createPRModalExpanded, setCreatePRModalExpanded] = useState(false);
  const [createMode, setCreateMode] = useState<CreateMode>("pr");
  const [repoUrl, setRepoUrl] = useState("");
  const [specifyCommit, setSpecifyCommit] = useState(false);
  const [commitHash, setCommitHash] = useState("");
  const [prUrl, setPrUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<StatusMessage[]>([]);
  const [result, setResult] = useState<ApiResponse | null>(null);

  // My Forks tab state
  const [forks, setForks] = useState<ForkRecord[]>([]);
  const [forksLoading, setForksLoading] = useState(false);
  const [forksError, setForksError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selection, setSelection] = useState<Selection>({ repos: new Set(), prs: new Set() });
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteResult, setDeleteResult] = useState<{ success: boolean; message: string } | null>(null);
  const [showOnlyWithIssues, setShowOnlyWithIssues] = useState(false);
  const [checkingPR, setCheckingPR] = useState<{ repo: string; pr: number } | null>(null);
  const [expandedRepos, setExpandedRepos] = useState<Set<string>>(new Set());
  const forksLoadedRef = useRef(false);
  const checkedPRsRef = useRef<Set<string>>(new Set());
  const expandedReposInitialized = useRef(false);

  // PR Analysis tab state
  const [analysisForkedUrl, setAnalysisForkedUrl] = useState("");
  const [analysisOriginalUrl, setAnalysisOriginalUrl] = useState("");
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AnalysisApiResponse | null>(null);
  const [copiedBugIndex, setCopiedBugIndex] = useState<number | null>(null);
  const [currentAnalysisId, setCurrentAnalysisId] = useState<number | null>(null);
  const [isViewingCached, setIsViewingCached] = useState(false);
  const [expectingCachedResult, setExpectingCachedResult] = useState(false);

  // Email Generation state
  const [emailLoading, setEmailLoading] = useState(false);
  const [generatedEmail, setGeneratedEmail] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailCopied, setEmailCopied] = useState(false);

  // Analysis Modal state
  const [showAnalysisModal, setShowAnalysisModal] = useState(false);
  const [modalTab, setModalTab] = useState<"analysis" | "email">("analysis");
  const [modalExpanded, setModalExpanded] = useState(false);
  const [selectedPrTitle, setSelectedPrTitle] = useState("");

  // Load forks from database on mount
  useEffect(() => {
    const loadForksFromDatabase = async () => {
      try {
        // Load from database first (fast, no GitHub API calls)
        const response = await fetch("/api/forks?source=db");
        const data = await response.json();

        if (data.success && data.forks && data.forks.length > 0) {
          setForks(data.forks);
          localStorage.setItem("macroscope-forks", JSON.stringify(data.forks));
          forksLoadedRef.current = true;
        } else {
          // Fallback to localStorage if database is empty
          const stored = localStorage.getItem("macroscope-forks");
          if (stored) {
            try {
              setForks(JSON.parse(stored));
            } catch {
              // Invalid data, ignore
            }
          }
        }
      } catch {
        // If API fails, fallback to localStorage
        const stored = localStorage.getItem("macroscope-forks");
        if (stored) {
          try {
            setForks(JSON.parse(stored));
          } catch {
            // Invalid data, ignore
          }
        }
      }
    };

    loadForksFromDatabase();
  }, []);

  // Initialize expanded repos from localStorage and auto-expand repos with PRs
  useEffect(() => {
    if (forks.length > 0 && !expandedReposInitialized.current) {
      // Only expand repos that have PRs
      const reposWithPRs = new Set(forks.filter(f => f.prs.length > 0).map(f => f.repoName));

      // Try to load from localStorage first
      const stored = localStorage.getItem("macroscope-expanded-repos");
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          // Filter to only include repos that still have PRs
          const validExpanded = parsed.filter((repoName: string) => reposWithPRs.has(repoName));
          setExpandedRepos(new Set(validExpanded));
        } catch {
          // If invalid, expand all repos with PRs by default
          setExpandedRepos(reposWithPRs);
        }
      } else {
        // Default: expand all repos with PRs
        setExpandedRepos(reposWithPRs);
      }
      expandedReposInitialized.current = true;
    }
  }, [forks]);

  // Save expanded repos to localStorage when it changes
  useEffect(() => {
    if (expandedReposInitialized.current) {
      localStorage.setItem("macroscope-expanded-repos", JSON.stringify([...expandedRepos]));
    }
  }, [expandedRepos]);

  // Auto-check missing bug counts when forks are loaded
  useEffect(() => {
    if (forks.length > 0) {
      // Find PRs with missing bug counts that we haven't already checked
      const prsToCheck: { repoName: string; prNumber: number }[] = [];
      forks.forEach((fork) => {
        fork.prs.forEach((pr) => {
          const prKey = `${fork.repoName}:${pr.prNumber}`;
          if (pr.macroscopeBugs === undefined && !checkedPRsRef.current.has(prKey)) {
            prsToCheck.push({ repoName: fork.repoName, prNumber: pr.prNumber });
            checkedPRsRef.current.add(prKey); // Mark as being checked
          }
        });
      });

      // Check each PR sequentially
      if (prsToCheck.length > 0) {
        const checkBugs = async () => {
          for (const { repoName, prNumber } of prsToCheck) {
            try {
              const response = await fetch("/api/forks/check-bugs", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ repoName, prNumber }),
              });
              const data = await response.json();
              if (data.success) {
                setForks((prevForks) => {
                  const updatedForks = prevForks.map((fork) => {
                    if (fork.repoName === repoName) {
                      return {
                        ...fork,
                        prs: fork.prs.map((pr) => {
                          if (pr.prNumber === prNumber) {
                            return { ...pr, macroscopeBugs: data.bugCount };
                          }
                          return pr;
                        }),
                      };
                    }
                    return fork;
                  });
                  localStorage.setItem("macroscope-forks", JSON.stringify(updatedForks));
                  return updatedForks;
                });
              }
            } catch {
              // Ignore errors for individual checks
            }
          }
        };
        checkBugs();
      }
    }
  }, [forks]);

  const addStatus = (
    text: string,
    type: "info" | "success" | "error" | "progress" = "info",
    step?: number,
    totalSteps?: number
  ) => {
    const timestamp = new Date().toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    setStatus((prev) => [...prev, { type, text, timestamp, step, totalSteps }]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setStatus([]);
    setResult(null);

    try {
      // Client-side validation
      if (createMode === "commit") {
        const githubUrlRegex = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/;
        if (!githubUrlRegex.test(repoUrl)) {
          throw new Error("Invalid GitHub URL format. Expected: https://github.com/owner/repo-name");
        }

        if (specifyCommit && commitHash) {
          const hashRegex = /^[a-f0-9]{7,40}$/i;
          if (!hashRegex.test(commitHash)) {
            throw new Error("Invalid commit hash format. Expected 7-40 character hex string");
          }
        }
      } else {
        const prUrlRegex = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/;
        if (!prUrlRegex.test(prUrl)) {
          throw new Error("Invalid PR URL format. Expected: https://github.com/owner/repo/pull/123");
        }
      }

      // Build request body
      const body =
        createMode === "commit"
          ? { repoUrl, commitHash: specifyCommit ? commitHash : undefined }
          : { prUrl };

      const response = await fetch("/api/create-pr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }

      if (!response.body) {
        throw new Error("No response body");
      }

      // Read the SSE stream
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process complete SSE events (separated by double newlines)
        const events = buffer.split("\n\n");
        buffer = events.pop() || ""; // Keep incomplete event in buffer

        for (const event of events) {
          if (!event.trim()) continue;

          // Parse SSE data line
          const dataMatch = event.match(/^data: (.+)$/m);
          if (!dataMatch) continue;

          try {
            const data = JSON.parse(dataMatch[1]);

            if (data.eventType === "status") {
              // Add status message
              addStatus(data.message, data.statusType || "info", data.step, data.totalSteps);
            } else if (data.eventType === "result") {
              // Final result
              if (data.success) {
                addStatus("PR created successfully!", "success");
                // Add the PR to My Forks tab
                if (data.prUrl && data.forkUrl) {
                  // Use the PR title from the API response
                  const prTitle = data.prTitle || "Review PR";
                  addCreatedPRToForks(data.prUrl, data.forkUrl, prTitle, data.commitCount || 1);
                }
              }
              setResult({
                success: data.success,
                message: data.message,
                prUrl: data.prUrl,
                error: data.error,
                commitHash: data.commitHash,
                forkUrl: data.forkUrl,
                commitCount: data.commitCount,
                originalPrNumber: data.originalPrNumber,
              });
            }
          } catch {
            // Ignore parse errors for individual events
          }
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
      addStatus(errorMessage, "error");
      setResult({
        success: false,
        message: errorMessage,
        error: errorMessage,
      });
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (type: "info" | "success" | "error" | "progress") => {
    switch (type) {
      case "success":
        return "text-success";
      case "error":
        return "text-error";
      case "progress":
        return "text-primary";
      default:
        return "text-accent";
    }
  };

  const handleCreateModeChange = (newMode: CreateMode) => {
    setCreateMode(newMode);
    setStatus([]);
    setResult(null);
  };

  const openCreatePRModal = () => {
    setShowCreatePRModal(true);
    setStatus([]);
    setResult(null);
  };

  const closeCreatePRModal = () => {
    setShowCreatePRModal(false);
    setCreatePRModalExpanded(false);
  };

  // My Forks functions
  const refreshFromGitHub = useCallback(async () => {
    setForksLoading(true);
    setForksError(null);
    setDeleteResult(null);
    // Clear the checked PRs set so all PRs will be re-checked after refresh
    checkedPRsRef.current.clear();

    try {
      const response = await fetch("/api/forks");
      const data = await response.json();

      if (data.success) {
        setForks(data.forks);
        localStorage.setItem("macroscope-forks", JSON.stringify(data.forks));
        forksLoadedRef.current = true;

        // Debug: log comment info to help identify the correct bot username
        if (data.debug && data.debug.length > 0) {
          console.log("=== DEBUG: Comment info for all PRs ===");
          console.log("This shows who commented on each PR (review comments on code lines):");
          console.table(data.debug.map((d: { fork: string; prNumber: number; debug: { totalReviewComments: number; commentUsers: string[] } }) => ({
            fork: d.fork,
            prNumber: d.prNumber,
            totalReviewComments: d.debug.totalReviewComments,
            commentUsers: d.debug.commentUsers.join(", ") || "(none)",
          })));
        }
      } else {
        setForksError(data.error || "Failed to fetch forks");
      }
    } catch (error) {
      setForksError(error instanceof Error ? error.message : "Failed to fetch forks");
    } finally {
      setForksLoading(false);
    }
  }, []);

  const checkSinglePRBugs = async (repoName: string, prNumber: number) => {
    setCheckingPR({ repo: repoName, pr: prNumber });

    try {
      const response = await fetch("/api/forks/check-bugs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoName, prNumber }),
      });

      const data = await response.json();

      // Debug: log the response to see what usernames are commenting
      console.log("Bug check response:", data);

      if (data.success) {
        // Update forks state and localStorage
        setForks((prevForks) => {
          const updatedForks = prevForks.map((fork) => {
            if (fork.repoName === repoName) {
              return {
                ...fork,
                prs: fork.prs.map((pr) => {
                  if (pr.prNumber === prNumber) {
                    return { ...pr, macroscopeBugs: data.bugCount };
                  }
                  return pr;
                }),
              };
            }
            return fork;
          });
          localStorage.setItem("macroscope-forks", JSON.stringify(updatedForks));
          return updatedForks;
        });
      }
    } catch (error) {
      console.error("Failed to check bugs:", error);
    } finally {
      setCheckingPR(null);
    }
  };

  // Add a newly created PR to the forks list (without checking for bugs yet)
  const addCreatedPRToForks = useCallback(
    (prUrl: string, forkUrl: string, prTitle: string, commitCount: number) => {
      // Parse PR URL to extract repo name and PR number
      const prMatch = prUrl.match(/github\.com\/[\w.-]+\/([\w.-]+)\/pull\/(\d+)/);
      if (!prMatch) return;

      const repoName = prMatch[1];
      const prNumber = parseInt(prMatch[2], 10);

      // Mark this PR as "checked" so the auto-check effect skips it
      // (Macroscope hasn't had time to analyze it yet, so checking would just return 0)
      const prKey = `${repoName}:${prNumber}`;
      checkedPRsRef.current.add(prKey);

      // Create the new PR record
      const newPR: PRRecord = {
        prNumber,
        prUrl,
        prTitle,
        createdAt: new Date().toISOString(),
        commitCount,
        state: "open",
        branchName: `review-pr-${prNumber}`,
        macroscopeBugs: undefined, // Will show refresh icon, user can check manually later
      };

      // Update forks state
      setForks((prevForks) => {
        let updatedForks = [...prevForks];
        const existingForkIndex = updatedForks.findIndex((f) => f.repoName === repoName);

        if (existingForkIndex !== -1) {
          // Add PR to existing fork (check if PR already exists)
          const existingPRIndex = updatedForks[existingForkIndex].prs.findIndex(
            (p) => p.prNumber === prNumber
          );
          if (existingPRIndex === -1) {
            updatedForks[existingForkIndex] = {
              ...updatedForks[existingForkIndex],
              prs: [newPR, ...updatedForks[existingForkIndex].prs],
            };
          }
        } else {
          // Create new fork entry
          const newFork: ForkRecord = {
            repoName,
            forkUrl,
            createdAt: new Date().toISOString(),
            prs: [newPR],
          };
          updatedForks = [newFork, ...updatedForks];
        }

        localStorage.setItem("macroscope-forks", JSON.stringify(updatedForks));
        return updatedForks;
      });
    },
    []
  );

  const filteredForks = useCallback(() => {
    let result = forks;

    // Apply search filter
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

    // Apply "show only with issues" filter
    if (showOnlyWithIssues) {
      result = result
        .map((fork) => ({
          ...fork,
          prs: fork.prs.filter((pr) => pr.macroscopeBugs !== undefined && pr.macroscopeBugs > 0),
        }))
        .filter((fork) => fork.prs.length > 0);
    }

    return result;
  }, [forks, searchQuery, showOnlyWithIssues]);

  const toggleRepoExpand = (repoName: string) => {
    setExpandedRepos((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(repoName)) {
        newSet.delete(repoName);
      } else {
        newSet.add(repoName);
      }
      return newSet;
    });
  };

  const toggleRepoSelection = (repoName: string) => {
    setSelection((prev) => {
      const newRepos = new Set(prev.repos);
      const newPrs = new Set(prev.prs);
      const fork = forks.find((f) => f.repoName === repoName);

      if (newRepos.has(repoName)) {
        // Deselect repo and all its PRs
        newRepos.delete(repoName);
        fork?.prs.forEach((pr) => newPrs.delete(`${repoName}:${pr.prNumber}`));
      } else {
        // Select repo and all its PRs
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

      if (newPrs.has(prKey)) {
        newPrs.delete(prKey);
      } else {
        newPrs.add(prKey);
      }

      // If repo was selected and we're unchecking a PR, deselect the repo
      // (user is now selecting individual PRs, not the whole fork)
      if (newRepos.has(repoName)) {
        newRepos.delete(repoName);
      }

      return { repos: newRepos, prs: newPrs };
    });
  };

  const getRepoCheckboxState = (repoName: string): "checked" | "unchecked" | "indeterminate" => {
    // Repo is checked only if explicitly selected (will delete the whole fork)
    if (selection.repos.has(repoName)) return "checked";

    // Check if any PRs are selected (show indeterminate)
    const fork = forks.find((f) => f.repoName === repoName);
    if (!fork) return "unchecked";

    const hasSelectedPrs = fork.prs.some((pr) => selection.prs.has(`${repoName}:${pr.prNumber}`));
    return hasSelectedPrs ? "indeterminate" : "unchecked";
  };

  const getSelectedCounts = () => {
    // Only delete repos that are explicitly selected (not just because all PRs are selected)
    const reposToDelete = Array.from(selection.repos);

    // Find individual PRs to delete (from repos not being deleted)
    const prsToDelete: { repo: string; prNumber: number; branchName: string }[] = [];
    selection.prs.forEach((prKey) => {
      const [repoName, prNumberStr] = prKey.split(":");
      // Don't include PRs from repos being deleted (they'll be deleted with the repo)
      if (!selection.repos.has(repoName)) {
        const fork = forks.find((f) => f.repoName === repoName);
        const pr = fork?.prs.find((p) => p.prNumber === parseInt(prNumberStr));
        if (pr) {
          prsToDelete.push({ repo: repoName, prNumber: pr.prNumber, branchName: pr.branchName });
        }
      }
    });

    return { reposToDelete, prsToDelete };
  };

  const handleDelete = async () => {
    const { reposToDelete, prsToDelete } = getSelectedCounts();
    setDeleteLoading(true);
    setShowDeleteConfirm(false);

    try {
      const response = await fetch("/api/forks", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repos: reposToDelete, prs: prsToDelete }),
      });

      const data = await response.json();

      if (data.success) {
        // Update local state
        let updatedForks = [...forks];

        // Remove deleted repos
        updatedForks = updatedForks.filter((f) => !data.deletedRepos.includes(f.repoName));

        // Remove deleted PRs (but keep the repo even if it has no PRs left)
        data.deletedPRs.forEach((deleted: { repo: string; prNumber: number }) => {
          const forkIndex = updatedForks.findIndex((f) => f.repoName === deleted.repo);
          if (forkIndex !== -1) {
            updatedForks[forkIndex] = {
              ...updatedForks[forkIndex],
              prs: updatedForks[forkIndex].prs.filter((pr) => pr.prNumber !== deleted.prNumber),
            };
          }
        });

        setForks(updatedForks);
        localStorage.setItem("macroscope-forks", JSON.stringify(updatedForks));
        setSelection({ repos: new Set(), prs: new Set() });

        // Collapse repos that now have no PRs
        setExpandedRepos((prev) => {
          const newExpanded = new Set(prev);
          updatedForks.forEach((fork) => {
            if (fork.prs.length === 0) {
              newExpanded.delete(fork.repoName);
            }
          });
          return newExpanded;
        });

        const message =
          data.errors.length > 0
            ? `Deleted ${data.deletedRepos.length} repos and ${data.deletedPRs.length} PRs. Some errors occurred.`
            : `Successfully deleted ${data.deletedRepos.length} repos and ${data.deletedPRs.length} PRs.`;

        setDeleteResult({ success: data.errors.length === 0, message });
        // Auto-hide success message after 5 seconds
        setTimeout(() => setDeleteResult(null), 5000);
      } else {
        setDeleteResult({ success: false, message: data.error || "Failed to delete" });
        setTimeout(() => setDeleteResult(null), 5000);
      }
    } catch (error) {
      setDeleteResult({
        success: false,
        message: error instanceof Error ? error.message : "Failed to delete",
      });
      setTimeout(() => setDeleteResult(null), 5000);
    } finally {
      setDeleteLoading(false);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const year = String(date.getFullYear()).slice(-2);
    const hours = date.getHours();
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const ampm = hours >= 12 ? "PM" : "AM";
    const hour12 = hours % 12 || 12;
    return `${month}/${day}/${year} ${hour12}:${minutes} ${ampm}`;
  };

  // PR Analysis functions
  const handleAnalysis = async (e: React.FormEvent, forceRefresh = false) => {
    e.preventDefault();
    setAnalysisLoading(true);
    setAnalysisResult(null);
    setCopiedBugIndex(null);
    setCurrentAnalysisId(null);
    setIsViewingCached(false);

    // If forcing refresh (regenerate), we're running a new analysis
    if (forceRefresh) {
      setExpectingCachedResult(false);
    }

    try {
      const response = await fetch("/api/analyze-pr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          forkedPrUrl: analysisForkedUrl,
          originalPrUrl: analysisOriginalUrl || undefined,
          forceRefresh,
        }),
      });

      const data: AnalysisApiResponse = await response.json();
      setAnalysisResult(data);

      // Track analysis ID and cache status
      if (data.analysisId) {
        setCurrentAnalysisId(data.analysisId);
      }
      if (data.cached) {
        setIsViewingCached(true);
      }

      // If there's a cached email, display it
      if (data.cachedEmail) {
        setGeneratedEmail(data.cachedEmail);
      }

      // Update forks state to reflect that this PR now has an analysis
      if (data.success && data.analysisId) {
        setForks((prevForks) => {
          const updatedForks = prevForks.map((fork) => ({
            ...fork,
            prs: fork.prs.map((pr) => {
              if (pr.prUrl === analysisForkedUrl) {
                return { ...pr, hasAnalysis: true, analysisId: data.analysisId };
              }
              return pr;
            }),
          }));
          localStorage.setItem("macroscope-forks", JSON.stringify(updatedForks));
          return updatedForks;
        });
      }
    } catch (error) {
      setAnalysisResult({
        success: false,
        error: error instanceof Error ? error.message : "Analysis failed",
      });
    } finally {
      setAnalysisLoading(false);
      setExpectingCachedResult(false); // Reset after analysis completes
    }
  };

  const startAnalysisFromForks = (prUrl: string, hasExistingAnalysis = false, prTitle = "") => {
    setAnalysisForkedUrl(prUrl);
    setAnalysisOriginalUrl("");
    setAnalysisResult(null);
    setGeneratedEmail(null);
    setEmailError(null);
    setCurrentAnalysisId(null);
    setIsViewingCached(false);
    setExpectingCachedResult(hasExistingAnalysis);
    setSelectedPrTitle(prTitle);
    setModalTab("analysis");
    setShowAnalysisModal(true);

    // If there's an existing analysis, auto-load it
    if (hasExistingAnalysis) {
      // Trigger the analysis fetch (which will return cached result)
      setTimeout(() => {
        const form = document.getElementById("analysis-form") as HTMLFormElement;
        if (form) {
          form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
        }
      }, 100);
    }
  };

  const closeAnalysisModal = () => {
    setShowAnalysisModal(false);
    setModalExpanded(false);
    setModalTab("analysis");
  };

  const copyBugExplanation = async (text: string, index: number) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedBugIndex(index);
      setTimeout(() => setCopiedBugIndex(null), 2000);
    } catch {
      // Fallback for older browsers
      const textArea = document.createElement("textarea");
      textArea.value = text;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand("copy");
      document.body.removeChild(textArea);
      setCopiedBugIndex(index);
      setTimeout(() => setCopiedBugIndex(null), 2000);
    }
  };

  const copyEmail = async () => {
    if (!generatedEmail) return;
    try {
      await navigator.clipboard.writeText(generatedEmail);
      setEmailCopied(true);
      setTimeout(() => setEmailCopied(false), 2000);
    } catch {
      const textArea = document.createElement("textarea");
      textArea.value = generatedEmail;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand("copy");
      document.body.removeChild(textArea);
      setEmailCopied(true);
      setTimeout(() => setEmailCopied(false), 2000);
    }
  };

  const getMostImpactfulBug = (bugs: BugSnippet[]): BugSnippet | null => {
    const mostImpactful = bugs.find((bug) => bug.is_most_impactful);
    return mostImpactful || bugs[0] || null;
  };

  const extractCompanyFromUrl = (url: string): string => {
    const match = url.match(/github\.com\/([\w.-]+)\//);
    if (!match) return "";
    const orgName = match[1];
    return orgName
      .split("-")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join("");
  };

  const extractPrNumber = (url: string): string => {
    const match = url.match(/\/pull\/(\d+)/);
    return match ? match[1] : "";
  };

  const handleGenerateEmail = async () => {
    if (!analysisResult?.result || !analysisResult.result.meaningful_bugs_found) return;

    const mostImpactfulBug = getMostImpactfulBug(analysisResult.result.bugs);
    if (!mostImpactfulBug) return;

    // Get the original PR URL from the API response (always extracted from forked PR description)
    const originalPrUrl = analysisResult.originalPrUrl;
    if (!originalPrUrl) {
      setEmailError("Could not determine original PR URL. The analysis may need to be regenerated.");
      return;
    }

    setEmailLoading(true);
    setEmailError(null);
    setGeneratedEmail(null);

    try {
      const response = await fetch("/api/generate-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          originalPrUrl,
          prTitle: analysisResult.originalPrTitle, // Use the actual PR title from GitHub
          forkedPrUrl: analysisForkedUrl,
          bug: mostImpactfulBug,
          totalBugs: analysisResult.result.total_macroscope_bugs_found,
          analysisId: currentAnalysisId, // Link email to analysis in database
        }),
      });

      const data: EmailGenerationResponse = await response.json();

      if (data.success && data.email) {
        setGeneratedEmail(data.email);
      } else {
        setEmailError(data.error || "Failed to generate email");
      }
    } catch (error) {
      setEmailError(error instanceof Error ? error.message : "Failed to generate email");
    } finally {
      setEmailLoading(false);
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case "critical":
        return "bg-red-100 text-red-800 border-red-200";
      case "high":
        return "bg-orange-100 text-orange-800 border-orange-200";
      case "medium":
        return "bg-yellow-100 text-yellow-800 border-yellow-200";
      default:
        return "bg-gray-100 text-gray-800 border-gray-200";
    }
  };

  const totalSelected = selection.prs.size;
  const { reposToDelete, prsToDelete } = getSelectedCounts();

  return (
    <div className="min-h-screen flex">
      {/* Left Sidebar - Logo only */}
      <aside className="w-64 bg-white border-r border-border flex flex-col shrink-0 sticky top-0 h-screen overflow-y-auto">
        {/* Logo */}
        <div className="h-16 flex items-center px-6 border-b border-border">
          <Image
            src="/Macroscope-text-logo.png"
            alt="Macroscope"
            width={140}
            height={28}
            className="h-7 w-auto"
            priority
          />
        </div>

        {/* Navigation Links */}
        <nav className="flex-1 px-4 py-6">
          <div className="space-y-1">
            <div className="w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-lg bg-primary/10 text-primary">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
              My Repos
            </div>
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
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 bg-bg-subtle h-screen overflow-y-auto">
        {/* Sticky Header Section */}
        <div className="sticky top-0 z-10 bg-bg-subtle px-8 pt-8 pb-4 border-b border-border shadow-sm">
          {/* Page Header */}
          <div className="flex items-start justify-between mb-6">
            <div>
              <h1 className="text-2xl font-semibold text-accent tracking-tight">My Repos</h1>
              <p className="mt-2 text-text-secondary">Manage your repositories and analyze PRs</p>
            </div>
            <div className="flex items-center gap-3">
              {totalSelected > 0 && (
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  disabled={deleteLoading}
                  className="inline-flex items-center gap-2 px-4 py-2.5 bg-error hover:bg-error/90 text-white font-medium rounded-lg transition-colors disabled:opacity-50"
                >
                  {deleteLoading ? (
                    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                  ) : (
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  )}
                  Delete Selected
                </button>
              )}
              <button
                onClick={openCreatePRModal}
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-primary hover:bg-primary-hover text-white font-medium rounded-lg transition-colors"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                Simulate PR
              </button>
            </div>
          </div>

          {/* Search and Refresh */}
          <div className="flex gap-3">
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
              Refresh
            </button>
          </div>
        </div>

        {/* Content Area */}
        <div className="px-8 py-6">
          {/* My Repos Section */}
          <div className="bg-white border border-border rounded-xl shadow-sm">
            {/* Error display */}
            {forksError && (
              <div className="mx-6 mt-4 p-3 rounded-lg bg-error-light border border-error/20 text-sm text-error">
                {forksError}
              </div>
            )}

            {/* Delete result */}
            {deleteResult && (
              <div className={`mx-6 mt-4 p-3 rounded-lg border text-sm ${deleteResult.success ? "bg-success-light border-success/20 text-success" : "bg-error-light border-error/20 text-error"}`}>
                {deleteResult.message}
              </div>
            )}

            {/* Repos List */}
            {forks.length === 0 ? (
              <div className="text-center py-12">
                <svg className="mx-auto h-12 w-12 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
                <h3 className="mt-4 text-sm font-medium text-accent">No repos tracked yet</h3>
                <p className="mt-2 text-sm text-text-muted">
                  Create a PR to get started, or click &quot;Refresh&quot; to load existing repos from GitHub.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                    {filteredForks().map((fork) => {
                      const checkboxState = getRepoCheckboxState(fork.repoName);
                      const isExpanded = expandedRepos.has(fork.repoName);
                      return (
                        <div key={fork.repoName}>
                          {/* Repo Header - Clickable Accordion */}
                          <div
                            className="flex items-center px-6 py-3 bg-gray-50 hover:bg-gray-100 cursor-pointer transition-colors"
                            onClick={() => toggleRepoExpand(fork.repoName)}
                          >
                            {/* Expand/Collapse Arrow */}
                            <div className="w-6 flex-shrink-0">
                              <svg
                                className={`h-4 w-4 text-gray-500 transition-transform duration-200 ${isExpanded ? "rotate-90" : ""}`}
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                                strokeWidth={2}
                              >
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                              </svg>
                            </div>

                            {/* Checkbox */}
                            <div className="w-10 flex-shrink-0 flex justify-center">
                              <input
                                type="checkbox"
                                checked={checkboxState === "checked"}
                                ref={(el) => {
                                  if (el) el.indeterminate = checkboxState === "indeterminate";
                                }}
                                onChange={(e) => {
                                  e.stopPropagation();
                                  toggleRepoSelection(fork.repoName);
                                }}
                                onClick={(e) => e.stopPropagation()}
                                className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary focus:ring-offset-0 cursor-pointer"
                              />
                            </div>

                            {/* Repo Name and PR Count */}
                            <div className="flex-1 flex items-center gap-3 ml-2">
                              <a
                                href={fork.forkUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="text-base font-semibold text-gray-900 hover:text-primary hover:underline"
                              >
                                {fork.repoName}
                              </a>
                              <span className="text-sm text-gray-500">
                                ({fork.prs.length} PR{fork.prs.length !== 1 ? "s" : ""})
                              </span>
                            </div>
                          </div>

                          {/* PR List - Collapsible */}
                          {isExpanded && fork.prs.length > 0 && (
                            <div className="bg-white">
                              {/* PR Table Header */}
                              <div className="flex items-center px-6 py-2 bg-gray-50/50 border-b border-gray-100 text-xs font-medium text-gray-500 uppercase tracking-wider">
                                <div className="w-6 flex-shrink-0"></div>
                                <div className="w-10 flex-shrink-0"></div>
                                <div className="flex-1 ml-2"></div>
                                <div className="w-[120px] text-center">Analysis</div>
                                <div className="w-[100px] text-center">Bugs</div>
                                <div className="w-[140px] text-center">Created</div>
                                <div className="w-[140px] text-center">Updated</div>
                              </div>

                              {/* PR Rows */}
                              <div className="divide-y divide-gray-100">
                                {fork.prs.map((pr) => {
                                  // Bug count badge styling - softer pastel colors
                                  const getBugBadgeStyle = () => {
                                    if (!pr.hasAnalysis) return "bg-gray-100 text-gray-500";
                                    const bugs = pr.macroscopeBugs ?? 0;
                                    if (bugs === 0) return "bg-gray-100 text-gray-600";
                                    if (bugs === 1) return "bg-orange-50 text-orange-700 border border-orange-200";
                                    if (bugs === 2) return "bg-amber-50 text-amber-700 border border-amber-200";
                                    return "bg-red-50 text-red-700 border border-red-200";
                                  };

                                  return (
                                    <div
                                      key={`${fork.repoName}-${pr.prNumber}`}
                                      className="flex items-center px-6 py-4 hover:bg-gray-50/50 transition-colors"
                                    >
                                      {/* Empty space for arrow alignment */}
                                      <div className="w-6 flex-shrink-0"></div>

                                      {/* Checkbox */}
                                      <div className="w-10 flex-shrink-0 flex justify-center">
                                        <input
                                          type="checkbox"
                                          checked={selection.prs.has(`${fork.repoName}:${pr.prNumber}`)}
                                          onChange={() => togglePrSelection(fork.repoName, pr.prNumber)}
                                          className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary focus:ring-offset-0 cursor-pointer"
                                        />
                                      </div>

                                      {/* PR Title */}
                                      <div className="flex-1 min-w-0 ml-2">
                                        <a
                                          href={pr.prUrl}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="text-sm text-primary hover:underline font-medium"
                                        >
                                          #{pr.prNumber}
                                        </a>
                                        <span className="text-sm text-gray-700 ml-2">
                                          {pr.prTitle}
                                        </span>
                                      </div>

                                      {/* Action Button */}
                                      <div className="w-[120px] flex-shrink-0 flex justify-center">
                                        <button
                                          onClick={() => startAnalysisFromForks(pr.prUrl, pr.hasAnalysis, pr.prTitle)}
                                          className={`inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${
                                            pr.hasAnalysis
                                              ? "bg-green-50 text-green-700 hover:bg-green-100"
                                              : "bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
                                          }`}
                                        >
                                          {pr.hasAnalysis ? (
                                            <>
                                              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                              </svg>
                                              View
                                            </>
                                          ) : (
                                            <>
                                              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                              </svg>
                                              Run
                                            </>
                                          )}
                                        </button>
                                      </div>

                                      {/* Bug Count Badge */}
                                      <div className="w-[100px] flex-shrink-0 flex justify-center">
                                        <span className={`inline-flex items-center justify-center min-w-[28px] px-2 py-0.5 text-xs font-semibold rounded-full ${getBugBadgeStyle()}`}>
                                          {pr.hasAnalysis ? (pr.macroscopeBugs ?? 0) : "-"}
                                        </span>
                                      </div>

                                      {/* Created Date */}
                                      <div className="w-[140px] flex-shrink-0 text-sm text-gray-500 text-center">
                                        {formatDate(pr.createdAt)}
                                      </div>

                                      {/* Updated Date */}
                                      <div className="w-[140px] flex-shrink-0 text-sm text-gray-500 text-center">
                                        {pr.updatedAt ? formatDate(pr.updatedAt) : "-"}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}

                          {/* Empty state for repos with no PRs */}
                          {isExpanded && fork.prs.length === 0 && (
                            <div className="px-6 py-8 bg-white text-center">
                              <svg className="mx-auto h-8 w-8 text-gray-300 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                              </svg>
                              <p className="text-sm text-gray-500">No review PRs in this repository</p>
                              <p className="text-xs text-gray-400 mt-1">Create a PR to get started</p>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

              </div>

              {/* Summary */}
              {forks.length > 0 && (
                <div className="mt-4 text-center">
                  <p className="text-sm text-text-muted">
                    Showing {filteredForks().length} repo{filteredForks().length !== 1 ? "s" : ""} with{" "}
                    {filteredForks().reduce((acc, f) => acc + f.prs.length, 0)} PR
                    {filteredForks().reduce((acc, f) => acc + f.prs.length, 0) !== 1 ? "s" : ""}
                  </p>
                </div>
              )}
        </div>
      </main>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-lg max-w-lg w-full p-6">
            <h3 className="text-lg font-semibold text-accent mb-4">Confirm Delete</h3>

            <p className="text-sm text-text-secondary mb-4">
              Are you sure you want to delete the following? This action cannot be undone.
            </p>

            {/* Repos to delete */}
            {reposToDelete.length > 0 && (
              <div className="mb-4">
                <h4 className="text-sm font-medium text-accent mb-2">
                  Repositories ({reposToDelete.length})
                </h4>
                <div className="bg-bg-subtle rounded-lg border border-border p-3 max-h-32 overflow-y-auto">
                  <ul className="space-y-1">
                    {reposToDelete.map((repo) => (
                      <li key={repo} className="text-sm text-text-secondary flex items-center gap-2">
                        <svg className="h-4 w-4 text-error shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                        <span className="font-medium">{repo}</span>
                        <span className="text-text-muted text-xs">(and all its PRs)</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {/* PRs to delete */}
            {prsToDelete.length > 0 && (
              <div className="mb-4">
                <h4 className="text-sm font-medium text-accent mb-2">
                  Pull Requests ({prsToDelete.length})
                </h4>
                <div className="bg-bg-subtle rounded-lg border border-border p-3 max-h-32 overflow-y-auto">
                  <ul className="space-y-1">
                    {prsToDelete.map((pr) => {
                      const fork = forks.find(f => f.repoName === pr.repo);
                      const prData = fork?.prs.find(p => p.prNumber === pr.prNumber);
                      return (
                        <li key={`${pr.repo}-${pr.prNumber}`} className="text-sm text-text-secondary flex items-center gap-2">
                          <svg className="h-4 w-4 text-error shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                          <span>
                            <span className="font-medium">{pr.repo}</span>
                            <span className="text-text-muted"> / </span>
                            <span>#{pr.prNumber}</span>
                            {prData?.prTitle && (
                              <span className="text-text-muted"> - {prData.prTitle}</span>
                            )}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </div>
            )}

            <div className="flex gap-3 justify-end pt-2">
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

      {/* Analysis Modal */}
      {showAnalysisModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div
            className={`bg-white rounded-xl shadow-lg flex flex-col transition-all duration-200 ${
              modalExpanded
                ? "w-[calc(100%-2rem)] h-[calc(100%-2rem)] max-w-none"
                : "w-full max-w-2xl max-h-[80vh]"
            }`}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
              <div className="flex-1 min-w-0">
                <h2 className="text-lg font-semibold text-accent truncate">
                  {selectedPrTitle || "PR Analysis"}
                </h2>
                {analysisForkedUrl && (
                  <a
                    href={analysisForkedUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-primary hover:underline truncate block"
                  >
                    {analysisForkedUrl}
                  </a>
                )}
              </div>
              <div className="flex items-center gap-2 ml-4">
                {/* Expand/Collapse Button */}
                <button
                  onClick={() => setModalExpanded(!modalExpanded)}
                  className="p-2 text-text-secondary hover:text-accent hover:bg-bg-subtle rounded-lg transition-colors"
                  title={modalExpanded ? "Collapse" : "Expand"}
                >
                  {modalExpanded ? (
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" />
                    </svg>
                  ) : (
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
                    </svg>
                  )}
                </button>
                {/* Close Button */}
                <button
                  onClick={closeAnalysisModal}
                  className="p-2 text-text-secondary hover:text-accent hover:bg-bg-subtle rounded-lg transition-colors"
                >
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Modal Tabs */}
            <div className="flex border-b border-border px-6 shrink-0">
              <button
                onClick={() => setModalTab("analysis")}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
                  modalTab === "analysis"
                    ? "border-primary text-primary"
                    : "border-transparent text-text-secondary hover:text-accent"
                }`}
              >
                Analysis
              </button>
              {generatedEmail && (
                <button
                  onClick={() => setModalTab("email")}
                  className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
                    modalTab === "email"
                      ? "border-primary text-primary"
                      : "border-transparent text-text-secondary hover:text-accent"
                  }`}
                >
                  Email
                </button>
              )}
            </div>

            {/* Modal Content */}
            <div className="flex-1 overflow-y-auto p-6">
              {modalTab === "analysis" ? (
                <div className="space-y-6">
                  {/* Hidden Analysis Form - auto-submits when modal opens for existing analysis */}
                  <form id="analysis-form" onSubmit={handleAnalysis} className="hidden">
                    <input type="hidden" value={analysisForkedUrl} />
                  </form>

                  {/* Loading State */}
                  {analysisLoading && (
                    <div className="flex flex-col items-center justify-center py-12">
                      <svg className="animate-spin h-8 w-8 text-primary mb-4" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      <p className="text-text-secondary">
                        {expectingCachedResult ? "Loading cached analysis..." : "Analyzing PR..."}
                      </p>
                    </div>
                  )}

                  {/* No Analysis Yet - Show Run Button */}
                  {!analysisLoading && !analysisResult && (
                    <div className="text-center py-12">
                      <svg className="mx-auto h-12 w-12 text-text-muted mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                      </svg>
                      <h3 className="text-lg font-medium text-accent mb-2">Ready to Analyze</h3>
                      <p className="text-sm text-text-secondary mb-6">
                        Click the button below to analyze this PR for bugs found by Macroscope.
                      </p>
                      <button
                        onClick={(e) => handleAnalysis(e as React.FormEvent)}
                        className="inline-flex items-center gap-2 px-6 py-3 bg-primary hover:bg-primary-hover text-white font-medium rounded-lg transition-colors"
                      >
                        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        Run Analysis
                      </button>
                    </div>
                  )}

                  {/* Analysis Results */}
                  {!analysisLoading && analysisResult && (
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
                            onClick={(e) => handleAnalysis(e as React.FormEvent, true)}
                            className="text-sm text-blue-700 hover:text-blue-800 font-medium underline"
                          >
                            Regenerate
                          </button>
                        </div>
                      )}

                      {analysisResult.success && analysisResult.result ? (
                        analysisResult.result.meaningful_bugs_found ? (
                          <>
                            {/* Summary */}
                            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                              <div className="flex items-center gap-2 text-amber-800">
                                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                </svg>
                                <span className="font-semibold">
                                  Found {analysisResult.result.total_macroscope_bugs_found} bug
                                  {analysisResult.result.total_macroscope_bugs_found !== 1 ? "s" : ""}
                                </span>
                              </div>
                            </div>

                            {/* Bug List */}
                            <div className="space-y-4">
                              {analysisResult.result.bugs.map((bug, index) => (
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

                            {/* Generate Email Button - only show if no email exists */}
                            {!generatedEmail && (
                              <div className="border-t border-border pt-6">
                                <h3 className="text-sm font-medium text-accent mb-3">Generate Outreach Email</h3>
                                <button
                                  onClick={handleGenerateEmail}
                                  disabled={emailLoading}
                                  className="inline-flex items-center gap-2 px-4 py-2.5 bg-primary hover:bg-primary-hover text-white font-medium rounded-lg transition-colors disabled:opacity-50"
                                >
                                  {emailLoading ? (
                                    <>
                                      <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                      </svg>
                                      Generating...
                                    </>
                                  ) : (
                                    <>
                                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                                      </svg>
                                      Generate Email
                                    </>
                                  )}
                                </button>
                                {emailError && (
                                  <p className="mt-2 text-sm text-error">{emailError}</p>
                                )}
                              </div>
                            )}
                          </>
                        ) : (
                          /* No Meaningful Bugs Found */
                          <div className="text-center py-8">
                            <svg className="mx-auto h-12 w-12 text-success mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <h3 className="text-lg font-medium text-accent mb-2">No Meaningful Bugs Found</h3>
                            <p className="text-sm text-text-secondary">{analysisResult.result.reason}</p>
                          </div>
                        )
                      ) : (
                        /* Error State */
                        <div className="rounded-lg border border-error/20 bg-error-light p-4">
                          <div className="flex items-center gap-2 text-error">
                            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <span className="font-medium">Analysis Failed</span>
                          </div>
                          <p className="mt-2 text-sm text-text-secondary">{analysisResult.error}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                /* Email Tab */
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-medium text-accent">Generated Email</h3>
                    <button
                      onClick={copyEmail}
                      className="inline-flex items-center gap-1.5 text-sm text-primary hover:text-primary-hover font-medium"
                    >
                      {emailCopied ? (
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
                          Copy to Clipboard
                        </>
                      )}
                    </button>
                  </div>
                  <div className="bg-bg-subtle border border-border rounded-lg p-4">
                    <pre className="text-sm text-text-secondary whitespace-pre-wrap font-sans">
                      {generatedEmail}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Create PR Modal */}
      {showCreatePRModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div
            className={`bg-white rounded-xl shadow-lg flex flex-col transition-all duration-200 ${
              createPRModalExpanded
                ? "w-[calc(100%-2rem)] h-[calc(100%-2rem)] max-w-none"
                : "w-full max-w-xl max-h-[90vh]"
            }`}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
              <h2 className="text-lg font-semibold text-accent">Create PR</h2>
              <div className="flex items-center gap-2">
                {/* Expand/Collapse Button */}
                <button
                  onClick={() => setCreatePRModalExpanded(!createPRModalExpanded)}
                  className="p-2 text-text-secondary hover:text-accent hover:bg-bg-subtle rounded-lg transition-colors"
                  title={createPRModalExpanded ? "Collapse" : "Expand"}
                >
                  {createPRModalExpanded ? (
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" />
                    </svg>
                  ) : (
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
                    </svg>
                  )}
                </button>
                {/* Close Button */}
                <button
                  onClick={closeCreatePRModal}
                  className="p-2 text-text-secondary hover:text-accent hover:bg-bg-subtle rounded-lg transition-colors"
                >
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Modal Tabs */}
            <div className="flex border-b border-border px-6 shrink-0">
              <button
                onClick={() => handleCreateModeChange("pr")}
                disabled={loading}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
                  createMode === "pr"
                    ? "border-primary text-primary"
                    : "border-transparent text-text-secondary hover:text-accent"
                } disabled:opacity-50`}
              >
                Simulate PR
              </button>
              <button
                onClick={() => handleCreateModeChange("commit")}
                disabled={loading}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
                  createMode === "commit"
                    ? "border-primary text-primary"
                    : "border-transparent text-text-secondary hover:text-accent"
                } disabled:opacity-50`}
              >
                Latest Commit
              </button>
            </div>

            {/* Modal Content */}
            <div className="flex-1 overflow-y-auto p-6">
              <form onSubmit={handleSubmit} className="space-y-6">
                {createMode === "pr" ? (
                  <div>
                    <label htmlFor="prUrl" className="block text-sm font-medium text-accent mb-2">
                      Pull Request URL
                    </label>
                    <input
                      type="text"
                      id="prUrl"
                      value={prUrl}
                      onChange={(e) => setPrUrl(e.target.value)}
                      placeholder="https://github.com/owner/repo/pull/123"
                      className="w-full px-4 py-3 bg-white border border-border rounded-lg text-black placeholder:text-text-muted focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors"
                      required
                      disabled={loading}
                    />
                    <p className="mt-2 text-sm text-text-muted">
                      Paste any GitHub PR URL to simulate it for review
                    </p>
                  </div>
                ) : (
                  <>
                    <div>
                      <label htmlFor="repoUrl" className="block text-sm font-medium text-accent mb-2">
                        GitHub Repository URL
                      </label>
                      <input
                        type="text"
                        id="repoUrl"
                        value={repoUrl}
                        onChange={(e) => setRepoUrl(e.target.value)}
                        placeholder="https://github.com/owner/repo-name"
                        className="w-full px-4 py-3 bg-white border border-border rounded-lg text-black placeholder:text-text-muted focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors"
                        required
                        disabled={loading}
                      />
                      <p className="mt-2 text-sm text-text-muted">
                        Enter the original repository URL (we&apos;ll fork it for you)
                      </p>
                    </div>

                    <div className="flex items-center">
                      <input
                        type="checkbox"
                        id="specifyCommitModal"
                        checked={specifyCommit}
                        onChange={(e) => setSpecifyCommit(e.target.checked)}
                        className="h-4 w-4 rounded border-border text-primary focus:ring-primary focus:ring-offset-0 cursor-pointer"
                        disabled={loading}
                      />
                      <label
                        htmlFor="specifyCommitModal"
                        className="ml-3 text-sm text-text-secondary cursor-pointer select-none"
                      >
                        Specify commit (otherwise uses latest from main branch)
                      </label>
                    </div>

                    {specifyCommit && (
                      <div>
                        <label htmlFor="commitHashModal" className="block text-sm font-medium text-accent mb-2">
                          Commit Hash
                        </label>
                        <input
                          type="text"
                          id="commitHashModal"
                          value={commitHash}
                          onChange={(e) => setCommitHash(e.target.value)}
                          placeholder="abc1234..."
                          className="w-full px-4 py-3 bg-white border border-border rounded-lg text-black placeholder:text-text-muted font-mono text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors"
                          required={specifyCommit}
                          disabled={loading}
                        />
                        <p className="mt-2 text-sm text-text-muted">
                          The specific commit you want to create as a PR
                        </p>
                      </div>
                    )}
                  </>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full flex items-center justify-center py-3 px-4 bg-primary hover:bg-primary-hover text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? (
                    <>
                      <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      Creating PR...
                    </>
                  ) : (
                    "Create Pull Request"
                  )}
                </button>
              </form>

              {/* Status Messages */}
              {status.length > 0 && (
                <div className="mt-6">
                  <h3 className="text-sm font-medium text-accent mb-3">Status</h3>
                  <div className="bg-bg-subtle border border-border rounded-lg p-4 max-h-48 overflow-y-auto">
                    <div className="space-y-2">
                      {status.map((msg, idx) => (
                        <div key={idx} className="flex items-start gap-3 text-sm">
                          <span className="text-text-muted font-mono text-xs shrink-0 pt-0.5">
                            {msg.timestamp}
                          </span>
                          {msg.step && msg.totalSteps && (
                            <span className="shrink-0 px-1.5 py-0.5 bg-primary/10 text-primary text-xs font-medium rounded">
                              {msg.step}/{msg.totalSteps}
                            </span>
                          )}
                          <span className={`${getStatusColor(msg.type)} leading-relaxed`}>
                            {msg.text}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Result */}
              {result && (
                <div className="mt-6">
                  {result.success ? (
                    <div className="rounded-xl border border-success/20 bg-success-light p-5">
                      <div className="flex items-center gap-2 mb-3">
                        <svg className="h-5 w-5 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <h3 className="text-base font-semibold text-accent">PR Created Successfully</h3>
                      </div>
                      <p className="text-sm text-text-secondary mb-3">View your pull request:</p>
                      <a href={result.prUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline font-medium break-all text-sm">
                        {result.prUrl}
                      </a>
                      {result.prUrl && (
                        <div className="mt-4 flex gap-3">
                          <a href={result.prUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary-hover text-white text-sm font-medium rounded-lg transition-colors">
                            <Image src="/GitHub_Invertocat_White.svg" alt="" width={16} height={16} className="h-4 w-4" />
                            View in GitHub
                          </a>
                          <button
                            onClick={closeCreatePRModal}
                            className="px-4 py-2 text-sm font-medium text-text-secondary hover:text-accent transition-colors"
                          >
                            Close
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-error/20 bg-error-light p-5">
                      <div className="flex items-center gap-2 mb-2">
                        <svg className="h-5 w-5 text-error" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <h3 className="text-base font-semibold text-accent">Error</h3>
                      </div>
                      <p className="text-sm text-text-secondary">{result.error || result.message}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
