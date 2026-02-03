"use client";

import { useState, useEffect, useCallback } from "react";

interface QueueStatusData {
  queued: number;
  processing: number;
  completed: number;
  failed: number;
  canProcessNow: boolean;
  waitSeconds: number;
  lastProcessedAt: string | null;
}

interface PendingOperation {
  id: number;
  operation_type: string;
  payload: {
    prUrl?: string;
    sourceOwner?: string;
    sourceRepo?: string;
  };
  status: string;
  created_at: string;
}

export function QueueStatus() {
  const [status, setStatus] = useState<QueueStatusData | null>(null);
  const [pending, setPending] = useState<PendingOperation[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/queue/process");
      if (!response.ok) throw new Error("Failed to fetch queue status");
      const data = await response.json();
      setStatus(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch status");
    }
  }, []);

  const fetchPending = useCallback(async () => {
    try {
      const response = await fetch("/api/queue");
      if (!response.ok) throw new Error("Failed to fetch pending operations");
      const data = await response.json();
      setPending(data.pending || []);
    } catch (err) {
      console.error("Failed to fetch pending:", err);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchStatus();
    fetchPending();
  }, [fetchStatus, fetchPending]);

  // Poll for updates when there are pending operations
  useEffect(() => {
    if (!status || (status.queued === 0 && status.processing === 0)) {
      return;
    }

    const interval = setInterval(() => {
      fetchStatus();
      fetchPending();
    }, 5000); // Poll every 5 seconds

    return () => clearInterval(interval);
  }, [status, fetchStatus, fetchPending]);

  const handleProcessNext = async () => {
    if (isProcessing) return;

    setIsProcessing(true);
    try {
      const response = await fetch("/api/queue/process", {
        method: "POST",
      });
      const data = await response.json();

      if (data.processed) {
        // Refresh status after processing
        await fetchStatus();
        await fetchPending();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to process");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCancelOperation = async (id: number) => {
    try {
      const response = await fetch(`/api/queue?id=${id}`, {
        method: "DELETE",
      });
      if (response.ok) {
        await fetchStatus();
        await fetchPending();
      }
    } catch (err) {
      console.error("Failed to cancel:", err);
    }
  };

  // Don't render if no queue activity
  if (!status || (status.queued === 0 && status.processing === 0)) {
    return null;
  }

  const totalPending = status.queued + status.processing;

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-lg overflow-hidden">
      {/* Header - always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-amber-100 transition-colors"
      >
        <div className="flex items-center gap-3">
          {status.processing > 0 ? (
            <svg className="animate-spin h-5 w-5 text-amber-600" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          ) : (
            <svg className="h-5 w-5 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          )}
          <span className="font-medium text-amber-800">
            {totalPending} PR{totalPending !== 1 ? "s" : ""} in queue
          </span>
          {status.processing > 0 && (
            <span className="text-sm text-amber-600">
              ({status.processing} processing)
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!status.canProcessNow && status.waitSeconds > 0 && (
            <span className="text-xs text-amber-600">
              Next in {status.waitSeconds}s
            </span>
          )}
          <svg
            className={`w-5 h-5 text-amber-600 transition-transform ${expanded ? "rotate-180" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="px-4 pb-4 border-t border-amber-200 pt-3">
          {error && (
            <div className="text-sm text-red-600 mb-3">{error}</div>
          )}

          {/* Pending operations list */}
          {pending.length > 0 && (
            <div className="space-y-2 mb-4">
              {pending.map((op, index) => (
                <div
                  key={op.id}
                  className="flex items-center justify-between bg-white rounded px-3 py-2 text-sm"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-gray-500">#{index + 1}</span>
                    {op.status === "processing" ? (
                      <svg className="animate-spin h-4 w-4 text-amber-500" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                    ) : (
                      <svg className="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    )}
                    <span className="text-gray-700">
                      {op.operation_type === "simulate_pr" && op.payload.prUrl ? (
                        <>
                          {op.payload.prUrl.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/)?.[1] || "Unknown"} #
                          {op.payload.prUrl.match(/pull\/(\d+)/)?.[1] || "?"}
                        </>
                      ) : (
                        op.operation_type
                      )}
                    </span>
                    <span className={`text-xs px-1.5 py-0.5 rounded ${
                      op.status === "processing"
                        ? "bg-amber-100 text-amber-700"
                        : "bg-gray-100 text-gray-600"
                    }`}>
                      {op.status}
                    </span>
                  </div>
                  {op.status === "queued" && (
                    <button
                      onClick={() => handleCancelOperation(op.id)}
                      className="text-xs text-red-600 hover:text-red-700"
                    >
                      Cancel
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Process button */}
          <div className="flex items-center justify-between">
            <p className="text-xs text-amber-700">
              Operations are processed with 60-second delays to avoid GitHub rate limits.
            </p>
            {status.canProcessNow && status.queued > 0 && (
              <button
                onClick={handleProcessNext}
                disabled={isProcessing}
                className="px-3 py-1.5 bg-amber-600 text-white text-sm font-medium rounded hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isProcessing ? "Processing..." : "Process Next"}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
