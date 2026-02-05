"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  type AnalysisApiResponse,
  type EmailSequence,
  type EmailTabKey,
  type EmailGenerationResponse,
  type EmailVariables,
  resultHasMeaningfulBugs,
  getBestBugForEmail,
  EMAIL_TABS,
} from "@/lib/types/prospector-analysis";
import {
  renderEmailSequence,
  LLM_VARIABLE_KEYS,
  DB_VARIABLE_KEYS,
  type AllEmailVariables,
} from "@/lib/constants/email-templates";

interface EmailSectionProps {
  analysisResult: AnalysisApiResponse;
  selectedBugIndex: number | null;
  forkedPrUrl: string;
  currentAnalysisId: number | null;
  initialCachedData?: string | null;
  onEmailsGenerated: (data: { generatedEmail: EmailSequence; editedEmail: EmailSequence; allVariables?: Record<string, string> }) => void;
  onEmailEdited: (editedEmail: EmailSequence) => void;
  onContinueToSend: () => void;
}

/** Labels for display in the Variables tab */
const VARIABLE_LABELS: Record<keyof AllEmailVariables, string> = {
  BUG_DESCRIPTION: "Bug Description",
  BUG_IMPACT: "Bug Impact",
  FIX_SUGGESTION: "Fix Suggestion",
  BUG_TYPE: "Bug Type",
  PR_NAME: "PR Name",
  PR_LINK: "PR Link",
  BUG_FIX_URL: "Bug Fix URL",
  SIMULATED_PR_LINK: "Simulated PR Link",
};

/**
 * Parses cached email data from the database.
 * Handles both new format ({ variables, dbVariables }) and legacy format (EmailSequence).
 */
function parseCachedData(raw: string | null | undefined): {
  variables: EmailVariables | null;
  dbVariables: Omit<AllEmailVariables, keyof EmailVariables> | null;
  legacyEmail: EmailSequence | null;
} {
  if (!raw) return { variables: null, dbVariables: null, legacyEmail: null };
  try {
    const parsed = JSON.parse(raw);
    if (parsed.variables && parsed.dbVariables) {
      return {
        variables: parsed.variables as EmailVariables,
        dbVariables: parsed.dbVariables,
        legacyEmail: null,
      };
    }
    // Legacy format: raw EmailSequence
    if (parsed.email_1 && parsed.email_2 && parsed.email_3 && parsed.email_4) {
      return { variables: null, dbVariables: null, legacyEmail: parsed as EmailSequence };
    }
    return { variables: null, dbVariables: null, legacyEmail: null };
  } catch {
    return { variables: null, dbVariables: null, legacyEmail: null };
  }
}

export function EmailSection({
  analysisResult,
  selectedBugIndex,
  forkedPrUrl,
  currentAnalysisId,
  initialCachedData,
  onEmailsGenerated,
  onEmailEdited,
  onContinueToSend,
}: EmailSectionProps) {
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailCopied, setEmailCopied] = useState(false);
  const [emailSaving, setEmailSaving] = useState(false);
  const [imageRegenerating, setImageRegenerating] = useState(false);
  const [activeEmailTab, setActiveEmailTab] = useState<EmailTabKey>("variables");
  const hasTriggeredRef = useRef(false);

  // Parse initial cached data
  const cached = useMemo(() => parseCachedData(initialCachedData), [initialCachedData]);

  // Variables state (LLM-generated, editable)
  const [variables, setVariables] = useState<EmailVariables | null>(cached.variables);
  const [savedVariables, setSavedVariables] = useState<EmailVariables | null>(cached.variables);

  // DB variables (read-only)
  const [dbVariables, setDbVariables] = useState<Omit<AllEmailVariables, keyof EmailVariables> | null>(
    cached.dbVariables
  );

  // Legacy email support
  const [legacyEmail, setLegacyEmail] = useState<EmailSequence | null>(cached.legacyEmail);

  // Derive previews from current variables
  const previews = useMemo<EmailSequence | null>(() => {
    if (variables && dbVariables) {
      return renderEmailSequence({ ...variables, ...dbVariables });
    }
    return legacyEmail;
  }, [variables, dbVariables, legacyEmail]);

  const generateEmail = useCallback(async () => {
    if (!analysisResult?.result || !resultHasMeaningfulBugs(analysisResult.result)) return;

    const bestBug = getBestBugForEmail(analysisResult.result, selectedBugIndex);
    if (!bestBug) return;

    const originalPrUrl = analysisResult.originalPrUrl;
    if (!originalPrUrl) {
      setEmailError("Could not determine original PR URL. The analysis may need to be regenerated.");
      return;
    }

    setEmailLoading(true);
    setEmailError(null);
    setVariables(null);
    setSavedVariables(null);
    setDbVariables(null);
    setLegacyEmail(null);

    try {
      const res = await fetch("/api/generate-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          originalPrUrl,
          prTitle: analysisResult.originalPrTitle,
          forkedPrUrl,
          bug: bestBug,
          analysisId: currentAnalysisId,
        }),
      });

      const data: EmailGenerationResponse = await res.json();

      if (data.success && data.variables && data.dbVariables && data.previews) {
        setVariables(data.variables);
        setSavedVariables(JSON.parse(JSON.stringify(data.variables)));
        setDbVariables(data.dbVariables);

        // Notify parent with rendered previews and all variables
        onEmailsGenerated({
          generatedEmail: data.previews,
          editedEmail: JSON.parse(JSON.stringify(data.previews)),
          allVariables: { ...data.variables, ...data.dbVariables },
        });
      } else {
        setEmailError(data.error || "Failed to generate email variables");
      }
    } catch (error) {
      setEmailError(error instanceof Error ? error.message : "Failed to generate email");
    } finally {
      setEmailLoading(false);
    }
  }, [analysisResult, selectedBugIndex, forkedPrUrl, currentAnalysisId, onEmailsGenerated]);

  // Auto-trigger on mount if no cached data
  useEffect(() => {
    if (!hasTriggeredRef.current) {
      hasTriggeredRef.current = true;
      if (previews) {
        onEmailsGenerated({
          generatedEmail: previews,
          editedEmail: JSON.parse(JSON.stringify(previews)),
          allVariables: variables && dbVariables ? { ...variables, ...dbVariables } : undefined,
        });
      } else {
        generateEmail();
      }
    }
  }, [previews, generateEmail, onEmailsGenerated]);

  function handleVariableEdit(key: keyof EmailVariables, value: string) {
    if (!variables || !dbVariables) return;
    const updated = { ...variables, [key]: value };
    setVariables(updated);
    // Notify parent with re-rendered previews directly (avoids useEffect dependency loop)
    onEmailEdited(renderEmailSequence({ ...updated, ...dbVariables }));
  }

  function hasUnsavedChanges(): boolean {
    if (!variables || !savedVariables) return false;
    return JSON.stringify(variables) !== JSON.stringify(savedVariables);
  }

  async function handleSave(): Promise<boolean> {
    if (!variables || !dbVariables || !currentAnalysisId) return false;
    setEmailSaving(true);
    try {
      const res = await fetch("/api/emails/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          analysisId: currentAnalysisId,
          emailContent: JSON.stringify({ variables, dbVariables }),
        }),
      });
      if (res.ok) {
        setSavedVariables(JSON.parse(JSON.stringify(variables)));
        return true;
      }
      return false;
    } catch {
      return false;
    } finally {
      setEmailSaving(false);
    }
  }

  async function regenerateCodeImage() {
    if (!analysisResult?.result || !dbVariables) return;
    const bestBug = getBestBugForEmail(analysisResult.result, selectedBugIndex);
    if (!bestBug?.code_suggestion) return;

    setImageRegenerating(true);
    try {
      const res = await fetch("/api/generate-code-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          codeSuggestion: bestBug.code_suggestion,
          filePath: bestBug.file_path,
        }),
      });
      const data = await res.json();
      if (data.success && data.url) {
        const updated = { ...dbVariables, BUG_FIX_URL: data.url };
        setDbVariables(updated);
        if (variables) {
          onEmailEdited(renderEmailSequence({ ...variables, ...updated }));
        }
      }
    } catch {
      // Silently fail — user can retry
    } finally {
      setImageRegenerating(false);
    }
  }

  async function copyVariables() {
    if (!variables || !dbVariables) return;
    const allVars = { ...variables, ...dbVariables };
    const lines = [
      ...LLM_VARIABLE_KEYS.map((k) => `${k}: ${allVars[k]}`),
      "",
      ...DB_VARIABLE_KEYS.map((k) => `${k}: ${allVars[k]}`),
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setEmailCopied(true);
      setTimeout(() => setEmailCopied(false), 2000);
    } catch {
      // Clipboard not available
    }
  }

  async function copyPreviewEmail() {
    if (!previews || activeEmailTab === "variables") return;
    const email = previews[activeEmailTab as keyof EmailSequence];
    const text = `Subject: ${email.subject}\n\n${email.body}`;
    try {
      await navigator.clipboard.writeText(text);
      setEmailCopied(true);
      setTimeout(() => setEmailCopied(false), 2000);
    } catch {
      // Clipboard not available
    }
  }

  async function handleContinueToSend() {
    if (hasUnsavedChanges()) {
      await handleSave();
    }
    onContinueToSend();
  }

  // ── Loading skeleton ──────────────────────────────────────────────────

  if (emailLoading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-6 bg-gray-200 rounded w-56" />
        <div className="flex gap-2 border-b border-gray-200 pb-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-8 w-24 bg-gray-200 rounded" />
          ))}
        </div>
        <div className="border border-gray-200 rounded-lg p-4 space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="space-y-1">
              <div className="h-3 w-24 bg-gray-200 rounded" />
              <div className="h-8 w-full bg-gray-200 rounded" />
            </div>
          ))}
        </div>
        <div className="flex items-center justify-center gap-2 text-sm text-gray-500">
          <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <span>Generating email variables...</span>
        </div>
      </div>
    );
  }

  // ── Error state ───────────────────────────────────────────────────────

  if (emailError && !variables && !legacyEmail) {
    return (
      <div className="space-y-4">
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm font-medium text-red-800">Email Generation Failed</p>
          <p className="text-sm text-red-700 mt-1">{emailError}</p>
        </div>
        <button
          type="button"
          onClick={() => {
            hasTriggeredRef.current = false;
            generateEmail();
          }}
          className="px-4 py-2 text-sm font-medium text-white bg-primary hover:bg-primary-hover rounded-lg transition-colors"
        >
          Try Again
        </button>
      </div>
    );
  }

  // ── No data yet ────────────────────────────────────────────────────────

  if (!variables && !legacyEmail) {
    return (
      <div className="text-center py-8">
        <p className="text-sm text-text-muted italic">Waiting for email variable generation...</p>
      </div>
    );
  }

  // ── Main UI ────────────────────────────────────────────────────────────

  const isVariablesTab = activeEmailTab === "variables";
  const isPreviewTab = !isVariablesTab;

  return (
    <div className="space-y-4">
      {/* Header with actions */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-accent">Email Variables & Previews</h3>
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              hasTriggeredRef.current = false;
              generateEmail();
            }}
            className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-accent font-medium"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Regenerate
          </button>
          <button
            onClick={isVariablesTab ? copyVariables : copyPreviewEmail}
            className="inline-flex items-center gap-1.5 text-sm text-primary hover:text-primary-hover font-medium"
          >
            {emailCopied ? (
              <>
                <svg className="h-4 w-4 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                Copied!
              </>
            ) : (
              <>
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                {isVariablesTab ? "Copy Variables" : "Copy Email"}
              </>
            )}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-border">
        <div className="flex gap-1 overflow-x-auto">
          {EMAIL_TABS.map(({ key, label, desc }) => (
            <button
              key={key}
              onClick={() => setActiveEmailTab(key)}
              className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors -mb-px whitespace-nowrap ${
                activeEmailTab === key
                  ? "border-primary text-primary"
                  : "border-transparent text-text-secondary hover:text-accent hover:border-gray-300"
              }`}
            >
              <span>{label}</span>
              <span className="hidden sm:inline text-xs ml-1 opacity-70">({desc})</span>
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="bg-bg-subtle border border-border rounded-lg p-4">
        {isVariablesTab && variables && dbVariables && (
          <div className="space-y-4">
            {/* LLM-generated variables (editable) */}
            <div>
              <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">
                LLM-Generated Variables
              </p>
              <div className="space-y-3">
                {LLM_VARIABLE_KEYS.map((key) => (
                  <div key={key}>
                    <label className="text-xs font-medium text-accent block mb-1">
                      {VARIABLE_LABELS[key]}
                      <span className="text-text-muted font-normal ml-1">({key})</span>
                    </label>
                    {key === "BUG_TYPE" ? (
                      <input
                        type="text"
                        value={variables[key]}
                        onChange={(e) => handleVariableEdit(key, e.target.value)}
                        className="w-full px-3 py-2 text-sm text-text-primary bg-white border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                      />
                    ) : (
                      <textarea
                        value={variables[key]}
                        onChange={(e) => handleVariableEdit(key, e.target.value)}
                        rows={key === "BUG_DESCRIPTION" ? 2 : key === "BUG_IMPACT" ? 2 : 1}
                        className="w-full px-3 py-2 text-sm text-text-primary bg-white border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary resize-y"
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* DB variables (read-only) */}
            <div className="border-t border-border pt-4">
              <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">
                Database Variables (read-only)
              </p>
              <div className="space-y-2">
                {DB_VARIABLE_KEYS.map((key) => (
                  <div key={key} className="flex items-start gap-2">
                    <span className="text-xs font-medium text-text-muted shrink-0 pt-1 w-36">
                      {VARIABLE_LABELS[key]}
                    </span>
                    <span className="text-sm text-text-secondary break-all flex-1">
                      {dbVariables[key] || <span className="italic text-text-muted">empty</span>}
                    </span>
                    {key === "BUG_FIX_URL" && (
                      <button
                        onClick={regenerateCodeImage}
                        disabled={imageRegenerating}
                        title="Regenerate code image"
                        className="shrink-0 p-1 text-text-muted hover:text-primary transition-colors disabled:opacity-50"
                      >
                        {imageRegenerating ? (
                          <svg className="h-3.5 w-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                          </svg>
                        ) : (
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                        )}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Legacy email display (old cached format) */}
        {isVariablesTab && !variables && legacyEmail && (
          <div className="text-sm text-text-muted italic">
            This email was generated with an older format. Variable editing is not available.
            Click &quot;Regenerate&quot; to generate new variables.
          </div>
        )}

        {/* Email preview tabs */}
        {isPreviewTab && previews && (
          <div className="space-y-3">
            <div className="flex items-start gap-2">
              <label className="text-sm font-medium text-accent shrink-0 pt-2">Subject:</label>
              <div className="flex-1 px-3 py-2 text-sm text-text-primary bg-white border border-border rounded-lg">
                {previews[activeEmailTab as keyof EmailSequence].subject}
              </div>
            </div>
            <div className="border-t border-border pt-3">
              <label className="text-sm font-medium text-accent block mb-2">Body:</label>
              <div className="w-full px-3 py-2 text-sm text-text-secondary bg-white border border-border rounded-lg whitespace-pre-wrap font-sans min-h-[200px]">
                {previews[activeEmailTab as keyof EmailSequence].body}
              </div>
            </div>
          </div>
        )}

        {isPreviewTab && !previews && (
          <div className="text-sm text-text-muted italic">No preview available.</div>
        )}
      </div>

      {/* Unsaved changes bar */}
      {hasUnsavedChanges() && (
        <div className="flex items-center justify-between px-4 py-2 bg-amber-50 border border-amber-200 rounded-lg">
          <span className="text-xs text-amber-600">You have unsaved variable changes</span>
          <button
            onClick={handleSave}
            disabled={emailSaving}
            className="px-4 py-2 text-sm font-medium bg-primary hover:bg-primary-hover text-white rounded-lg transition-colors disabled:opacity-50"
          >
            {emailSaving ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Saving...
              </span>
            ) : (
              "Save Changes"
            )}
          </button>
        </div>
      )}

      {emailError && (
        <p className="text-sm text-error">{emailError}</p>
      )}

      {/* Continue to Send button */}
      <div className="border-t border-border pt-5">
        <button
          type="button"
          onClick={handleContinueToSend}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary hover:bg-primary-hover text-white font-medium rounded-lg transition-colors"
        >
          Continue to Send
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
          </svg>
        </button>
      </div>
    </div>
  );
}
