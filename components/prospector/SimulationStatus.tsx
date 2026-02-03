"use client";

import React from "react";

export type StepState = "pending" | "active" | "done" | "error";

export interface SimulationStep {
  id: string;
  label: string;
  state: StepState;
  message?: string;
}

interface SimulationStatusProps {
  prNumber: number;
  prTitle: string;
  repo: string;
  steps: SimulationStep[];
  errorMessage?: string | null;
  onRetry?: () => void;
  onSkip?: () => void;
}

function StepIcon({ state }: { state: StepState }) {
  switch (state) {
    case "done":
      return (
        <span className="flex items-center justify-center w-5 h-5 rounded-full bg-green-500 text-white shrink-0">
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </span>
      );
    case "active":
      return (
        <span className="flex items-center justify-center w-5 h-5 shrink-0">
          <svg className="animate-spin h-5 w-5 text-primary" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </span>
      );
    case "error":
      return (
        <span className="flex items-center justify-center w-5 h-5 rounded-full bg-red-500 text-white shrink-0">
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </span>
      );
    default:
      return (
        <span className="flex items-center justify-center w-5 h-5 rounded-full bg-gray-200 shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
        </span>
      );
  }
}

export function SimulationStatus({
  prNumber,
  prTitle,
  repo,
  steps,
  errorMessage,
  onRetry,
  onSkip,
}: SimulationStatusProps) {
  const doneCount = steps.filter((s) => s.state === "done").length;
  const progress = Math.round((doneCount / steps.length) * 100);

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <div className="px-4 py-3 bg-blue-50 border-b border-blue-200">
        <p className="text-sm font-semibold text-accent">
          Simulating PR #{prNumber}
        </p>
        <p className="text-xs text-text-secondary mt-0.5 truncate">{prTitle}</p>
        <p className="text-xs text-text-muted">{repo}</p>
      </div>

      <div className="px-4 py-3 space-y-2">
        {steps.map((step) => (
          <div key={step.id} className="flex items-center gap-2.5">
            <StepIcon state={step.state} />
            <span
              className={`text-sm ${
                step.state === "done"
                  ? "text-green-700"
                  : step.state === "active"
                  ? "text-primary font-medium"
                  : step.state === "error"
                  ? "text-red-600"
                  : "text-text-muted"
              }`}
            >
              {step.label}
              {step.message && (
                <span className="ml-1 text-xs font-normal text-text-muted">
                  {step.message}
                </span>
              )}
            </span>
          </div>
        ))}
      </div>

      {/* Progress bar */}
      <div className="px-4 pb-3">
        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Error actions */}
      {errorMessage && (
        <div className="px-4 py-3 border-t border-red-200 bg-red-50">
          <p className="text-sm text-red-700 mb-2">{errorMessage}</p>
          <div className="flex items-center gap-2">
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="px-3 py-1.5 text-xs font-medium text-white bg-primary hover:bg-primary-hover rounded-md transition-colors"
              >
                Try Again
              </button>
            )}
            {onSkip && (
              <button
                type="button"
                onClick={onSkip}
                className="px-3 py-1.5 text-xs font-medium text-text-secondary border border-border rounded-md hover:bg-gray-50 transition-colors"
              >
                Skip This PR
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
