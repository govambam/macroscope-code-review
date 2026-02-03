"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import type { EmailSequence } from "@/lib/types/prospector-analysis";

interface AttioSectionProps {
  emailSequence: EmailSequence;
  defaultSearchQuery: string;
  currentAnalysisId: number | null;
  onSendComplete: () => void;
}

export function AttioSection({
  emailSequence,
  defaultSearchQuery,
  currentAnalysisId,
  onSendComplete,
}: AttioSectionProps) {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState(defaultSearchQuery);
  const [searchResults, setSearchResults] = useState<Array<{ id: string; name: string; domain: string | null }>>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<{ id: string; name: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [sendSuccess, setSendSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSearch() {
    if (!searchQuery.trim()) return;
    setSearchLoading(true);
    setError(null);
    setSelectedRecord(null);

    try {
      const res = await fetch("/api/attio/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: searchQuery.trim() }),
      });

      const data = await res.json();

      if (data.success && data.records) {
        setSearchResults(data.records);
        if (data.records.length === 0) {
          setError("No companies found matching that name.");
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
    if (!selectedRecord || !emailSequence) return;
    setSending(true);
    setError(null);

    try {
      const res = await fetch("/api/attio/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recordId: selectedRecord.id,
          emailSequence,
        }),
      });

      const data = await res.json();

      if (data.success) {
        setSendSuccess(true);
        onSendComplete();
      } else {
        setError(data.error || "Failed to send to Attio");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send to Attio");
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
                Email sequence sent to Attio successfully!
              </p>
              {selectedRecord && (
                <p className="text-sm text-green-700 mt-1">
                  Sent to: {selectedRecord.name}
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="border border-border rounded-lg p-5">
          <h3 className="text-sm font-semibold text-accent mb-3">Prospecting session complete!</h3>
          <p className="text-sm text-text-secondary mb-4">What&apos;s next?</p>
          <ul className="text-sm text-text-secondary space-y-1.5 mb-5">
            <li>&bull; View this company in Attio to start your outreach</li>
            <li>&bull; Simulate more PRs for this company</li>
            <li>&bull; Start a new prospecting session</li>
          </ul>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => {
                // Reload page to reset workflow
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
        <h3 className="text-sm font-medium text-accent mb-1">Send to Attio</h3>
        <p className="text-xs text-text-secondary mb-4">
          Search for a company in Attio and send all 4 emails to their custom attributes.
        </p>
      </div>

      {/* Search input */}
      <div className="flex gap-2">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          placeholder="Search company name..."
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
          {searchResults.map((record) => (
            <button
              key={record.id}
              onClick={() => setSelectedRecord({ id: record.id, name: record.name })}
              className={`w-full px-3 py-2 text-left text-sm hover:bg-bg-subtle transition-colors ${
                selectedRecord?.id === record.id ? "bg-primary/5 border-l-2 border-l-primary" : ""
              }`}
            >
              <div className="font-medium text-text-primary">{record.name}</div>
              {record.domain && (
                <div className="text-xs text-text-secondary">{record.domain}</div>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Selected record & send button */}
      {selectedRecord && (
        <div className="flex items-center justify-between p-3 bg-primary/5 border border-primary/20 rounded-lg">
          <div>
            <div className="text-sm font-medium text-text-primary">
              Selected: {selectedRecord.name}
            </div>
            <div className="text-xs text-text-secondary">
              Will send all 4 emails to company custom attributes
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
              "Send to Attio"
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
