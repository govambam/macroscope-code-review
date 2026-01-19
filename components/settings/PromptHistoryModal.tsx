"use client";

import { useState } from "react";
import { Modal } from "../Modal";
import { usePromptVersions, useRevertPrompt, PromptVersion } from "@/lib/hooks/use-settings";
import { useUser } from "@/lib/contexts/UserContext";

interface PromptHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  promptType: "pr-analysis" | "email-generation";
  title: string;
  onReverted?: () => void;
}

export function PromptHistoryModal({
  isOpen,
  onClose,
  promptType,
  title,
  onReverted,
}: PromptHistoryModalProps) {
  const { data: versions = [], isLoading } = usePromptVersions(promptType);
  const revertMutation = useRevertPrompt();
  const { currentUser } = useUser();

  const [viewingVersion, setViewingVersion] = useState<PromptVersion | null>(null);
  const [confirmRevert, setConfirmRevert] = useState<PromptVersion | null>(null);
  const [notification, setNotification] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const showNotification = (type: "success" | "error", message: string) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 3000);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const handleRevert = async (version: PromptVersion) => {
    try {
      await revertMutation.mutateAsync({
        type: promptType,
        versionId: version.id,
        userId: currentUser?.id ? parseInt(currentUser.id) : undefined,
      });
      showNotification("success", `Reverted to version ${getVersionNumber(version)}`);
      setConfirmRevert(null);
      onReverted?.();
    } catch (error) {
      showNotification("error", error instanceof Error ? error.message : "Failed to revert");
    }
  };

  const getVersionNumber = (version: PromptVersion): number => {
    const index = versions.findIndex((v) => v.id === version.id);
    return versions.length - index;
  };

  const isCurrentVersion = (version: PromptVersion): boolean => {
    return versions.length > 0 && versions[0].id === version.id;
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`${title} - Version History`} size="xl">
      {/* Notification */}
      {notification && (
        <div
          className={`mb-4 p-3 rounded-lg text-sm ${
            notification.type === "success"
              ? "bg-success-light border border-success/20 text-success"
              : "bg-error-light border border-error/20 text-error"
          }`}
        >
          {notification.message}
        </div>
      )}

      {isLoading ? (
        <div className="text-center py-12">
          <svg className="animate-spin h-8 w-8 mx-auto text-primary" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <p className="mt-4 text-sm text-text-muted">Loading version history...</p>
        </div>
      ) : versions.length === 0 ? (
        <div className="text-center py-12 text-text-muted">
          <p>No version history available.</p>
        </div>
      ) : viewingVersion ? (
        // View specific version
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <button
              onClick={() => setViewingVersion(null)}
              className="flex items-center gap-2 text-sm text-text-secondary hover:text-primary transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
              Back to history
            </button>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-accent">
                Version {getVersionNumber(viewingVersion)}
              </span>
              {isCurrentVersion(viewingVersion) && (
                <span className="px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700 rounded">
                  Current
                </span>
              )}
            </div>
          </div>

          <div className="text-sm text-text-secondary">
            <p>
              <span className="font-medium">Edited by:</span>{" "}
              {viewingVersion.edited_by_user_name || "Unknown"}
            </p>
            <p>
              <span className="font-medium">Date:</span> {formatDate(viewingVersion.created_at)}
            </p>
          </div>

          <pre className="w-full h-[400px] px-4 py-3 bg-bg-subtle border border-border rounded-lg text-sm font-mono overflow-auto whitespace-pre-wrap">
            {viewingVersion.content}
          </pre>

          {!isCurrentVersion(viewingVersion) && (
            <div className="flex justify-end pt-4 border-t border-border">
              <button
                onClick={() => setConfirmRevert(viewingVersion)}
                disabled={revertMutation.isPending}
                className="px-4 py-2 bg-primary hover:bg-primary-hover text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
              >
                Use This Version
              </button>
            </div>
          )}
        </div>
      ) : (
        // Version list
        <div className="space-y-3 max-h-[500px] overflow-y-auto pr-2">
          {versions.map((version, index) => {
            const versionNumber = versions.length - index;
            const isCurrent = index === 0;

            return (
              <div
                key={version.id}
                className={`p-4 border rounded-lg transition-colors ${
                  isCurrent
                    ? "border-primary/30 bg-primary/5"
                    : "border-border hover:border-primary/30"
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-accent">Version {versionNumber}</span>
                      {isCurrent && (
                        <span className="px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700 rounded">
                          Current
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-text-secondary mt-1">
                      <span className="font-medium">Edited by:</span>{" "}
                      {version.edited_by_user_name || "Unknown"}
                    </p>
                    <p className="text-xs text-text-muted mt-0.5">
                      {formatDate(version.created_at)}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 ml-4">
                    <button
                      onClick={() => setViewingVersion(version)}
                      className="px-3 py-1.5 text-xs font-medium text-text-secondary hover:text-primary border border-border hover:border-primary rounded transition-colors"
                    >
                      View
                    </button>
                    {!isCurrent && (
                      <button
                        onClick={() => setConfirmRevert(version)}
                        disabled={revertMutation.isPending}
                        className="px-3 py-1.5 text-xs font-medium text-white bg-primary hover:bg-primary-hover rounded transition-colors disabled:opacity-50"
                      >
                        Use This Version
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Footer */}
      <div className="mt-6 pt-4 border-t border-border">
        <button
          onClick={onClose}
          className="px-4 py-2 text-sm font-medium text-text-secondary hover:text-accent transition-colors"
        >
          Close
        </button>
      </div>

      {/* Confirm Revert Dialog */}
      {confirmRevert && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-[60]">
          <div className="bg-white rounded-xl shadow-lg max-w-md w-full p-6">
            <h3 className="text-lg font-semibold text-accent mb-2">Confirm Revert</h3>
            <p className="text-sm text-text-secondary mb-4">
              Are you sure you want to revert to{" "}
              <span className="font-medium">
                Version {getVersionNumber(confirmRevert)}
              </span>
              ? This will create a new version with that content.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setConfirmRevert(null)}
                disabled={revertMutation.isPending}
                className="px-4 py-2 text-sm font-medium text-text-secondary hover:text-accent transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleRevert(confirmRevert)}
                disabled={revertMutation.isPending}
                className="px-4 py-2 bg-primary hover:bg-primary-hover text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {revertMutation.isPending && (
                  <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                )}
                Revert
              </button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
