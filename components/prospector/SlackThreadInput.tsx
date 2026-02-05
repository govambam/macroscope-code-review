"use client";

import React, { useState } from "react";
import type { ParsedSignupData, ParseSlackThreadResponse } from "@/lib/types/signup-lead";

interface SlackThreadInputProps {
  onParsed: (data: ParsedSignupData, rawThread: string) => void;
  initialThread?: string;
}

export function SlackThreadInput({ onParsed, initialThread }: SlackThreadInputProps) {
  const [rawThread, setRawThread] = useState(initialThread || "");
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleParse() {
    if (!rawThread.trim()) {
      setError("Please paste the Slack thread content");
      return;
    }

    setParsing(true);
    setError(null);

    try {
      const res = await fetch("/api/parse-slack-thread", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawThread }),
      });

      const data: ParseSlackThreadResponse = await res.json();

      if (data.success && data.data) {
        onParsed(data.data, rawThread);
      } else {
        setError(data.error || "Failed to parse thread");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to parse thread");
    } finally {
      setParsing(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between mb-2">
          <label htmlFor="slack-thread" className="block text-sm font-medium text-accent">
            Paste Slack Thread
          </label>
          <span className="text-xs text-text-muted">
            Copy the entire thread from Slack
          </span>
        </div>
        <textarea
          id="slack-thread"
          value={rawThread}
          onChange={(e) => {
            setRawThread(e.target.value);
            if (error) setError(null);
          }}
          placeholder={`Paste the Slack signup notification thread here...

Example:
customers APP Today at 2:35 AM
New installation from username (12345).
• repo-name | TypeScript | 123456
...`}
          className={`w-full h-64 px-3 py-2 text-sm font-mono bg-white border rounded-lg focus:ring-2 focus:ring-primary focus:border-primary resize-y ${
            error ? "border-red-400" : "border-border"
          }`}
        />
        {error && <p className="mt-1.5 text-sm text-red-600">{error}</p>}
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
        <div className="flex items-start gap-2">
          <svg className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div className="text-sm text-blue-800">
            <p className="font-medium">How to copy the thread:</p>
            <ol className="mt-1 text-blue-700 space-y-0.5 list-decimal list-inside">
              <li>Open the Slack thread with the new signup notification</li>
              <li>Select all messages in the thread (Cmd/Ctrl + A)</li>
              <li>Copy (Cmd/Ctrl + C) and paste here</li>
            </ol>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs text-text-muted">
          {rawThread.length > 0 ? `${rawThread.length} characters` : "Waiting for content..."}
        </p>
        <button
          type="button"
          onClick={handleParse}
          disabled={parsing || rawThread.trim().length < 50}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary hover:bg-primary-hover disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
        >
          {parsing ? (
            <>
              <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Parsing...
            </>
          ) : (
            <>
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              Parse Thread
            </>
          )}
        </button>
      </div>
    </div>
  );
}
