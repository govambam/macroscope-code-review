"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";

interface ApolloSectionProps {
  variables: Record<string, string>;
  defaultSearchQuery: string;
  currentAnalysisId: number | null;
  onSendComplete: () => void;
  contactId?: string | null; // Apollo contact ID for task creation
}

export function ApolloSection({
  variables,
  defaultSearchQuery,
  currentAnalysisId,
  onSendComplete,
  contactId,
}: ApolloSectionProps) {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState(defaultSearchQuery);
  const [searchResults, setSearchResults] = useState<Array<{ id: string; name: string; domain: string | null }>>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<{ id: string; name: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [sendSuccess, setSendSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [taskCreated, setTaskCreated] = useState(false);

  async function handleSearch() {
    if (!searchQuery.trim()) return;
    setSearchLoading(true);
    setError(null);
    setSelectedAccount(null);

    try {
      const res = await fetch("/api/apollo/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: searchQuery.trim() }),
      });

      const data = await res.json();

      if (data.success && data.accounts) {
        setSearchResults(data.accounts);
        if (data.accounts.length === 0) {
          setError("No accounts found matching that name.");
        }
      } else {
        setError(data.error || "Search failed");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setSearchLoading(false);
    }
  }

  async function handleSend() {
    if (!selectedAccount || !variables) return;
    setSending(true);
    setError(null);

    try {
      // First, update the account with variables
      const res = await fetch("/api/apollo/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: selectedAccount.id,
          variables,
        }),
      });

      const data = await res.json();

      if (!data.success) {
        setError(data.error || "Failed to send to Apollo");
        return;
      }

      // If we have a contact ID, create a task for them
      if (contactId) {
        try {
          const taskRes = await fetch("/api/apollo/task", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contact_id: contactId,
              note: "Add to New User Signup sequence",
              priority: "medium",
            }),
          });

          const taskData = await taskRes.json();
          if (taskData.success) {
            setTaskCreated(true);
          } else {
            console.warn("Failed to create task:", taskData.error);
            // Don't fail the whole operation if task creation fails
          }
        } catch (taskErr) {
          console.warn("Failed to create task:", taskErr);
          // Don't fail the whole operation if task creation fails
        }
      }

      setSendSuccess(true);
      onSendComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send to Apollo");
    } finally {
      setSending(false);
    }
  }

  // ── Success / completion state ────────────────────────────────────────

  if (sendSuccess) {
    return (
      <div className="space-y-6">
        <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
          <div className="flex items-start gap-2">
            <svg className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            <div>
              <p className="text-sm font-medium text-green-800">
                Variables sent to Apollo successfully!
              </p>
              {selectedAccount && (
                <p className="text-sm text-green-700 mt-1">
                  Sent to: {selectedAccount.name}
                </p>
              )}
              {taskCreated && (
                <p className="text-sm text-green-700 mt-1">
                  Task created: &quot;Add to New User Signup sequence&quot;
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="border border-border rounded-lg p-5">
          <h3 className="text-sm font-semibold text-accent mb-3">Prospecting session complete!</h3>
          <p className="text-sm text-text-secondary mb-4">What&apos;s next?</p>
          <ul className="text-sm text-text-secondary space-y-1.5 mb-5">
            <li>&bull; View this account in Apollo to start your outreach</li>
            <li>&bull; Simulate more PRs for this company</li>
            <li>&bull; Start a new prospecting session</li>
          </ul>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => {
                window.location.reload();
              }}
              className="px-4 py-2 text-sm font-medium text-white bg-primary hover:bg-primary-hover rounded-lg transition-colors"
            >
              Simulate More PRs
            </button>
            <button
              type="button"
              onClick={() => router.push("/prospector/new")}
              className="px-4 py-2 text-sm font-medium text-text-secondary border border-border rounded-lg hover:bg-gray-50 transition-colors"
            >
              New Session
            </button>
            <button
              type="button"
              onClick={() => router.push("/prospector")}
              className="px-4 py-2 text-sm font-medium text-text-secondary border border-border rounded-lg hover:bg-gray-50 transition-colors"
            >
              Back to Sessions
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Search and send UI ────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium text-accent mb-1">Send to Apollo</h3>
        <p className="text-xs text-text-secondary mb-4">
          Search for an account in Apollo and send the email variables to their custom fields.
        </p>
      </div>

      {/* Search input */}
      <div className="flex gap-2">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          placeholder="Search account name..."
          className="flex-1 px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
        />
        <button
          onClick={handleSearch}
          disabled={searchLoading || !searchQuery.trim()}
          className="px-4 py-2 text-sm font-medium bg-bg-subtle hover:bg-gray-100 border border-border rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {searchLoading ? (
            <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          ) : (
            "Search"
          )}
        </button>
      </div>

      {/* Search results */}
      {searchResults.length > 0 && (
        <div className="border border-border rounded-lg divide-y divide-border max-h-48 overflow-y-auto">
          {searchResults.map((account) => (
            <button
              key={account.id}
              onClick={() => setSelectedAccount({ id: account.id, name: account.name })}
              className={`w-full px-3 py-2 text-left text-sm hover:bg-bg-subtle transition-colors ${
                selectedAccount?.id === account.id ? "bg-primary/5 border-l-2 border-l-primary" : ""
              }`}
            >
              <div className="font-medium text-text-primary">{account.name}</div>
              {account.domain && (
                <div className="text-xs text-text-secondary">{account.domain}</div>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Selected account & send button */}
      {selectedAccount && (
        <div className="flex items-center justify-between p-3 bg-primary/5 border border-primary/20 rounded-lg">
          <div>
            <div className="text-sm font-medium text-text-primary">
              Selected: {selectedAccount.name}
            </div>
            <div className="text-xs text-text-secondary">
              Will send email variables to account custom fields
            </div>
          </div>
          <button
            onClick={handleSend}
            disabled={sending}
            className="px-4 py-2 text-sm font-medium bg-primary hover:bg-primary-hover text-white rounded-lg transition-colors disabled:opacity-50"
          >
            {sending ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Sending...
              </span>
            ) : (
              "Send to Apollo"
            )}
          </button>
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
          <div className="flex items-start gap-2">
            <svg className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div className="text-sm text-red-800">{error}</div>
          </div>
        </div>
      )}
    </div>
  );
}
