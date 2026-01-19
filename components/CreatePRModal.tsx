"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import { Modal } from "./Modal";

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
  type: "info" | "success" | "error" | "progress";
  text: string;
  timestamp: string;
  step?: number;
  totalSteps?: number;
}

interface MacroscopeCheckState {
  status: "polling" | "found" | "timeout" | "error";
  bugCount: number;
  pollCount: number;
  lastChecked: Date | null;
}

interface CreatePRModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPRCreated: (prUrl: string, forkUrl: string, prTitle: string, commitCount: number) => void;
  onAnalyzePR: (prUrl: string) => void;
}

export function CreatePRModal({ isOpen, onClose, onPRCreated, onAnalyzePR }: CreatePRModalProps) {
  const [createMode, setCreateMode] = useState<CreateMode>("pr");
  const [repoUrl, setRepoUrl] = useState("");
  const [specifyCommit, setSpecifyCommit] = useState(false);
  const [commitHash, setCommitHash] = useState("");
  const [prUrl, setPrUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<StatusMessage[]>([]);
  const [result, setResult] = useState<ApiResponse | null>(null);
  const [macroscopeCheck, setMacroscopeCheck] = useState<MacroscopeCheckState | null>(null);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setCreateMode("pr");
      setRepoUrl("");
      setSpecifyCommit(false);
      setCommitHash("");
      setPrUrl("");
      setStatus([]);
      setResult(null);
      setMacroscopeCheck(null);
    }
  }, [isOpen]);

  // Poll for Macroscope review completion after PR creation
  useEffect(() => {
    if (!result?.success || !result.prUrl || !macroscopeCheck) return;
    if (macroscopeCheck.status !== "polling") return;

    const MAX_POLLS = 20;
    const POLL_INTERVAL = 30000;

    if (macroscopeCheck.pollCount >= MAX_POLLS) {
      setMacroscopeCheck(prev => prev ? { ...prev, status: "timeout" } : null);
      return;
    }

    const delay = macroscopeCheck.pollCount === 0 ? 0 : POLL_INTERVAL;

    const timeoutId = setTimeout(async () => {
      try {
        const match = result.prUrl!.match(/github\.com\/[\w.-]+\/([\w.-]+)\/pull\/(\d+)/);
        if (!match) {
          setMacroscopeCheck(prev => prev ? { ...prev, status: "error" } : null);
          return;
        }

        const repoName = match[1];
        const prNumber = parseInt(match[2], 10);

        const response = await fetch("/api/forks/check-bugs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ repoName, prNumber }),
        });

        const data = await response.json();

        if (data.success && data.bugCount > 0) {
          setMacroscopeCheck({
            status: "found",
            bugCount: data.bugCount,
            pollCount: macroscopeCheck.pollCount + 1,
            lastChecked: new Date(),
          });
        } else {
          setMacroscopeCheck(prev => prev ? {
            ...prev,
            pollCount: prev.pollCount + 1,
            lastChecked: new Date(),
          } : null);
        }
      } catch {
        setMacroscopeCheck(prev => prev ? { ...prev, status: "error" } : null);
      }
    }, delay);

    return () => clearTimeout(timeoutId);
  }, [result, macroscopeCheck]);

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
    setMacroscopeCheck(null);

    try {
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

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

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
              addStatus(data.message, data.statusType || "info", data.step, data.totalSteps);
            } else if (data.eventType === "result") {
              if (data.success) {
                addStatus("PR created successfully!", "success");
                if (data.prUrl && data.forkUrl) {
                  const prTitle = data.message?.replace(/^PR created:\s*/i, "") || "Review PR";
                  onPRCreated(data.prUrl, data.forkUrl, prTitle, data.commitCount || 1);
                }
                setMacroscopeCheck({
                  status: "polling",
                  bugCount: 0,
                  pollCount: 0,
                  lastChecked: null,
                });
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
            // Ignore parse errors
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
    setMacroscopeCheck(null);
  };

  const refreshMacroscopeCheck = async () => {
    if (!result?.prUrl) return;

    const match = result.prUrl.match(/github\.com\/[\w.-]+\/([\w.-]+)\/pull\/(\d+)/);
    if (!match) return;

    const repoName = match[1];
    const prNumber = parseInt(match[2], 10);

    setMacroscopeCheck(prev => prev ? { ...prev, status: "polling" } : {
      status: "polling",
      bugCount: 0,
      pollCount: 0,
      lastChecked: null,
    });

    try {
      const response = await fetch("/api/forks/check-bugs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoName, prNumber }),
      });

      const data = await response.json();

      if (data.success && data.bugCount > 0) {
        setMacroscopeCheck({
          status: "found",
          bugCount: data.bugCount,
          pollCount: 0,
          lastChecked: new Date(),
        });
      } else {
        setMacroscopeCheck({
          status: "timeout",
          bugCount: 0,
          pollCount: 0,
          lastChecked: new Date(),
        });
      }
    } catch {
      setMacroscopeCheck(prev => prev ? { ...prev, status: "error" } : null);
    }
  };

  const handleAnalyzePR = () => {
    if (result?.prUrl) {
      onAnalyzePR(result.prUrl);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Create New PR" size="lg">
      {/* Sub-tabs for Create PR */}
      <div className="flex mb-6 border-b border-border -mx-6 px-6">
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
            <div className="mt-8 rounded-xl border border-success/20 bg-success-light p-6">
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
                <div className="mt-5 flex flex-wrap gap-3">
                  <a href={result.prUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-4 py-2.5 bg-primary hover:bg-primary-hover text-white font-medium rounded-lg transition-colors">
                    <Image src="/GitHub_Invertocat_White.svg" alt="" width={20} height={20} className="h-5 w-5" />
                    View in GitHub
                  </a>
                  <button
                    onClick={handleAnalyzePR}
                    disabled={macroscopeCheck?.status === "polling"}
                    className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-primary text-primary hover:bg-primary-light font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
                    </svg>
                    Analyze PR
                  </button>
                </div>
              )}

              {/* Macroscope Review Status */}
              {macroscopeCheck && (
                <div className="mt-6 pt-5 border-t border-success/20">
                  <div className="flex items-center gap-3">
                    {macroscopeCheck.status === "polling" && (
                      <>
                        <svg className="animate-spin h-5 w-5 text-primary" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        <div>
                          <p className="text-sm font-medium text-accent">Waiting for Macroscope review...</p>
                          <p className="text-xs text-text-muted">
                            Checking every 30 seconds ({macroscopeCheck.pollCount}/20)
                          </p>
                        </div>
                      </>
                    )}

                    {macroscopeCheck.status === "found" && (
                      <>
                        <div className="p-1.5 bg-orange-100 rounded-lg">
                          <svg className="h-5 w-5 text-orange-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                          </svg>
                        </div>
                        <div className="flex-1">
                          <p className="text-sm font-medium text-accent">
                            Macroscope found {macroscopeCheck.bugCount} issue{macroscopeCheck.bugCount !== 1 ? "s" : ""}!
                          </p>
                          <p className="text-xs text-text-muted">
                            Click &quot;Analyze PR&quot; to review the findings
                          </p>
                        </div>
                      </>
                    )}

                    {macroscopeCheck.status === "timeout" && (
                      <>
                        <div className="p-1.5 bg-gray-100 rounded-lg">
                          <svg className="h-5 w-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        </div>
                        <div className="flex-1">
                          <p className="text-sm font-medium text-accent">No issues detected yet</p>
                          <p className="text-xs text-text-muted">
                            Macroscope may still be reviewing, or found no issues
                          </p>
                        </div>
                        <button
                          onClick={refreshMacroscopeCheck}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-text-secondary hover:text-accent border border-border hover:border-accent rounded-lg transition-colors"
                        >
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                          Check Again
                        </button>
                      </>
                    )}

                    {macroscopeCheck.status === "error" && (
                      <>
                        <div className="p-1.5 bg-red-100 rounded-lg">
                          <svg className="h-5 w-5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        </div>
                        <div className="flex-1">
                          <p className="text-sm font-medium text-accent">Failed to check review status</p>
                          <p className="text-xs text-text-muted">
                            There was an error checking for Macroscope comments
                          </p>
                        </div>
                        <button
                          onClick={refreshMacroscopeCheck}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-text-secondary hover:text-accent border border-border hover:border-accent rounded-lg transition-colors"
                        >
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                          Retry
                        </button>
                      </>
                    )}
                  </div>
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

      {/* Footer text */}
      <div className="mt-6 text-center">
        <p className="text-xs text-text-muted">
          This tool automatically forks repositories and creates PRs within your fork.
        </p>
      </div>
    </Modal>
  );
}
