"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Image from "next/image";

type MainTab = "create" | "forks";
type CreateMode = "commit" | "pr";

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
  type: "info" | "success" | "error";
  text: string;
  timestamp: string;
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

  // Load forks from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem("macroscope-forks");
    if (stored) {
      try {
        setForks(JSON.parse(stored));
      } catch {
        // Invalid data, ignore
      }
    }
  }, []);

  // Load forks when switching to My Forks tab (only once)
  useEffect(() => {
    if (mainTab === "forks" && !forksLoadedRef.current && forks.length === 0) {
      // Don't auto-load, let user click refresh
    }
  }, [mainTab, forks.length]);

  const addStatus = (text: string, type: "info" | "success" | "error" = "info") => {
    const timestamp = new Date().toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    setStatus((prev) => [...prev, { type, text, timestamp }]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setStatus([]);
    setResult(null);

    addStatus("Starting PR creation process...", "info");

    try {
      addStatus("Validating inputs...", "info");

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

        addStatus("Sending request to API...", "info");

        const response = await fetch("/api/create-pr", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            repoUrl,
            commitHash: specifyCommit ? commitHash : undefined,
          }),
        });

        const data: ApiResponse = await response.json();

        if (data.success) {
          addStatus("PR created successfully!", "success");
          setResult(data);
        } else {
          addStatus(data.error || data.message, "error");
          setResult(data);
        }
      } else {
        const prUrlRegex = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/;
        if (!prUrlRegex.test(prUrl)) {
          throw new Error("Invalid PR URL format. Expected: https://github.com/owner/repo/pull/123");
        }

        addStatus("Sending request to API...", "info");

        const response = await fetch("/api/create-pr", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prUrl }),
        });

        const data: ApiResponse = await response.json();

        if (data.success) {
          addStatus("PR created successfully!", "success");
          setResult(data);
        } else {
          addStatus(data.error || data.message, "error");
          setResult(data);
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

  const getStatusColor = (type: "info" | "success" | "error") => {
    switch (type) {
      case "success":
        return "text-success";
      case "error":
        return "text-error";
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
      const fork = forks.find((f) => f.repoName === repoName);

      if (newPrs.has(prKey)) {
        newPrs.delete(prKey);
        // If no PRs selected for this repo, deselect the repo
        const hasOtherPrs = fork?.prs.some((pr) => newPrs.has(`${repoName}:${pr.prNumber}`));
        if (!hasOtherPrs) {
          newRepos.delete(repoName);
        }
      } else {
        newPrs.add(prKey);
        // Check if all PRs are now selected
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

    // Find repos where all PRs are selected (delete the whole repo)
    forks.forEach((fork) => {
      const allPrsSelected = fork.prs.every((pr) =>
        selection.prs.has(`${fork.repoName}:${pr.prNumber}`)
      );
      if (allPrsSelected && fork.prs.length > 0) {
        reposToDelete.add(fork.repoName);
      }
    });

    // Find individual PRs to delete (from repos not being fully deleted)
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
                    <div className="bg-bg-subtle border border-border rounded-lg p-4 max-h-48 overflow-y-auto">
                      <div className="space-y-2">
                        {status.map((msg, idx) => (
                          <div key={idx} className="flex items-start gap-3 text-sm">
                            <span className="text-text-muted font-mono text-xs shrink-0 pt-0.5">
                              {msg.timestamp}
                            </span>
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
          ) : (
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
                                        <div className="flex items-center gap-1.5">
                                          <a
                                            href={pr.prUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-primary hover:underline text-sm"
                                          >
                                            PR #{pr.prNumber}: {pr.prTitle}
                                          </a>
                                          {/* Bug icon - shown after PR title */}
                                          {pr.macroscopeBugs !== undefined && pr.macroscopeBugs > 0 && (
                                            <svg className="w-4 h-4 text-orange-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
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
                                        <span className="text-xs text-text-muted mt-0.5 block">
                                          {formatDate(pr.createdAt)}
                                        </span>
                                      </div>
                                    </div>
                                  ))}
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
          )}
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
