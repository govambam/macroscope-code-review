"use client";

import { useState } from "react";

interface ApiResponse {
  success: boolean;
  prUrl?: string;
  message: string;
  commitHash?: string;
  forkUrl?: string;
  error?: string;
}

export default function Home() {
  const [repoUrl, setRepoUrl] = useState("");
  const [specifyCommit, setSpecifyCommit] = useState(false);
  const [commitHash, setCommitHash] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string[]>([]);
  const [result, setResult] = useState<ApiResponse | null>(null);
  const [copied, setCopied] = useState(false);

  const addStatus = (message: string) => {
    setStatus((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${message}`]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setStatus([]);
    setResult(null);
    setCopied(false);

    addStatus("Starting PR creation process...");

    try {
      addStatus("Validating inputs...");

      // Basic validation
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

      addStatus("Sending request to API...");

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

      // Handle streaming status updates if available
      const data: ApiResponse = await response.json();

      if (data.success) {
        addStatus("PR created successfully!");
        setResult(data);
      } else {
        addStatus(`Error: ${data.error || data.message}`);
        setResult(data);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
      addStatus(`Error: ${errorMessage}`);
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
        // Fallback for older browsers
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

  return (
    <main className="min-h-screen py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900">
            Macroscope PR Creator
          </h1>
          <p className="mt-2 text-gray-600">
            Automatically fork repositories and create PRs for Macroscope code reviews
          </p>
        </div>

        <div className="bg-white shadow-md rounded-lg p-6">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label
                htmlFor="repoUrl"
                className="block text-sm font-medium text-gray-700"
              >
                GitHub Repository URL
              </label>
              <input
                type="text"
                id="repoUrl"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                placeholder="https://github.com/owner/repo-name"
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                required
                disabled={loading}
              />
              <p className="mt-1 text-xs text-gray-500">
                Enter the original repository URL (we&apos;ll fork it for you)
              </p>
            </div>

            <div className="flex items-center">
              <input
                type="checkbox"
                id="specifyCommit"
                checked={specifyCommit}
                onChange={(e) => setSpecifyCommit(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                disabled={loading}
              />
              <label
                htmlFor="specifyCommit"
                className="ml-2 block text-sm text-gray-700"
              >
                Specify commit (otherwise uses latest from main branch)
              </label>
            </div>

            {specifyCommit && (
              <div>
                <label
                  htmlFor="commitHash"
                  className="block text-sm font-medium text-gray-700"
                >
                  Commit Hash
                </label>
                <input
                  type="text"
                  id="commitHash"
                  value={commitHash}
                  onChange={(e) => setCommitHash(e.target.value)}
                  placeholder="abc1234..."
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono text-sm"
                  required={specifyCommit}
                  disabled={loading}
                />
                <p className="mt-1 text-xs text-gray-500">
                  The specific commit you want to recreate as a PR for review
                </p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
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
            <div className="mt-6">
              <h3 className="text-sm font-medium text-gray-700 mb-2">Status</h3>
              <div className="bg-gray-900 rounded-md p-4 max-h-48 overflow-y-auto">
                {status.map((msg, idx) => (
                  <p key={idx} className="text-green-400 text-sm font-mono">
                    {msg}
                  </p>
                ))}
              </div>
            </div>
          )}

          {/* Result Display */}
          {result && (
            <div
              className={`mt-6 p-4 rounded-md ${
                result.success
                  ? "bg-green-50 border border-green-200"
                  : "bg-red-50 border border-red-200"
              }`}
            >
              {result.success ? (
                <div>
                  <h3 className="text-lg font-medium text-green-800">
                    PR Created Successfully!
                  </h3>
                  <p className="mt-2 text-sm text-green-700">
                    {result.message}
                  </p>
                  {result.commitHash && (
                    <p className="mt-1 text-sm text-green-600">
                      Recreated commit:{" "}
                      <code className="bg-green-100 px-1 rounded">
                        {result.commitHash}
                      </code>
                    </p>
                  )}
                  {result.forkUrl && (
                    <p className="mt-1 text-sm text-green-600">
                      Fork:{" "}
                      <a
                        href={result.forkUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:text-blue-800 underline"
                      >
                        {result.forkUrl}
                      </a>
                    </p>
                  )}
                  {result.prUrl && (
                    <div className="mt-4 flex items-center gap-2">
                      <a
                        href={result.prUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:text-blue-800 underline break-all"
                      >
                        {result.prUrl}
                      </a>
                      <button
                        onClick={copyToClipboard}
                        className="flex-shrink-0 px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        {copied ? "Copied!" : "Copy URL"}
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <h3 className="text-lg font-medium text-red-800">Error</h3>
                  <p className="mt-2 text-sm text-red-700">
                    {result.error || result.message}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="mt-8 text-center text-sm text-gray-500">
          <p>
            This tool automatically forks the repository and creates PRs within your fork.
          </p>
          <p className="mt-1">
            Make sure your GitHub token has repo permissions.
          </p>
        </div>
      </div>
    </main>
  );
}
