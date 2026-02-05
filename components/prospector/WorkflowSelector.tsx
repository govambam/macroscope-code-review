"use client";

import type { ProspectorWorkflowType } from "@/lib/types/signup-lead";

interface WorkflowSelectorProps {
  selectedWorkflow: ProspectorWorkflowType | null;
  onSelectWorkflow: (workflow: ProspectorWorkflowType) => void;
}

export function WorkflowSelector({
  selectedWorkflow,
  onSelectWorkflow,
}: WorkflowSelectorProps) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-text-secondary">How would you like to reach out to this company?</p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* PR Analysis Option */}
        <button
          type="button"
          onClick={() => onSelectWorkflow("pr-analysis")}
          className={`relative p-5 border-2 rounded-xl text-left transition-all ${
            selectedWorkflow === "pr-analysis"
              ? "border-primary bg-primary/5 ring-2 ring-primary/20"
              : "border-border hover:border-primary/50 hover:bg-bg-subtle"
          }`}
        >
          {selectedWorkflow === "pr-analysis" && (
            <div className="absolute top-3 right-3">
              <svg className="h-5 w-5 text-primary" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
          )}
          <div className="flex items-center gap-3 mb-2">
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-amber-100 text-amber-600">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
            </div>
            <h3 className="text-base font-semibold text-accent">PR Analysis</h3>
          </div>
          <p className="text-sm text-text-secondary">
            Find and simulate a PR to discover bugs, then use findings to start a conversation.
          </p>
          <div className="mt-3 flex items-center gap-2 text-xs text-text-muted">
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Requires PR simulation
          </div>
        </button>

        {/* New Signup Option */}
        <button
          type="button"
          onClick={() => onSelectWorkflow("signup-outreach")}
          className={`relative p-5 border-2 rounded-xl text-left transition-all ${
            selectedWorkflow === "signup-outreach"
              ? "border-primary bg-primary/5 ring-2 ring-primary/20"
              : "border-border hover:border-primary/50 hover:bg-bg-subtle"
          }`}
        >
          {selectedWorkflow === "signup-outreach" && (
            <div className="absolute top-3 right-3">
              <svg className="h-5 w-5 text-primary" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
          )}
          <div className="flex items-center gap-3 mb-2">
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-green-100 text-green-600">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"
                />
              </svg>
            </div>
            <h3 className="text-base font-semibold text-accent">New Signup</h3>
          </div>
          <p className="text-sm text-text-secondary">
            Welcome a new user who just signed up. Paste the Slack notification thread to get started.
          </p>
          <div className="mt-3 flex items-center gap-2 text-xs text-text-muted">
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            Quick setup from Slack
          </div>
        </button>
      </div>
    </div>
  );
}
