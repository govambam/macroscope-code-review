"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { SimulationStatus, type SimulationStep } from "./SimulationStatus";
import type { SelectedPR } from "@/app/prospector/[sessionId]/WorkflowContext";

const RATE_LIMIT_MS = 60_000; // 1 minute between simulations

export interface CompletedSimulation {
  pr: SelectedPR;
  success: boolean;
  forkedPrUrl?: string;
  prTitle?: string;
  error?: string;
}

interface SimulationQueueProps {
  selectedPRs: SelectedPR[];
  sessionId: string;
  onAllComplete: (completed: CompletedSimulation[]) => void;
}

function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function makeSimulationSteps(): SimulationStep[] {
  return [
    { id: "config", label: "Checking configuration", state: "pending" },
    { id: "fetch-pr", label: "Fetching PR details", state: "pending" },
    { id: "analyze", label: "Analyzing merge strategy", state: "pending" },
    { id: "fork", label: "Checking fork", state: "pending" },
    { id: "clone", label: "Cloning repository", state: "pending" },
    { id: "branches", label: "Creating branches", state: "pending" },
    { id: "apply", label: "Applying commits", state: "pending" },
    { id: "push", label: "Pushing & creating PR", state: "pending" },
  ];
}

// Map API step numbers (1-10) to our step IDs
function stepIndexFromApiStep(apiStep: number): number {
  if (apiStep <= 1) return 0; // config
  if (apiStep <= 2) return 1; // fetch-pr
  if (apiStep <= 4) return 2; // analyze (steps 3-4)
  if (apiStep <= 6) return 3; // fork (steps 5-6)
  if (apiStep <= 7) return 4; // clone
  if (apiStep <= 8) return 5; // branches
  if (apiStep <= 9) return 6; // apply
  return 7; // push (step 10)
}

export function SimulationQueue({
  selectedPRs,
  sessionId,
  onAllComplete,
}: SimulationQueueProps) {
  const [queue, setQueue] = useState<SelectedPR[]>(() => [...selectedPRs]);
  const [currentPR, setCurrentPR] = useState<SelectedPR | null>(null);
  const [steps, setSteps] = useState<SimulationStep[]>(makeSimulationSteps);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [completed, setCompleted] = useState<CompletedSimulation[]>([]);
  const [countdownMs, setCountdownMs] = useState(0);
  const [isWaiting, setIsWaiting] = useState(false);

  const lastEndTimeRef = useRef<number>(0);
  const abortRef = useRef<AbortController | null>(null);
  const hasStartedRef = useRef(false);

  // Start processing queue
  const processNext = useCallback(() => {
    setQueue((prev) => {
      if (prev.length === 0) return prev;
      const [next, ...rest] = prev;
      setCurrentPR(next);
      setSteps(makeSimulationSteps());
      setErrorMessage(null);
      return rest;
    });
  }, []);

  // Run simulation for a single PR
  const runSimulation = useCallback(
    async (pr: SelectedPR) => {
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch("/api/create-pr", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prUrl: pr.url }),
          signal: controller.signal,
        });

        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(data?.error || `HTTP ${res.status}`);
        }

        const reader = res.body?.getReader();
        if (!reader) throw new Error("No response stream");

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const event = JSON.parse(line.slice(6));

              if (event.eventType === "status") {
                const stepIdx = stepIndexFromApiStep(event.step);

                setSteps((prev) => {
                  const next = [...prev];
                  for (let i = 0; i < next.length; i++) {
                    if (i < stepIdx) {
                      next[i] = { ...next[i], state: "done" };
                    } else if (i === stepIdx) {
                      next[i] = {
                        ...next[i],
                        state: event.statusType === "error" ? "error" : "active",
                        message: event.message,
                      };
                    }
                    // leave future steps as pending
                  }
                  return next;
                });

                if (event.statusType === "error") {
                  setErrorMessage(event.message);
                }
              }

              if (event.eventType === "result") {
                if (event.success) {
                  // Mark all steps done
                  setSteps((prev) =>
                    prev.map((s) => ({ ...s, state: "done" as const }))
                  );
                  setCompleted((prev) => [
                    ...prev,
                    {
                      pr,
                      success: true,
                      forkedPrUrl: event.prUrl,
                      prTitle: event.prTitle,
                    },
                  ]);
                } else {
                  setErrorMessage(event.error || event.message || "Simulation failed");
                  setCompleted((prev) => [
                    ...prev,
                    {
                      pr,
                      success: false,
                      error: event.error || event.message,
                    },
                  ]);
                }
                lastEndTimeRef.current = Date.now();
              }
            } catch {
              // Ignore malformed SSE lines
            }
          }
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        const msg = err instanceof Error ? err.message : "Simulation failed";
        setErrorMessage(msg);
        setCompleted((prev) => [...prev, { pr, success: false, error: msg }]);
        lastEndTimeRef.current = Date.now();
      } finally {
        abortRef.current = null;
        setCurrentPR(null);
      }
    },
    []
  );

  // Countdown timer for rate limiting
  useEffect(() => {
    if (!isWaiting) return;
    const interval = setInterval(() => {
      const elapsed = Date.now() - lastEndTimeRef.current;
      const remaining = RATE_LIMIT_MS - elapsed;
      if (remaining <= 0) {
        setCountdownMs(0);
        setIsWaiting(false);
        clearInterval(interval);
      } else {
        setCountdownMs(remaining);
      }
    }, 200);
    return () => clearInterval(interval);
  }, [isWaiting]);

  // Orchestrator: start next simulation when conditions are met
  useEffect(() => {
    // Don't start if currently simulating or waiting
    if (currentPR || isWaiting) return;

    // Check if we need to start the first one
    if (!hasStartedRef.current && queue.length > 0) {
      hasStartedRef.current = true;
      const [next, ...rest] = queue;
      setQueue(rest);
      setCurrentPR(next);
      setSteps(makeSimulationSteps());
      setErrorMessage(null);
      return;
    }

    // Check if there are more in the queue after a completion
    if (queue.length > 0 && lastEndTimeRef.current > 0) {
      const elapsed = Date.now() - lastEndTimeRef.current;
      if (elapsed >= RATE_LIMIT_MS) {
        // Rate limit passed, start next
        processNext();
      } else {
        // Need to wait
        setIsWaiting(true);
        setCountdownMs(RATE_LIMIT_MS - elapsed);
      }
      return;
    }

    // All done
    if (queue.length === 0 && !currentPR && completed.length > 0 && completed.length === selectedPRs.length) {
      onAllComplete(completed);
    }
  }, [currentPR, isWaiting, queue, completed, selectedPRs.length, onAllComplete, processNext]);

  // When waiting ends, process next

  // Run simulation when currentPR changes
  useEffect(() => {
    if (currentPR) {
      runSimulation(currentPR);
    }
  }, [currentPR, runSimulation]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  function handleRetry() {
    if (!completed.length) return;
    const lastFailed = completed[completed.length - 1];
    if (!lastFailed || lastFailed.success) return;

    // Remove last failed from completed and re-simulate
    setCompleted((prev) => prev.slice(0, -1));
    setCurrentPR(lastFailed.pr);
    setSteps(makeSimulationSteps());
    setErrorMessage(null);
  }

  function handleSkip() {
    // Current PR failed, move on
    setCurrentPR(null);
    setErrorMessage(null);
    lastEndTimeRef.current = Date.now();
  }

  const totalPRs = selectedPRs.length;
  const completedCount = completed.length;
  const isSimulating = !!currentPR;

  return (
    <div className="space-y-4">
      {/* Overall progress header */}
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-accent">
          Simulation Progress: {completedCount} / {totalPRs} PR{totalPRs !== 1 ? "s" : ""}
        </p>
        {isWaiting && (
          <span className="text-xs text-text-muted">
            Next simulation in {formatCountdown(countdownMs)}
          </span>
        )}
      </div>

      {/* Currently simulating */}
      {currentPR && (
        <SimulationStatus
          prNumber={currentPR.prNumber}
          prTitle={currentPR.title || `PR #${currentPR.prNumber}`}
          repo={`${currentPR.owner}/${currentPR.repo}`}
          steps={steps}
          errorMessage={errorMessage}
          onRetry={errorMessage ? handleRetry : undefined}
          onSkip={errorMessage && queue.length > 0 ? handleSkip : undefined}
        />
      )}

      {/* Rate limit countdown (between simulations) */}
      {isWaiting && !currentPR && queue.length > 0 && (
        <div className="border border-border rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-full bg-blue-50">
              <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-accent">
                Waiting before next simulation
              </p>
              <p className="text-xs text-text-muted">
                Rate limit cooldown: <span className="font-mono font-medium text-primary">{formatCountdown(countdownMs)}</span> remaining
              </p>
            </div>
          </div>
          {/* Countdown progress bar */}
          <div className="mt-3 h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-primary/50 rounded-full transition-all duration-200"
              style={{ width: `${Math.max(0, 100 - (countdownMs / RATE_LIMIT_MS) * 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Queued PRs */}
      {queue.length > 0 && (
        <div className="border border-border rounded-lg overflow-hidden">
          <div className="px-4 py-2.5 bg-gray-50 border-b border-border">
            <p className="text-xs font-medium text-text-secondary">
              Queued ({queue.length} remaining)
            </p>
          </div>
          <div className="divide-y divide-border">
            {queue.map((pr, idx) => (
              <div key={pr.prNumber} className="px-4 py-2.5 flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs font-mono text-text-muted">#{pr.prNumber}</span>
                  <span className="text-sm text-text-secondary truncate">
                    {pr.title || `${pr.owner}/${pr.repo}`}
                  </span>
                </div>
                <span className="text-xs text-text-muted shrink-0">
                  {idx === 0 && isWaiting ? "Up next" : `#${idx + 1} in queue`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Completed simulations */}
      {completed.length > 0 && (
        <div className="border border-border rounded-lg overflow-hidden">
          <div className="px-4 py-2.5 bg-gray-50 border-b border-border">
            <p className="text-xs font-medium text-text-secondary">
              Completed ({completed.length})
            </p>
          </div>
          <div className="divide-y divide-border">
            {completed.map((sim) => (
              <div key={sim.pr.prNumber} className="px-4 py-2.5 flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  {sim.success ? (
                    <span className="flex items-center justify-center w-4 h-4 rounded-full bg-green-500 text-white shrink-0">
                      <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                  ) : (
                    <span className="flex items-center justify-center w-4 h-4 rounded-full bg-red-500 text-white shrink-0">
                      <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </span>
                  )}
                  <span className="text-xs font-mono text-text-muted">#{sim.pr.prNumber}</span>
                  <span className="text-sm text-text-secondary truncate">
                    {sim.prTitle || sim.pr.title || `${sim.pr.owner}/${sim.pr.repo}`}
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {sim.success && sim.forkedPrUrl && (
                    <a
                      href={sim.forkedPrUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-medium text-primary hover:text-primary-hover"
                    >
                      View PR
                    </a>
                  )}
                  {!sim.success && (
                    <span className="text-xs text-red-600">{sim.error || "Failed"}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
