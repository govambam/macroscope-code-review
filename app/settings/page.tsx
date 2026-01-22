"use client";

import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import { UserMenu } from "@/components/UserMenu";

interface Prompt {
  name: string;
  content: string;
  model: string | null;
  purpose: string | null;
  updatedAt: string;
}

interface PromptVersion {
  version_number: number;
  content: string;
  model: string | null;
  purpose: string | null;
  created_at: string;
}

export default function SettingsPage() {
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPrompt, setSelectedPrompt] = useState<Prompt | null>(null);
  const [editedContent, setEditedContent] = useState("");
  const [editedModel, setEditedModel] = useState("");
  const [editedPurpose, setEditedPurpose] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<{ success: boolean; message: string } | null>(null);

  // Version history state
  const [versions, setVersions] = useState<PromptVersion[]>([]);
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState<PromptVersion | null>(null);
  const [reverting, setReverting] = useState(false);
  const [showRevertConfirm, setShowRevertConfirm] = useState<number | null>(null);
const versionCache = useRef<Record<string, PromptVersion[]>>(Object.create(null));

  // Load prompts on mount
  useEffect(() => {
    loadPrompts();
  }, []);

  const loadPrompts = async (): Promise<Prompt[]> => {
    try {
      setLoading(true);
      const response = await fetch("/api/prompts");
      const data = await response.json();

      if (data.success) {
        setPrompts(data.prompts);
        return data.prompts;
      } else {
        setError(data.error || "Failed to load prompts");
        return [];
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load prompts");
      return [];
    } finally {
      setLoading(false);
    }
  };

  // Auto-select first prompt when prompts load
  useEffect(() => {
    if (prompts.length > 0 && !selectedPrompt) {
      selectPrompt(prompts[0]);
    }
  }, [prompts, selectedPrompt]);

  const selectPrompt = (prompt: Prompt) => {
    setSelectedPrompt(prompt);
    setEditedContent(prompt.content);
    setEditedModel(prompt.model || "");
    setEditedPurpose(prompt.purpose || "");
    setSaveResult(null);
    setSelectedVersion(null);
    setShowVersionHistory(false);
  };

  const fetchVersions = async (promptName: string, forceRefresh = false) => {
    if (!forceRefresh && versionCache.current[promptName]) {
      setVersions(versionCache.current[promptName]);
      setLoadingVersions(false);
      return;
    }

    setLoadingVersions(true);
    try {
      const response = await fetch(`/api/prompts/versions?name=${encodeURIComponent(promptName)}`);
      const data = await response.json();

      if (data.success) {
        versionCache.current[promptName] = data.versions;
        if (selectedPrompt?.name === promptName) {
          setVersions(data.versions);
        }
      }
    } catch (err) {
      console.error("Failed to fetch versions:", err);
    } finally {
      if (selectedPrompt?.name === promptName) {
        setLoadingVersions(false);
      }
    }
  };

  const handleSave = async () => {
    if (!selectedPrompt) return;

    const currentName = selectedPrompt.name;

    try {
      setSaving(true);
      setSaveResult(null);

      const response = await fetch("/api/prompts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: currentName,
          content: editedContent,
          model: editedModel || null,
          purpose: editedPurpose || null,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setSaveResult({ success: true, message: "Prompt saved successfully" });

        // Invalidate version cache for this prompt
        delete versionCache.current[currentName];

        // Reload prompts and re-select from fresh data
        const freshPrompts = await loadPrompts();
        const freshSelected = freshPrompts.find(p => p.name === currentName);
        if (freshSelected) {
          setSelectedPrompt(freshSelected);
        }

        // Refresh versions if panel is open
        if (showVersionHistory) {
          await fetchVersions(currentName, true);
        }

        // Auto-hide success message after 3 seconds
        setTimeout(() => setSaveResult(null), 3000);
      } else {
        setSaveResult({ success: false, message: data.error || "Failed to save prompt" });
      }
    } catch (err) {
      setSaveResult({
        success: false,
        message: err instanceof Error ? err.message : "Failed to save prompt",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleRevert = async (versionNumber: number) => {
    if (!selectedPrompt) return;

    const promptName = selectedPrompt.name;

    try {
      setReverting(true);
      const response = await fetch("/api/prompts/versions/revert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: promptName, versionNumber }),
      });

      const data = await response.json();

      if (data.success) {
        // Invalidate version cache
        delete versionCache.current[promptName];

        // Reload prompts and re-select from fresh data
        const freshPrompts = await loadPrompts();
        const freshSelected = freshPrompts.find(p => p.name === promptName);
        if (freshSelected) {
          setSelectedPrompt(freshSelected);
          setEditedContent(freshSelected.content);
          setEditedModel(freshSelected.model || "");
          setEditedPurpose(freshSelected.purpose || "");
        }

        // Refresh versions
        await fetchVersions(promptName, true);

        // Clear selected version preview
        setSelectedVersion(null);

        setSaveResult({ success: true, message: `Reverted to version ${versionNumber}` });
        setTimeout(() => setSaveResult(null), 3000);
      } else {
        setSaveResult({ success: false, message: data.error || "Failed to revert" });
      }
    } catch (err) {
      setSaveResult({
        success: false,
        message: err instanceof Error ? err.message : "Failed to revert",
      });
    } finally {
      setReverting(false);
      setShowRevertConfirm(null);
    }
  };

  const toggleVersionHistory = () => {
    if (!showVersionHistory && selectedPrompt) {
      fetchVersions(selectedPrompt.name);
    }
    setShowVersionHistory(!showVersionHistory);
    setSelectedVersion(null);
  };

  const hasChanges = selectedPrompt && (
    editedContent !== selectedPrompt.content ||
    (editedModel || null) !== selectedPrompt.model ||
    (editedPurpose || null) !== selectedPrompt.purpose
  );

  const formatPromptName = (name: string) => {
    return name
      .split("-")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const year = String(date.getFullYear()).slice(-2);
    const hours = date.getHours();
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const ampm = hours >= 12 ? "PM" : "AM";
    const hour12 = hours % 12 || 12;
    return `${month}/${day}/${year} ${hour12}:${minutes} ${ampm}`;
  };

  const formatRelativeTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "just now";
    if (diffMins < 60) return `${diffMins} minute${diffMins === 1 ? "" : "s"} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
    return formatDate(dateString);
  };

  return (
    <div className="min-h-screen flex">
      {/* Left Sidebar */}
      <aside className="w-64 bg-white border-r border-border flex flex-col shrink-0 sticky top-0 h-screen overflow-y-auto">
        {/* Logo */}
        <div className="h-16 flex items-center px-6 border-b border-border">
          <Image
            src="/Macroscope-text-logo.png"
            alt="Macroscope"
            width={140}
            height={28}
            className="h-7 w-auto"
            priority
          />
        </div>

        {/* Navigation Links */}
        <nav className="flex-1 px-4 py-6">
          <div className="space-y-1">
            <Link
              href="/"
              className="w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-lg text-text-secondary hover:bg-bg-subtle hover:text-accent transition-colors"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
              My Repos
            </Link>
            <div className="w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-lg bg-primary/10 text-primary">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Settings
            </div>
          </div>
        </nav>
        <UserMenu />
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 bg-bg-subtle h-screen overflow-y-auto">
        {/* Sticky Header */}
        <div className="sticky top-0 z-10 bg-bg-subtle px-8 pt-8 pb-4 border-b border-border shadow-sm">
          <h1 className="text-2xl font-semibold text-accent tracking-tight">Settings</h1>
          <p className="mt-2 text-text-secondary">Configure prompts and application settings</p>
        </div>

        {/* Content */}
        <div className="px-8 py-6">
          {/* Prompts Section */}
          <div className="bg-white border border-border rounded-xl shadow-sm">
            <div className="px-6 py-4 border-b border-border">
              <h2 className="text-lg font-semibold text-accent">Prompts</h2>
              <p className="text-sm text-text-secondary mt-1">
                View and edit the prompts used for PR analysis and email generation
              </p>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-12">
                <svg className="animate-spin h-8 w-8 text-primary" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              </div>
            ) : error ? (
              <div className="p-6">
                <div className="rounded-lg bg-error-light border border-error/20 p-4 text-sm text-error">
                  {error}
                </div>
              </div>
            ) : (
              <div className="flex">
                {/* Prompt List */}
                <div className="w-64 border-r border-border">
                  <div className="p-2">
                    {prompts.map((prompt) => (
                      <button
                        key={prompt.name}
                        onClick={() => selectPrompt(prompt)}
                        className={`w-full text-left px-4 py-3 rounded-lg transition-colors ${
                          selectedPrompt?.name === prompt.name
                            ? "bg-primary/10 text-primary"
                            : "text-text-secondary hover:bg-bg-subtle hover:text-accent"
                        }`}
                      >
                        <div className="font-medium text-sm">{formatPromptName(prompt.name)}</div>
                        {prompt.purpose && (
                          <div className="text-xs text-text-muted mt-1 line-clamp-2">
                            {prompt.purpose}
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Prompt Editor */}
                <div className="flex-1 p-6">
                  {selectedPrompt ? (
                    <div className="space-y-6">
                      {/* Header */}
                      <div className="flex items-start justify-between">
                        <div>
                          <h3 className="text-lg font-semibold text-accent">
                            {formatPromptName(selectedPrompt.name)}
                          </h3>
                          <p className="text-sm text-text-muted mt-1">
                            Last updated: {formatDate(selectedPrompt.updatedAt)}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={handleSave}
                            disabled={saving || !hasChanges}
                            className="inline-flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary-hover text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {saving ? (
                              <>
                                <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                </svg>
                                Saving...
                              </>
                            ) : (
                              <>
                                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                </svg>
                                Save Changes
                              </>
                            )}
                          </button>
                        </div>
                      </div>

                      {/* Save Result */}
                      {saveResult && (
                        <div
                          className={`rounded-lg border p-3 text-sm ${
                            saveResult.success
                              ? "bg-success-light border-success/20 text-success"
                              : "bg-error-light border-error/20 text-error"
                          }`}
                        >
                          {saveResult.message}
                        </div>
                      )}

                      {/* Metadata Fields */}
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-accent mb-2">
                            Model
                          </label>
                          <input
                            type="text"
                            value={editedModel}
                            onChange={(e) => setEditedModel(e.target.value)}
                            placeholder="e.g., claude-sonnet-4-20250514"
                            className="w-full px-3 py-2 bg-white border border-border rounded-lg text-sm text-black placeholder:text-text-muted focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-accent mb-2">
                            Purpose
                          </label>
                          <input
                            type="text"
                            value={editedPurpose}
                            onChange={(e) => setEditedPurpose(e.target.value)}
                            placeholder="Brief description of what this prompt does"
                            className="w-full px-3 py-2 bg-white border border-border rounded-lg text-sm text-black placeholder:text-text-muted focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors"
                          />
                        </div>
                      </div>

                      {/* Content Editor */}
                      <div>
                        <label className="block text-sm font-medium text-accent mb-2">
                          Prompt Content
                        </label>
                        <textarea
                          value={editedContent}
                          onChange={(e) => setEditedContent(e.target.value)}
                          rows={20}
                          className="w-full px-4 py-3 bg-white border border-border rounded-lg text-sm text-black font-mono placeholder:text-text-muted focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors resize-y"
                          placeholder="Enter prompt content..."
                        />
                        <p className="text-xs text-text-muted mt-2">
                          Use {"{VARIABLE_NAME}"} syntax for variables that will be interpolated at runtime.
                        </p>
                      </div>

                      {/* Version History Section */}
                      <div className="border-t border-border pt-6">
                        <button
                          onClick={toggleVersionHistory}
                          className="flex items-center gap-2 text-sm font-medium text-text-secondary hover:text-accent transition-colors"
                        >
                          <svg
                            className={`h-4 w-4 transition-transform ${showVersionHistory ? "rotate-90" : ""}`}
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                          </svg>
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          Version History
                          {versions.length > 0 && (
                            <span className="text-xs text-text-muted">({versions.length} versions)</span>
                          )}
                        </button>

                        {showVersionHistory && (
                          <div className="mt-4 space-y-4">
                            {loadingVersions ? (
                              <div className="flex items-center justify-center py-8">
                                <svg className="animate-spin h-6 w-6 text-primary" fill="none" viewBox="0 0 24 24">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                </svg>
                              </div>
                            ) : versions.length === 0 ? (
                              <p className="text-sm text-text-muted py-4">No version history yet. Save changes to create the first version.</p>
                            ) : (
                              <>
                                {/* Version List */}
                                <div className="border border-border rounded-lg divide-y divide-border max-h-64 overflow-y-auto">
                                  {versions.map((version) => (
                                    <div
                                      key={version.version_number}
                                      className={`flex items-center justify-between px-4 py-3 ${
                                        selectedVersion?.version_number === version.version_number
                                          ? "bg-primary/5"
                                          : "hover:bg-bg-subtle"
                                      }`}
                                    >
                                      <div className="flex items-center gap-3">
                                        <span className="text-sm font-medium text-accent">
                                          Version {version.version_number}
                                        </span>
                                        <span className="text-xs text-text-muted">
                                          {formatRelativeTime(version.created_at)}
                                        </span>
                                      </div>
                                      <div className="flex items-center gap-2">
                                        <button
                                          onClick={() => setSelectedVersion(
                                            selectedVersion?.version_number === version.version_number
                                              ? null
                                              : version
                                          )}
                                          className="text-xs text-primary hover:text-primary-hover font-medium"
                                        >
                                          {selectedVersion?.version_number === version.version_number ? "Hide" : "View"}
                                        </button>
                                        {showRevertConfirm === version.version_number ? (
                                          <div className="flex items-center gap-1">
                                            <button
                                              onClick={() => handleRevert(version.version_number)}
                                              disabled={reverting}
                                              className="text-xs text-error hover:text-error/80 font-medium"
                                            >
                                              {reverting ? "Reverting..." : "Confirm"}
                                            </button>
                                            <button
                                              onClick={() => setShowRevertConfirm(null)}
                                              className="text-xs text-text-muted hover:text-text-secondary font-medium"
                                            >
                                              Cancel
                                            </button>
                                          </div>
                                        ) : (
                                          <button
                                            onClick={() => setShowRevertConfirm(version.version_number)}
                                            className="text-xs text-text-secondary hover:text-accent font-medium"
                                          >
                                            Revert
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                  ))}
                                </div>

                                {/* Version Preview */}
                                {selectedVersion && (
                                  <div className="border border-border rounded-lg p-4 bg-bg-subtle">
                                    <div className="flex items-center justify-between mb-3">
                                      <h4 className="text-sm font-medium text-accent">
                                        Version {selectedVersion.version_number} Preview
                                      </h4>
                                      <span className="text-xs text-text-muted">
                                        {formatDate(selectedVersion.created_at)}
                                      </span>
                                    </div>
                                    {selectedVersion.model && (
                                      <p className="text-xs text-text-muted mb-1">
                                        <span className="font-medium">Model:</span> {selectedVersion.model}
                                      </p>
                                    )}
                                    {selectedVersion.purpose && (
                                      <p className="text-xs text-text-muted mb-3">
                                        <span className="font-medium">Purpose:</span> {selectedVersion.purpose}
                                      </p>
                                    )}
                                    <textarea
                                      value={selectedVersion.content}
                                      readOnly
                                      rows={20}
                                      className="w-full px-4 py-3 bg-white border border-border rounded-lg text-sm text-black font-mono resize-none"
                                    />
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center h-64 text-text-muted">
                      Select a prompt to view and edit
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
