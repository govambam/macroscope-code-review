"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Image from "next/image";

type MainTab = "create" | "forks" | "analysis";
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
  // Main tab state
  const [mainTab, setMainTab] = useState<MainTab>("create");

  // Create PR tab state
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
  const forksLoadedRef = useRef(false);
  const checkedPRsRef = useRef<Set<string>>(new Set());

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

  // Auto-check missing bug counts when switching to My Forks tab
  useEffect(() => {
    if (mainTab === "forks" && forks.length > 0) {
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
  }, [mainTab, forks]);

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
                  // Extract PR title from message (format: "PR created: <title>")
                  const prTitle = data.message?.replace(/^PR created:\s*/i, "") || "Review PR";
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

        // Remove deleted PRs
        data.deletedPRs.forEach((deleted: { repo: string; prNumber: number }) => {
          const forkIndex = updatedForks.findIndex((f) => f.repoName === deleted.repo);
          if (forkIndex !== -1) {
            updatedForks[forkIndex] = {
              ...updatedForks[forkIndex],
              prs: updatedForks[forkIndex].prs.filter((pr) => pr.prNumber !== deleted.prNumber),
            };
            // Remove fork if no PRs left
            if (updatedForks[forkIndex].prs.length === 0) {
              updatedForks.splice(forkIndex, 1);
            }
          }
        });

        setForks(updatedForks);
        localStorage.setItem("macroscope-forks", JSON.stringify(updatedForks));
        setSelection({ repos: new Set(), prs: new Set() });

        const message =
          data.errors.length > 0
            ? `Deleted ${data.deletedRepos.length} repos and ${data.deletedPRs.length} PRs. Some errors occurred.`
            : `Successfully deleted ${data.deletedRepos.length} repos and ${data.deletedPRs.length} PRs.`;

        setDeleteResult({ success: data.errors.length === 0, message });
      } else {
        setDeleteResult({ success: false, message: data.error || "Failed to delete" });
      }
    } catch (error) {
      setDeleteResult({
        success: false,
        message: error instanceof Error ? error.message : "Failed to delete",
      });
    } finally {
      setDeleteLoading(false);
    }
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

  const startAnalysisFromForks = (prUrl: string, hasExistingAnalysis = false) => {
    setAnalysisForkedUrl(prUrl);
    setAnalysisOriginalUrl("");
    setAnalysisResult(null);
    setGeneratedEmail(null);
    setEmailError(null);
    setCurrentAnalysisId(null);
    setIsViewingCached(false);
    setExpectingCachedResult(hasExistingAnalysis);
    setMainTab("analysis");

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
    <div className="min-h-screen flex flex-col">
      {/* Top Navigation Bar */}
      <header className="border-b border-border bg-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center h-16">
            <Image
              src="/Macroscope-text-logo.png"
              alt="Macroscope"
              width={160}
              height={32}
              className="h-8 w-auto"
              priority
            />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-xl mx-auto">
          {/* Page Header */}
          <div className="mb-10">
            <h1 className="text-2xl font-semibold text-accent tracking-tight">PR Creator</h1>
            <p className="mt-2 text-text-secondary">
              Automatically fork repositories and create PRs for code review
            </p>
          </div>

          {/* Main Tabs */}
          <div className="flex mb-6 border-b border-border">
            <button
              type="button"
              onClick={() => setMainTab("create")}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
                mainTab === "create"
                  ? "border-primary text-primary"
                  : "border-transparent text-text-secondary hover:text-accent"
              }`}
            >
              Create PR
            </button>
            <button
              type="button"
              onClick={() => setMainTab("forks")}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
                mainTab === "forks"
                  ? "border-primary text-primary"
                  : "border-transparent text-text-secondary hover:text-accent"
              }`}
            >
              My Forks
            </button>
            <button
              type="button"
              onClick={() => setMainTab("analysis")}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
                mainTab === "analysis"
                  ? "border-primary text-primary"
                  : "border-transparent text-text-secondary hover:text-accent"
              }`}
            >
              PR Analysis
            </button>
          </div>

          {mainTab === "create" ? (
            <>
              {/* Create PR Card */}
              <div className="bg-white border border-border rounded-xl shadow-sm p-8">
                {/* Sub-tabs for Create PR */}
                <div className="flex mb-6 border-b border-border">
                  <button
                    type="button"
                    onClick={() => handleCreateModeChange("pr")}
                    disabled={loading}
                    className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
                      createMode === "pr"
                        ? "border-primary text-primary"
                        : "border-transparent text-text-secondary hover:text-accent"
                    } disabled:opacity-50`}
                  >
                    Recreate PR
                  </button>
                  <button
                    type="button"
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
                        Paste any GitHub PR URL to recreate it for review
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
                          id="specifyCommit"
                          checked={specifyCommit}
                          onChange={(e) => setSpecifyCommit(e.target.checked)}
                          className="h-4 w-4 rounded border-border text-primary focus:ring-primary focus:ring-offset-0 cursor-pointer"
                          disabled={loading}
                        />
                        <label
                          htmlFor="specifyCommit"
                          className="ml-3 text-sm text-text-secondary cursor-pointer select-none"
                        >
                          Specify commit (otherwise uses latest from main branch)
                        </label>
                      </div>

                      {specifyCommit && (
                        <div>
                          <label htmlFor="commitHash" className="block text-sm font-medium text-accent mb-2">
                            Commit Hash
                          </label>
                          <input
                            type="text"
                            id="commitHash"
                            value={commitHash}
                            onChange={(e) => setCommitHash(e.target.value)}
                            placeholder="abc1234..."
                            className="w-full px-4 py-3 bg-white border border-border rounded-lg text-black placeholder:text-text-muted font-mono text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors"
                            required={specifyCommit}
                            disabled={loading}
                          />
                          <p className="mt-2 text-sm text-text-muted">
                            The specific commit you want to recreate as a PR
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

                {status.length > 0 && (
                  <div className="mt-8">
                    <h3 className="text-sm font-medium text-accent mb-3">Status</h3>
                    <div className="bg-bg-subtle border border-border rounded-lg p-4 max-h-64 overflow-y-auto">
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

                {result && (
                  <>
                    {result.success ? (
                      <div className="mt-8 rounded-xl border border-border bg-white p-6 shadow-sm">
                        <div className="flex items-center gap-2 mb-4">
                          <svg className="h-5 w-5 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <h3 className="text-lg font-semibold text-accent">PR Created Successfully</h3>
                        </div>
                        <p className="text-sm text-text-secondary mb-4">View your pull request:</p>
                        <a href={result.prUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline font-medium break-all">
                          {result.prUrl}
                        </a>
                        {result.prUrl && (
                          <div className="mt-5">
                            <a href={result.prUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-4 py-2.5 bg-primary hover:bg-primary-hover text-white font-medium rounded-lg transition-colors">
                              <Image src="/GitHub_Invertocat_White.svg" alt="" width={20} height={20} className="h-5 w-5" />
                              View in GitHub
                            </a>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="mt-8 rounded-xl border border-error/20 bg-error-light p-6">
                        <div className="flex items-center gap-2 mb-3">
                          <svg className="h-5 w-5 text-error" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <h3 className="text-lg font-semibold text-accent">Error</h3>
                        </div>
                        <p className="text-sm text-text-secondary">{result.error || result.message}</p>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Footer */}
              <div className="mt-8 text-center">
                <p className="text-sm text-text-muted">
                  This tool automatically forks repositories and creates PRs within your fork.
                </p>
                <p className="mt-1 text-sm text-text-muted">
                  Make sure your GitHub token has <code className="text-accent">repo</code> permissions.
                </p>
              </div>
            </>
          ) : mainTab === "forks" ? (
            <>
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
                    Refresh
                  </button>
                </div>

                {/* Filter options */}
                <div className="flex items-center mb-4">
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

                {/* Error display */}
                {forksError && (
                  <div className="mb-4 p-3 rounded-lg bg-error-light border border-error/20 text-sm text-error">
                    {forksError}
                  </div>
                )}

                {/* Delete result */}
                {deleteResult && (
                  <div className={`mb-4 p-3 rounded-lg border text-sm ${deleteResult.success ? "bg-success-light border-success/20 text-success" : "bg-error-light border-error/20 text-error"}`}>
                    {deleteResult.message}
                  </div>
                )}

                {/* Forks list */}
                {forks.length === 0 ? (
                  <div className="text-center py-12">
                    <svg className="mx-auto h-12 w-12 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                    </svg>
                    <h3 className="mt-4 text-sm font-medium text-accent">No forks tracked yet</h3>
                    <p className="mt-2 text-sm text-text-muted">
                      Create a PR to get started, or click &quot;Refresh&quot; to load existing forks from GitHub.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {filteredForks().map((fork) => {
                      const checkboxState = getRepoCheckboxState(fork.repoName);
                      return (
                        <div key={fork.repoName} className="border border-border rounded-lg p-4">
                          {/* Repo header */}
                          <div className="flex items-start gap-3">
                            <input
                              type="checkbox"
                              checked={checkboxState === "checked"}
                              ref={(el) => {
                                if (el) el.indeterminate = checkboxState === "indeterminate";
                              }}
                              onChange={() => toggleRepoSelection(fork.repoName)}
                              className="mt-1 h-4 w-4 rounded border-border text-primary focus:ring-primary focus:ring-offset-0 cursor-pointer"
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
                              <p className="text-xs text-text-muted mt-0.5">
                                Created: {formatDate(fork.createdAt)}
                              </p>

                              {/* PRs list */}
                              {fork.prs.length > 0 && (
                                <div className="mt-3 ml-2 border-l-2 border-border pl-4 space-y-2">
                                  {fork.prs.map((pr, idx) => (
                                    <div key={pr.prNumber} className="flex items-start gap-3">
                                      <div className="flex items-center gap-2 text-text-muted">
                                        {idx === fork.prs.length - 1 ? "└" : "├"}
                                      </div>
                                      <input
                                        type="checkbox"
                                        checked={selection.prs.has(`${fork.repoName}:${pr.prNumber}`)}
                                        onChange={() => togglePrSelection(fork.repoName, pr.prNumber)}
                                        className="mt-0.5 h-4 w-4 rounded border-border text-primary focus:ring-primary focus:ring-offset-0 cursor-pointer"
                                      />
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-start gap-1.5">
                                          <a
                                            href={pr.prUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-primary hover:underline text-sm"
                                          >
                                            PR #{pr.prNumber}: {pr.prTitle}
                                          </a>
                                          {/* Bug icon - aligned with first line of PR title */}
                                          {pr.macroscopeBugs !== undefined && pr.macroscopeBugs > 0 && (
                                            <svg className="w-4 h-4 text-orange-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                            </svg>
                                          )}
                                        </div>
                                        {/* Bug count */}
                                        <div className="flex items-center gap-1.5 text-xs mt-1">
                                          <span className="text-gray-600">Bug Count:</span>
                                          {checkingPR?.repo === fork.repoName && checkingPR?.pr === pr.prNumber ? (
                                            <svg className="w-4 h-4 animate-spin text-gray-400" fill="none" viewBox="0 0 24 24">
                                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                            </svg>
                                          ) : pr.macroscopeBugs === undefined ? (
                                            <button
                                              onClick={() => checkSinglePRBugs(fork.repoName, pr.prNumber)}
                                              className="text-gray-400 hover:text-primary transition-colors"
                                              title="Check for bugs"
                                            >
                                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                              </svg>
                                            </button>
                                          ) : (
                                            <span className="text-gray-600">{pr.macroscopeBugs}</span>
                                          )}
                                        </div>
                                        <div className="flex items-center gap-2 mt-1">
                                          <span className="text-xs text-text-muted">
                                            {formatDate(pr.createdAt)}
                                          </span>
                                          {/* Analyze PR / View Analysis button - show for PRs with bugs */}
                                          {pr.macroscopeBugs !== undefined && pr.macroscopeBugs > 0 && (
                                            <button
                                              onClick={() => startAnalysisFromForks(pr.prUrl, pr.hasAnalysis)}
                                              className={`text-xs px-2 py-0.5 rounded transition-colors ${
                                                pr.hasAnalysis
                                                  ? "bg-success/10 text-success hover:bg-success/20"
                                                  : "bg-primary/10 text-primary hover:bg-primary/20"
                                              }`}
                                            >
                                              {pr.hasAnalysis ? "View Analysis" : "Analyze PR"}
                                            </button>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}

                              {/* Empty state for forks with no PRs */}
                              {fork.prs.length === 0 && (
                                <div className="mt-3 ml-2 border-l-2 border-border pl-4">
                                  <p className="text-sm text-text-muted italic">
                                    No review PRs in this fork
                                  </p>
                                </div>
                              )}
                            </div>
                          </div>
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
                    Showing {filteredForks().length} fork{filteredForks().length !== 1 ? "s" : ""} with{" "}
                    {filteredForks().reduce((acc, f) => acc + f.prs.length, 0)} PR
                    {filteredForks().reduce((acc, f) => acc + f.prs.length, 0) !== 1 ? "s" : ""}
                  </p>
                </div>
              )}
            </>
          ) : mainTab === "analysis" ? (
            <>
              {/* PR Analysis Card */}
              <div className="bg-white border border-border rounded-xl shadow-sm p-8">
                <div className="mb-6">
                  <h2 className="text-lg font-semibold text-accent">Analyze PR for Meaningful Bugs</h2>
                  <p className="mt-1 text-sm text-text-secondary">
                    Use Claude Opus 4.5 to analyze if Macroscope found any meaningful bugs in a PR.
                  </p>
                </div>

                <form id="analysis-form" onSubmit={handleAnalysis} className="space-y-6">
                  <div>
                    <label htmlFor="analysisForkedUrl" className="block text-sm font-medium text-accent mb-2">
                      Forked PR URL <span className="text-error">*</span>
                    </label>
                    <input
                      type="text"
                      id="analysisForkedUrl"
                      value={analysisForkedUrl}
                      onChange={(e) => setAnalysisForkedUrl(e.target.value)}
                      placeholder="https://github.com/your-username/repo/pull/1"
                      className="w-full px-4 py-3 bg-white border border-border rounded-lg text-black placeholder:text-text-muted focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors"
                      required
                      disabled={analysisLoading}
                    />
                    <p className="mt-2 text-sm text-text-muted">
                      The PR in your fork that has Macroscope&apos;s review comments
                    </p>
                  </div>

                  <div>
                    <label htmlFor="analysisOriginalUrl" className="block text-sm font-medium text-accent mb-2">
                      Original PR URL <span className="text-text-muted">(auto-extracted)</span>
                    </label>
                    <input
                      type="text"
                      id="analysisOriginalUrl"
                      value={analysisOriginalUrl}
                      onChange={(e) => setAnalysisOriginalUrl(e.target.value)}
                      placeholder="Auto-extracted from PR description"
                      className="w-full px-4 py-3 bg-white border border-border rounded-lg text-black placeholder:text-text-muted focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors"
                      disabled={analysisLoading}
                    />
                    <p className="mt-2 text-sm text-text-muted">
                      Automatically extracted from the forked PR description. Only fill this if extraction fails.
                    </p>
                  </div>

                  <button
                    type="submit"
                    disabled={analysisLoading || !analysisForkedUrl}
                    className="w-full flex items-center justify-center py-3 px-4 bg-primary hover:bg-primary-hover text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {analysisLoading ? (
                      <>
                        <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        {expectingCachedResult ? "Loading..." : "Analyzing with Claude..."}
                      </>
                    ) : (
                      <>
                        <svg className="mr-2 h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                        </svg>
                        Analyze PR
                      </>
                    )}
                  </button>
                </form>

                {/* Analysis Results */}
                {analysisResult && (
                  <div className="mt-8">
                    {analysisResult.success && analysisResult.result ? (
                      analysisResult.result.meaningful_bugs_found ? (
                        // Meaningful bugs found
                        <div className="space-y-6">
                          {/* Bug Summary Header */}
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <div className="p-2 bg-orange-100 rounded-lg">
                                <svg className="h-6 w-6 text-orange-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                </svg>
                              </div>
                              <div>
                                <div className="flex items-center gap-2">
                                  <h3 className="text-lg font-semibold text-accent">Meaningful Bugs Found</h3>
                                  {isViewingCached && (
                                    <span className="px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 rounded">
                                      Cached
                                    </span>
                                  )}
                                </div>
                              <p className="text-sm text-text-secondary">
                                {analysisResult.result.bugs.length} meaningful bug{analysisResult.result.bugs.length !== 1 ? "s" : ""} out of {analysisResult.result.total_macroscope_bugs_found} total issue{analysisResult.result.total_macroscope_bugs_found !== 1 ? "s" : ""} detected
                              </p>
                              </div>
                            </div>
                            {/* Regenerate button - always available */}
                            <button
                              onClick={(e) => handleAnalysis(e, true)}
                              disabled={analysisLoading}
                              className="flex items-center gap-1.5 text-xs px-3 py-1.5 border border-border text-text-secondary hover:text-accent hover:border-accent rounded-lg transition-colors disabled:opacity-50"
                            >
                              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                              </svg>
                              Regenerate
                            </button>
                          </div>

                          {/* All Bugs List */}
                          <div className="space-y-4">
                            {analysisResult.result.bugs.map((bug, idx) => (
                              <div
                                key={idx}
                                className={`border rounded-lg p-5 ${
                                  bug.is_most_impactful
                                    ? "border-orange-300 bg-orange-50 ring-2 ring-orange-200"
                                    : "border-border bg-bg-subtle"
                                }`}
                              >
                                <div className="flex items-start justify-between gap-4 mb-3">
                                  <div className="flex-1">
                                    <div className="flex items-center gap-2 mb-1">
                                      {bug.is_most_impactful && (
                                        <span className="px-2 py-0.5 text-xs font-semibold bg-orange-500 text-white rounded">
                                          MOST IMPACTFUL
                                        </span>
                                      )}
                                    </div>
                                    <h4 className="font-semibold text-accent">{bug.title}</h4>
                                    <p className="text-sm text-text-muted mt-1 font-mono">
                                      {bug.file_path}
                                    </p>
                                  </div>
                                  <span className={`px-2.5 py-1 text-xs font-semibold rounded-full border shrink-0 ${getSeverityColor(bug.severity)}`}>
                                    {bug.severity.toUpperCase()}
                                  </span>
                                </div>

                                {/* Explanation */}
                                <div className="text-sm text-text-secondary whitespace-pre-wrap leading-relaxed">
                                  {bug.explanation}
                                </div>

                                {/* Copy Button */}
                                <div className="mt-3 pt-3 border-t border-border/50">
                                  <button
                                    onClick={() => copyBugExplanation(bug.explanation, idx)}
                                    className="flex items-center gap-2 px-3 py-1.5 text-xs text-text-secondary hover:text-accent hover:bg-white rounded transition-colors"
                                  >
                                    {copiedBugIndex === idx ? (
                                      <>
                                        <svg className="h-3.5 w-3.5 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                        </svg>
                                        Copied!
                                      </>
                                    ) : (
                                      <>
                                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                          <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                        </svg>
                                        Copy explanation
                                      </>
                                    )}
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>

                          {/* Email Generation Section */}
                          <div className="border-t border-border pt-6 mt-6">
                            <div className="flex items-start justify-between mb-4">
                              <div>
                                <h4 className="text-base font-semibold text-accent">Generate Outreach Email</h4>
                                <p className="text-sm text-text-secondary mt-1">
                                  Generate an email using the most impactful bug. The email will include Attio merge fields for personalization.
                                </p>
                              </div>
                              <div className="relative group">
                                <svg className="h-5 w-5 text-text-muted cursor-help" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                <div className="absolute right-0 top-6 w-64 p-3 bg-accent text-white text-xs rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10">
                                  <p className="font-semibold mb-1">Attio Merge Fields</p>
                                  <p>The email uses placeholders like {"{ First Name }"} that Attio will automatically replace with actual data when you send from a sequence.</p>
                                </div>
                              </div>
                            </div>

                            <button
                              onClick={handleGenerateEmail}
                              disabled={emailLoading}
                              className="w-full flex items-center justify-center py-2.5 px-4 bg-primary hover:bg-primary-hover text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {emailLoading ? (
                                <>
                                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                  </svg>
                                  Generating Email...
                                </>
                              ) : (
                                <>
                                  <svg className="mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                                  </svg>
                                  Generate Email
                                </>
                              )}
                            </button>

                            {/* Email Error */}
                            {emailError && (
                              <div className="mt-4 p-3 rounded-lg bg-error-light border border-error/20 text-sm text-error">
                                {emailError}
                              </div>
                            )}

                            {/* Generated Email Display */}
                            {generatedEmail && (
                              <div className="mt-4 border border-border rounded-lg bg-white">
                                <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-bg-subtle rounded-t-lg">
                                  <span className="text-sm font-medium text-accent">Generated Email</span>
                                  <button
                                    onClick={copyEmail}
                                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-primary text-white hover:bg-primary-hover rounded transition-colors"
                                  >
                                    {emailCopied ? (
                                      <>
                                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                        </svg>
                                        Copied!
                                      </>
                                    ) : (
                                      <>
                                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                          <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                        </svg>
                                        Copy Email
                                      </>
                                    )}
                                  </button>
                                </div>
                                <div
                                  className="p-4 text-sm text-text-secondary whitespace-pre-wrap leading-relaxed"
                                  dangerouslySetInnerHTML={{
                                    __html: generatedEmail
                                      .replace(/&/g, "&amp;")
                                      .replace(/</g, "&lt;")
                                      .replace(/>/g, "&gt;")
                                      .replace(/\{ (First Name|Company Name|Sender Name) \}/g,
                                        '<span class="px-1 py-0.5 bg-purple-100 text-purple-700 rounded font-medium">{ $1 }</span>')
                                  }}
                                />
                                <div className="px-4 py-3 border-t border-border bg-purple-50 rounded-b-lg">
                                  <p className="text-xs text-purple-700">
                                    <span className="font-semibold">Attio merge fields:</span> The highlighted placeholders ({"{ First Name }"}, {"{ Company Name }"}, {"{ Sender Name }"}) will be automatically replaced with actual data when you paste this into an Attio sequence.
                                  </p>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      ) : (
                        // No meaningful bugs
                        <div className="rounded-xl border border-border bg-bg-subtle p-6">
                          <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-3">
                              <div className="p-2 bg-gray-100 rounded-lg">
                                <svg className="h-6 w-6 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                              </div>
                              <div>
                                <div className="flex items-center gap-2">
                                  <h3 className="text-lg font-semibold text-accent">No Meaningful Bugs Found</h3>
                                  {isViewingCached && (
                                    <span className="px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 rounded">
                                      Cached
                                    </span>
                                  )}
                                </div>
                                <p className="text-sm text-text-secondary">
                                  The issues found don&apos;t meet the threshold for meaningful bugs.
                                </p>
                              </div>
                            </div>
                            {/* Regenerate button */}
                            <button
                              onClick={(e) => handleAnalysis(e, true)}
                              disabled={analysisLoading}
                              className="flex items-center gap-1.5 text-xs px-3 py-1.5 border border-border text-text-secondary hover:text-accent hover:border-accent rounded-lg transition-colors disabled:opacity-50"
                            >
                              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                              </svg>
                              Regenerate
                            </button>
                          </div>
                          <p className="text-sm text-text-secondary bg-white border border-border rounded-lg p-4">
                            {analysisResult.result.reason}
                          </p>
                        </div>
                      )
                    ) : (
                      // Error
                      <div className="rounded-xl border border-error/20 bg-error-light p-6">
                        <div className="flex items-center gap-2 mb-3">
                          <svg className="h-5 w-5 text-error" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <h3 className="text-lg font-semibold text-accent">Analysis Failed</h3>
                        </div>
                        <p className="text-sm text-text-secondary">{analysisResult.error}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="mt-8 text-center">
                <p className="text-sm text-text-muted">
                  Powered by Claude Opus 4.5 for intelligent bug analysis.
                </p>
              </div>
            </>
          ) : null}
        </div>
      </main>

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
    </div>
  );
}
