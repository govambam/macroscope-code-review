"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  type AnalysisApiResponse,
  type EmailSequence,
  type EmailTabKey,
  type EmailGenerationResponse,
  isV2Result,
  resultHasMeaningfulBugs,
  getTotalBugCount,
  getBestBugForEmail,
  EMAIL_TABS,
} from "@/lib/types/prospector-analysis";

interface EmailSectionProps {
  analysisResult: AnalysisApiResponse;
  selectedBugIndex: number | null;
  forkedPrUrl: string;
  currentAnalysisId: number | null;
  initialEmail?: EmailSequence | null;
  onEmailsGenerated: (data: { generatedEmail: EmailSequence; editedEmail: EmailSequence }) => void;
  onEmailEdited: (editedEmail: EmailSequence) => void;
  onContinueToSend: () => void;
}

export function EmailSection({
  analysisResult,
  selectedBugIndex,
  forkedPrUrl,
  currentAnalysisId,
  initialEmail,
  onEmailsGenerated,
  onEmailEdited,
  onContinueToSend,
}: EmailSectionProps) {
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [generatedEmail, setGeneratedEmail] = useState<EmailSequence | null>(initialEmail ?? null);
  const [editedEmail, setEditedEmail] = useState<EmailSequence | null>(
    initialEmail ? JSON.parse(JSON.stringify(initialEmail)) : null
  );
  const [activeEmailTab, setActiveEmailTab] = useState<EmailTabKey>("email_1");
  const [emailCopied, setEmailCopied] = useState(false);
  const [emailSaving, setEmailSaving] = useState(false);
  const hasTriggeredRef = useRef(false);

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
    setGeneratedEmail(null);
    setEditedEmail(null);

    const totalBugs = getTotalBugCount(analysisResult.result);

    try {
      const res = await fetch("/api/generate-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          originalPrUrl,
          prTitle: analysisResult.originalPrTitle,
          prStatus: analysisResult.originalPrState,
          prMergedAt: analysisResult.originalPrMergedAt,
          forkedPrUrl,
          bug: bestBug,
          totalBugs,
          analysisId: currentAnalysisId,
        }),
      });

      const data: EmailGenerationResponse = await res.json();

      if (data.success && data.email) {
        setGeneratedEmail(data.email);
        const editCopy = JSON.parse(JSON.stringify(data.email)) as EmailSequence;
        setEditedEmail(editCopy);
        onEmailsGenerated({ generatedEmail: data.email, editedEmail: editCopy });
      } else {
        setEmailError(data.error || "Failed to generate email");
      }
    } catch (error) {
      setEmailError(error instanceof Error ? error.message : "Failed to generate email");
    } finally {
      setEmailLoading(false);
    }
  }, [analysisResult, selectedBugIndex, forkedPrUrl, currentAnalysisId, onEmailsGenerated]);

  // Auto-trigger email generation on mount if no initial email
  useEffect(() => {
    if (!hasTriggeredRef.current) {
      hasTriggeredRef.current = true;
      if (initialEmail) {
        onEmailsGenerated({
          generatedEmail: initialEmail,
          editedEmail: JSON.parse(JSON.stringify(initialEmail)),
        });
      } else {
        generateEmail();
      }
    }
  }, [initialEmail, generateEmail, onEmailsGenerated]);

  function handleEmailEdit(field: "subject" | "body", value: string) {
    if (!editedEmail) return;
    const updated = {
      ...editedEmail,
      [activeEmailTab]: {
        ...editedEmail[activeEmailTab],
        [field]: value,
      },
    };
    setEditedEmail(updated);
    onEmailEdited(updated);
  }

  function hasUnsavedEmailChanges(): boolean {
    if (!generatedEmail || !editedEmail) return false;
    return JSON.stringify(generatedEmail) !== JSON.stringify(editedEmail);
  }

  async function handleSaveEmail(): Promise<boolean> {
    if (!editedEmail || !currentAnalysisId) return false;
    setEmailSaving(true);
    try {
      const res = await fetch("/api/emails/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          analysisId: currentAnalysisId,
          emailContent: JSON.stringify(editedEmail),
        }),
      });
      if (res.ok) {
        setGeneratedEmail(JSON.parse(JSON.stringify(editedEmail)));
        return true;
      }
      return false;
    } catch {
      return false;
    } finally {
      setEmailSaving(false);
    }
  }

  async function copyEmail() {
    if (!editedEmail) return;
    const active = editedEmail[activeEmailTab];
    const text = `Subject: ${active.subject}\n\n${active.body}`;
    try {
      await navigator.clipboard.writeText(text);
      setEmailCopied(true);
      setTimeout(() => setEmailCopied(false), 2000);
    } catch {
      // Clipboard not available
    }
  }

  async function handleContinueToSend() {
    if (hasUnsavedEmailChanges()) {
      await handleSaveEmail();
    }
    onContinueToSend();
  }

  // ── Loading skeleton ──────────────────────────────────────────────────

  if (emailLoading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-6 bg-gray-200 rounded w-56" />
        <div className="flex gap-2 border-b border-gray-200 pb-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-8 w-24 bg-gray-200 rounded" />
          ))}
        </div>
        <div className="border border-gray-200 rounded-lg p-4 space-y-3">
          <div className="flex items-center gap-2">
            <div className="h-4 w-16 bg-gray-200 rounded" />
            <div className="h-8 flex-1 bg-gray-200 rounded" />
          </div>
          <div className="space-y-2 pt-3 border-t border-gray-200">
            <div className="h-4 w-12 bg-gray-200 rounded" />
            <div className="h-4 w-full bg-gray-200 rounded" />
            <div className="h-4 w-5/6 bg-gray-200 rounded" />
            <div className="h-4 w-full bg-gray-200 rounded" />
            <div className="h-4 w-2/3 bg-gray-200 rounded" />
            <div className="h-4 w-full bg-gray-200 rounded" />
            <div className="h-4 w-4/5 bg-gray-200 rounded" />
          </div>
        </div>
        <div className="flex items-center justify-center gap-2 text-sm text-gray-500">
          <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <span>Generating email sequence...</span>
        </div>
      </div>
    );
  }

  // ── Error state ───────────────────────────────────────────────────────

  if (emailError && !editedEmail) {
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

  // ── No email yet ──────────────────────────────────────────────────────

  if (!editedEmail) {
    return (
      <div className="text-center py-8">
        <p className="text-sm text-text-muted italic">Waiting for email generation...</p>
      </div>
    );
  }

  // ── Email editor ──────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Header with actions */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-accent">4-Email Outreach Sequence</h3>
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
            onClick={copyEmail}
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
                Copy Selected
              </>
            )}
          </button>
        </div>
      </div>

      {/* Email tabs */}
      <div className="border-b border-border">
        <div className="flex gap-1">
          {EMAIL_TABS.map(({ key, label, desc }) => (
            <button
              key={key}
              onClick={() => setActiveEmailTab(key)}
              className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
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

      {/* Editable email content */}
      <div className="bg-bg-subtle border border-border rounded-lg p-4 space-y-3">
        <div className="flex items-start gap-2">
          <label className="text-sm font-medium text-accent shrink-0 pt-2">Subject:</label>
          <input
            type="text"
            value={editedEmail[activeEmailTab].subject}
            onChange={(e) => handleEmailEdit("subject", e.target.value)}
            className="flex-1 px-3 py-2 text-sm text-text-primary bg-white border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          />
        </div>
        <div className="border-t border-border pt-3">
          <label className="text-sm font-medium text-accent block mb-2">Body:</label>
          <textarea
            value={editedEmail[activeEmailTab].body}
            onChange={(e) => handleEmailEdit("body", e.target.value)}
            rows={12}
            className="w-full px-3 py-2 text-sm text-text-secondary bg-white border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary resize-y font-sans"
          />
        </div>
        {hasUnsavedEmailChanges() && (
          <div className="flex items-center justify-between pt-2 border-t border-border">
            <span className="text-xs text-amber-600">You have unsaved changes</span>
            <button
              onClick={handleSaveEmail}
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
      </div>

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
