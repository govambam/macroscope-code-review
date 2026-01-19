"use client";

import { useState, useEffect } from "react";
import { Modal } from "../Modal";
import { usePrompts, useUpdatePrompt, useRevertPrompt, VersionInfo } from "@/lib/hooks/use-settings";
import { useUser } from "@/lib/contexts/UserContext";
import { PromptHistoryModal } from "./PromptHistoryModal";
import { AI_MODELS, getModelDisplayName } from "@/lib/config/models";

interface PromptEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  content: string;
  model: string;
  versionInfo?: VersionInfo;
  onSave: (content: string, model: string) => Promise<void>;
  isLoading?: boolean;
}

function PromptEditorModal({ isOpen, onClose, title, content, model, versionInfo, onSave, isLoading }: PromptEditorModalProps) {
  const [editedContent, setEditedContent] = useState(content);
  const [selectedModel, setSelectedModel] = useState(model);
  const [error, setError] = useState<string | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setEditedContent(content);
      setSelectedModel(model);
      setError(null);
      setHasUnsavedChanges(false);
    }
  }, [isOpen, content, model]);

  const handleContentChange = (newContent: string) => {
    setEditedContent(newContent);
    setHasUnsavedChanges(newContent !== content || selectedModel !== model);
    setError(null);
  };

  const handleModelChange = (newModel: string) => {
    setSelectedModel(newModel);
    setHasUnsavedChanges(editedContent !== content || newModel !== model);
  };

  const handleSave = async () => {
    if (!editedContent.trim()) {
      setError("Prompt content cannot be empty");
      return;
    }

    try {
      await onSave(editedContent, selectedModel);
      setHasUnsavedChanges(false);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save prompt");
    }
  };

  const handleClose = () => {
    if (hasUnsavedChanges) {
      setShowDiscardConfirm(true);
    } else {
      onClose();
    }
  };

  const handleDiscardConfirm = () => {
    setShowDiscardConfirm(false);
    setHasUnsavedChanges(false);
    onClose();
  };

  const lineCount = editedContent.split("\n").length;
  const charCount = editedContent.length;

  return (
    <>
      <Modal isOpen={isOpen} onClose={handleClose} title={title} size="xl">
        <div className="space-y-4">
          {/* Version info header */}
          {versionInfo && versionInfo.currentVersion > 0 && (
            <div className="text-sm text-text-secondary bg-bg-subtle rounded-lg p-3">
              <span className="font-medium">Version {versionInfo.currentVersion}</span>
              {versionInfo.lastEditedBy && (
                <span className="ml-2">
                  • Last edited by {versionInfo.lastEditedBy}
                </span>
              )}
            </div>
          )}

          {/* Model Selection */}
          <div className="bg-bg-subtle rounded-lg p-4">
            <label className="block text-sm font-medium text-accent mb-2">
              AI Model
            </label>
            <select
              value={selectedModel}
              onChange={(e) => handleModelChange(e.target.value)}
              disabled={isLoading}
              className="w-full px-3 py-2 bg-white border border-border rounded-lg text-sm text-black focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors"
            >
              {AI_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName} - {m.description}
                </option>
              ))}
            </select>
            <p className="mt-2 text-xs text-text-muted">
              This model will be used for new analyses/emails. Existing results will keep their original model.
            </p>
          </div>

          <div className="relative">
            <textarea
              value={editedContent}
              onChange={(e) => handleContentChange(e.target.value)}
              className="w-full h-[500px] px-4 py-3 bg-white border border-border rounded-lg text-black font-mono text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors resize-none"
              placeholder="Enter prompt content..."
              disabled={isLoading}
            />
          </div>

          <div className="flex items-center justify-between text-xs text-text-muted">
            <div className="flex items-center gap-3">
              <span>{lineCount} lines, {charCount} characters</span>
              {hasUnsavedChanges && (
                <span className="text-warning font-medium">• Unsaved changes</span>
              )}
            </div>
            <div className="flex items-center gap-1">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Supports Markdown formatting
            </div>
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-error-light border border-error/20 text-sm text-error">
              {error}
            </div>
          )}

          <div className="flex gap-3 justify-end pt-4 border-t border-border">
            <button
              type="button"
              onClick={handleClose}
              disabled={isLoading}
              className="px-4 py-2 text-sm font-medium text-text-secondary hover:text-accent transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isLoading || !editedContent.trim() || !hasUnsavedChanges}
              className="px-4 py-2 bg-primary hover:bg-primary-hover text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isLoading && (
                <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              )}
              Save Changes
            </button>
          </div>
        </div>
      </Modal>

      {/* Discard Confirmation */}
      {showDiscardConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-[60]">
          <div className="bg-white rounded-xl shadow-lg max-w-md w-full p-6">
            <h3 className="text-lg font-semibold text-accent mb-2">Discard Changes?</h3>
            <p className="text-sm text-text-secondary mb-4">
              You have unsaved changes. Are you sure you want to discard them?
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowDiscardConfirm(false)}
                className="px-4 py-2 text-sm font-medium text-text-secondary hover:text-accent transition-colors"
              >
                Keep Editing
              </button>
              <button
                onClick={handleDiscardConfirm}
                className="px-4 py-2 bg-error hover:bg-error/90 text-white text-sm font-medium rounded-lg transition-colors"
              >
                Discard
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

interface PromptViewModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  content: string;
}

function PromptViewModal({ isOpen, onClose, title, content }: PromptViewModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="xl">
      <div className="space-y-4">
        <pre className="w-full h-[500px] px-4 py-3 bg-bg-subtle border border-border rounded-lg text-sm font-mono overflow-auto whitespace-pre-wrap">
          {content}
        </pre>
        <div className="flex justify-end pt-4 border-t border-border">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-text-secondary hover:text-accent transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
}

interface PromptCardProps {
  title: string;
  description: string;
  versionInfo?: VersionInfo;
  onView: () => void;
  onEdit: () => void;
  onHistory: () => void;
  onRevertToDefault: () => void;
  isReverting?: boolean;
}

function formatVersionDate(dateString: string | null): string {
  if (!dateString) return "";
  return new Date(dateString).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function PromptCard({
  title,
  description,
  versionInfo,
  onView,
  onEdit,
  onHistory,
  onRevertToDefault,
  isReverting,
}: PromptCardProps) {
  const hasVersions = versionInfo && versionInfo.currentVersion > 0;
  const canRevertToDefault = hasVersions && !versionInfo.isDefault;
  const modelDisplayName = versionInfo?.model ? getModelDisplayName(versionInfo.model) : "Default";

  return (
    <div className="p-4 border border-border rounded-lg hover:border-primary/30 transition-colors">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-medium text-accent">{title}</h3>
            {hasVersions && (
              <span className="text-xs text-text-muted">
                (Version {versionInfo.currentVersion} of {versionInfo.totalVersions})
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-text-secondary">{description}</p>
          <p className="mt-2 text-xs text-text-muted">
            Model: <span className="font-medium">{modelDisplayName}</span>
          </p>

          {/* Version info */}
          {hasVersions && (
            <div className="mt-2 text-xs">
              {versionInfo.isDefault ? (
                <span className="text-purple-600 font-medium">Using default version</span>
              ) : versionInfo.lastEditedBy ? (
                <span className="text-text-secondary">
                  Last edited by{" "}
                  <span className="font-medium text-accent">{versionInfo.lastEditedBy}</span>
                  {versionInfo.lastEditedAt && (
                    <span> on {formatVersionDate(versionInfo.lastEditedAt)}</span>
                  )}
                </span>
              ) : null}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 ml-4 flex-wrap justify-end">
          <button
            onClick={onView}
            className="px-3 py-1.5 text-xs font-medium text-text-secondary hover:text-primary border border-border hover:border-primary rounded transition-colors"
          >
            View
          </button>
          {hasVersions && (
            <button
              onClick={onHistory}
              className="px-3 py-1.5 text-xs font-medium text-text-secondary hover:text-primary border border-border hover:border-primary rounded transition-colors"
            >
              History
            </button>
          )}
          <button
            onClick={onEdit}
            className="px-3 py-1.5 text-xs font-medium text-white bg-primary hover:bg-primary-hover rounded transition-colors"
          >
            Edit
          </button>
          {canRevertToDefault && (
            <button
              onClick={onRevertToDefault}
              disabled={isReverting}
              className="px-3 py-1.5 text-xs font-medium text-purple-700 hover:text-purple-800 border border-purple-200 hover:border-purple-300 bg-purple-50 hover:bg-purple-100 rounded transition-colors disabled:opacity-50"
            >
              {isReverting ? "Reverting..." : "Revert to Default"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function PromptManagementSection() {
  const { data: promptsData, isLoading: promptsLoading, refetch } = usePrompts();
  const updatePromptMutation = useUpdatePrompt();
  const revertMutation = useRevertPrompt();
  const { currentUser } = useUser();

  const [viewModal, setViewModal] = useState<{ type: "pr-analysis" | "email-generation"; open: boolean }>({
    type: "pr-analysis",
    open: false,
  });
  const [editModal, setEditModal] = useState<{ type: "pr-analysis" | "email-generation"; open: boolean }>({
    type: "pr-analysis",
    open: false,
  });
  const [historyModal, setHistoryModal] = useState<{ type: "pr-analysis" | "email-generation"; open: boolean }>({
    type: "pr-analysis",
    open: false,
  });
  const [revertConfirm, setRevertConfirm] = useState<"pr-analysis" | "email-generation" | null>(null);
  const [notification, setNotification] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const showNotification = (type: "success" | "error", message: string) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 3000);
  };

  const handleSavePrompt = async (content: string, model: string) => {
    try {
      await updatePromptMutation.mutateAsync({
        type: editModal.type,
        content,
        userId: currentUser?.id ? parseInt(currentUser.id) : undefined,
        model,
      });
      showNotification("success", "Prompt saved successfully");
    } catch (error) {
      showNotification("error", error instanceof Error ? error.message : "Failed to save prompt");
      throw error;
    }
  };

  const handleRevertToDefault = async (type: "pr-analysis" | "email-generation") => {
    try {
      await revertMutation.mutateAsync({
        type,
        // No versionId means revert to default
        userId: currentUser?.id ? parseInt(currentUser.id) : undefined,
      });
      showNotification("success", "Reverted to default prompt");
      setRevertConfirm(null);
    } catch (error) {
      showNotification("error", error instanceof Error ? error.message : "Failed to revert");
    }
  };

  const getPromptContent = (type: "pr-analysis" | "email-generation"): string => {
    if (!promptsData?.prompts) return "";
    return type === "pr-analysis" ? promptsData.prompts.prAnalysis : promptsData.prompts.emailGeneration;
  };

  const getVersionInfo = (type: "pr-analysis" | "email-generation"): VersionInfo | undefined => {
    if (!promptsData?.versions) return undefined;
    return type === "pr-analysis" ? promptsData.versions.prAnalysis : promptsData.versions.emailGeneration;
  };

  const getModel = (type: "pr-analysis" | "email-generation"): string => {
    const versionInfo = getVersionInfo(type);
    return versionInfo?.model || "claude-sonnet-4-20250514";
  };

  if (promptsLoading) {
    return (
      <div className="bg-white border border-border rounded-xl shadow-sm p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-bg-subtle rounded w-1/4"></div>
          <div className="h-20 bg-bg-subtle rounded"></div>
          <div className="h-20 bg-bg-subtle rounded"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white border border-border rounded-xl shadow-sm p-6">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-accent flex items-center gap-2">
          <span>Prompt Management</span>
        </h2>
        <p className="mt-1 text-sm text-text-secondary">
          Customize the prompts used for PR analysis and email generation. All changes are versioned.
        </p>
      </div>

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

      <div className="space-y-4">
        <PromptCard
          title="PR Analysis Prompt"
          description="Used to analyze PRs for meaningful bugs"
          versionInfo={getVersionInfo("pr-analysis")}
          onView={() => setViewModal({ type: "pr-analysis", open: true })}
          onEdit={() => setEditModal({ type: "pr-analysis", open: true })}
          onHistory={() => setHistoryModal({ type: "pr-analysis", open: true })}
          onRevertToDefault={() => setRevertConfirm("pr-analysis")}
          isReverting={revertMutation.isPending && revertConfirm === "pr-analysis"}
        />

        <PromptCard
          title="Email Generation Prompt"
          description="Used to generate outreach emails"
          versionInfo={getVersionInfo("email-generation")}
          onView={() => setViewModal({ type: "email-generation", open: true })}
          onEdit={() => setEditModal({ type: "email-generation", open: true })}
          onHistory={() => setHistoryModal({ type: "email-generation", open: true })}
          onRevertToDefault={() => setRevertConfirm("email-generation")}
          isReverting={revertMutation.isPending && revertConfirm === "email-generation"}
        />
      </div>

      {/* View Modal */}
      <PromptViewModal
        isOpen={viewModal.open}
        onClose={() => setViewModal((prev) => ({ ...prev, open: false }))}
        title={viewModal.type === "pr-analysis" ? "PR Analysis Prompt" : "Email Generation Prompt"}
        content={getPromptContent(viewModal.type)}
      />

      {/* Edit Modal */}
      <PromptEditorModal
        isOpen={editModal.open}
        onClose={() => setEditModal((prev) => ({ ...prev, open: false }))}
        title={`Edit ${editModal.type === "pr-analysis" ? "PR Analysis" : "Email Generation"} Prompt`}
        content={getPromptContent(editModal.type)}
        model={getModel(editModal.type)}
        versionInfo={getVersionInfo(editModal.type)}
        onSave={handleSavePrompt}
        isLoading={updatePromptMutation.isPending}
      />

      {/* History Modal */}
      <PromptHistoryModal
        isOpen={historyModal.open}
        onClose={() => setHistoryModal((prev) => ({ ...prev, open: false }))}
        promptType={historyModal.type}
        title={historyModal.type === "pr-analysis" ? "PR Analysis Prompt" : "Email Generation Prompt"}
        onReverted={() => refetch()}
      />

      {/* Revert to Default Confirmation */}
      {revertConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-lg max-w-md w-full p-6">
            <h3 className="text-lg font-semibold text-accent mb-2">Revert to Default?</h3>
            <p className="text-sm text-text-secondary mb-4">
              Are you sure you want to revert to the original default prompt? This will create a new version with the default content.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setRevertConfirm(null)}
                disabled={revertMutation.isPending}
                className="px-4 py-2 text-sm font-medium text-text-secondary hover:text-accent transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleRevertToDefault(revertConfirm)}
                disabled={revertMutation.isPending}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {revertMutation.isPending && (
                  <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                )}
                Revert to Default
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
