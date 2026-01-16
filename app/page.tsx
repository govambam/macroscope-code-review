"use client";

import { useState } from "react";
import Image from "next/image";

type InputMode = "commit" | "pr";

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

export default function Home() {
  const [mode, setMode] = useState<InputMode>("commit");
  const [repoUrl, setRepoUrl] = useState("");
  const [specifyCommit, setSpecifyCommit] = useState(false);
  const [commitHash, setCommitHash] = useState("");
  const [prUrl, setPrUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<StatusMessage[]>([]);
  const [result, setResult] = useState<ApiResponse | null>(null);
  const [copied, setCopied] = useState(false);

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
    setCopied(false);

    addStatus("Starting PR creation process...", "info");

    try {
      addStatus("Validating inputs...", "info");

      if (mode === "commit") {
        // Validate repository URL
        const githubUrlRegex = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/;
        if (!githubUrlRegex.test(repoUrl)) {
          throw new Error("Invalid GitHub URL format. Expected: https://github.com/owner/repo-name");
        }

        // Validate commit hash if specified
        if (specifyCommit && commitHash) {
          const hashRegex = /^[a-f0-9]{7,40}$/i;
          if (!hashRegex.test(commitHash)) {
            throw new Error("Invalid commit hash format. Expected 7-40 character hex string");
          }
        }

        addStatus("Sending request to API...", "info");

        const response = await fetch("/api/create-pr", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
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
        // PR mode
        const prUrlRegex = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/;
        if (!prUrlRegex.test(prUrl)) {
          throw new Error("Invalid PR URL format. Expected: https://github.com/owner/repo/pull/123");
        }

        addStatus("Sending request to API...", "info");

        const response = await fetch("/api/create-pr", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            prUrl,
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

  const copyToClipboard = async () => {
    if (result?.prUrl) {
      try {
        await navigator.clipboard.writeText(result.prUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        const textarea = document.createElement("textarea");
        textarea.value = result.prUrl;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
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

  const handleModeChange = (newMode: InputMode) => {
    setMode(newMode);
    setStatus([]);
    setResult(null);
  };

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
            <h1 className="text-2xl font-semibold text-accent tracking-tight">
              PR Creator
            </h1>
            <p className="mt-2 text-text-secondary">
              Automatically fork repositories and create PRs for code review
            </p>
          </div>

          {/* Main Card */}
          <div className="bg-white border border-border rounded-xl shadow-sm p-8">
            {/* Mode Tabs */}
            <div className="flex mb-6 border-b border-border">
              <button
                type="button"
                onClick={() => handleModeChange("commit")}
                disabled={loading}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
                  mode === "commit"
                    ? "border-primary text-primary"
                    : "border-transparent text-text-secondary hover:text-accent"
                } disabled:opacity-50`}
              >
                Latest Commit
              </button>
              <button
                type="button"
                onClick={() => handleModeChange("pr")}
                disabled={loading}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
                  mode === "pr"
                    ? "border-primary text-primary"
                    : "border-transparent text-text-secondary hover:text-accent"
                } disabled:opacity-50`}
              >
                Recreate PR
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-6">
              {mode === "commit" ? (
                <>
                  {/* Repository URL Input */}
                  <div>
                    <label
                      htmlFor="repoUrl"
                      className="block text-sm font-medium text-accent mb-2"
                    >
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

                  {/* Specify Commit Checkbox */}
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

                  {/* Commit Hash Input (conditional) */}
                  {specifyCommit && (
                    <div>
                      <label
                        htmlFor="commitHash"
                        className="block text-sm font-medium text-accent mb-2"
                      >
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
              ) : (
                <>
                  {/* PR URL Input */}
                  <div>
                    <label
                      htmlFor="prUrl"
                      className="block text-sm font-medium text-accent mb-2"
                    >
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
                </>
              )}

              {/* Submit Button */}
              <button
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center py-3 px-4 bg-primary hover:bg-primary-hover text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <>
                    <svg
                      className="animate-spin -ml-1 mr-3 h-5 w-5 text-white"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                    Creating PR...
                  </>
                ) : (
                  "Create Pull Request"
                )}
              </button>
            </form>

            {/* Status Log */}
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

            {/* Result Display */}
            {result && (
              <div
                className={`mt-8 p-5 rounded-lg border ${
                  result.success
                    ? "bg-success-light border-success/20"
                    : "bg-error-light border-error/20"
                }`}
              >
                {result.success ? (
                  <div>
                    <h3 className="text-base font-semibold text-accent">
                      PR Created Successfully
                    </h3>
                    <p className="mt-2 text-sm text-text-secondary">
                      {result.message}
                    </p>
                    {result.originalPrNumber && result.commitCount && result.commitCount > 0 && (
                      <p className="mt-2 text-sm text-text-secondary">
                        Includes{" "}
                        <span className="font-medium text-accent">{result.commitCount} commit{result.commitCount > 1 ? "s" : ""}</span>
                        {" "}from original PR #{result.originalPrNumber}
                      </p>
                    )}
                    {result.commitHash && !result.originalPrNumber && (
                      <p className="mt-2 text-sm text-text-secondary">
                        {result.commitCount && result.commitCount > 1 ? "Merge commit:" : "Recreated commit:"}{" "}
                        <code className="bg-white px-1.5 py-0.5 rounded text-xs font-mono border border-border text-accent">
                          {result.commitHash.substring(0, 7)}
                        </code>
                      </p>
                    )}
                    {result.forkUrl && (
                      <p className="mt-2 text-sm text-text-secondary">
                        Fork:{" "}
                        <a
                          href={result.forkUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:underline"
                        >
                          {result.forkUrl}
                        </a>
                      </p>
                    )}
                    {result.prUrl && (
                      <div className="mt-4 flex items-center gap-3">
                        <a
                          href={result.prUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:underline text-sm break-all"
                        >
                          {result.prUrl}
                        </a>
                        <button
                          onClick={copyToClipboard}
                          className="shrink-0 px-3 py-1.5 text-sm font-medium bg-primary hover:bg-primary-hover text-white rounded-md transition-colors"
                        >
                          {copied ? "Copied!" : "Copy"}
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div>
                    <h3 className="text-base font-semibold text-accent">Error</h3>
                    <p className="mt-2 text-sm text-text-secondary">
                      {result.error || result.message}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="mt-8 text-center">
            <p className="text-sm text-text-muted">
              This tool automatically forks repositories and creates PRs within your fork.
            </p>
            <p className="mt-1 text-sm text-text-muted">
              Make sure your GitHub token has{" "}
              <code className="text-accent">repo</code> permissions.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
