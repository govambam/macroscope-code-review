"use client";

import React, { useState, useMemo, useEffect, useRef } from "react";
import type { ParsedSignupData, SignupEmailVariables, SignupEmailSequence, SignupLLMFields } from "@/lib/types/signup-lead";
import type { ConnectionMatch } from "@/lib/constants/macroscope-team";
import {
  renderSignupEmailSequence,
  parsedDataToVariables,
  SIGNUP_TEMPLATE_VARIABLE_KEYS,
  SIGNUP_APOLLO_VARIABLE_KEYS,
  SIGNUP_LLM_VARIABLE_KEYS,
  SIGNUP_VARIABLE_LABELS,
} from "@/lib/constants/signup-email-templates";

type EmailTabKey = "variables" | "email_1" | "email_2" | "email_3" | "email_4";

const EMAIL_TABS: { key: EmailTabKey; label: string; desc: string }[] = [
  { key: "variables", label: "Variables", desc: "Edit" },
  { key: "email_1", label: "Email 1", desc: "Day 0" },
  { key: "email_2", label: "Email 2", desc: "Day 3" },
  { key: "email_3", label: "Email 3", desc: "Day 7" },
  { key: "email_4", label: "Email 4", desc: "Day 12" },
];

interface SignupEmailSectionProps {
  parsedData: ParsedSignupData;
  connectionMatches: ConnectionMatch[];
  leadId: number | null;
  onVariablesGenerated: (variables: SignupEmailVariables) => void;
  onContinueToSend: () => void;
}

export function SignupEmailSection({
  parsedData,
  connectionMatches,
  leadId,
  onVariablesGenerated,
  onContinueToSend,
}: SignupEmailSectionProps) {
  const [activeTab, setActiveTab] = useState<EmailTabKey>("variables");
  const [variables, setVariables] = useState<SignupEmailVariables>(() => parsedDataToVariables(parsedData));
  const [savedVariables, setSavedVariables] = useState<SignupEmailVariables | null>(null);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const hasNotifiedRef = useRef(false);

  // LLM generation state
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [hasGenerated, setHasGenerated] = useState(false);

  // Notify parent of variables on mount
  useEffect(() => {
    if (!hasNotifiedRef.current) {
      hasNotifiedRef.current = true;
      onVariablesGenerated(variables);
    }
  }, [variables, onVariablesGenerated]);

  // Derive email previews from variables
  const previews = useMemo<SignupEmailSequence>(() => {
    return renderSignupEmailSequence(variables);
  }, [variables]);

  function handleVariableEdit(key: keyof SignupEmailVariables, value: string) {
    const updated = { ...variables, [key]: value };
    setVariables(updated);
    onVariablesGenerated(updated);
  }

  function hasUnsavedChanges(): boolean {
    if (!savedVariables) return false;
    return JSON.stringify(variables) !== JSON.stringify(savedVariables);
  }

  async function handleSave() {
    if (!leadId) return;

    setSaving(true);
    try {
      const res = await fetch("/api/signup-lead", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId, emailVariables: variables }),
      });

      if (res.ok) {
        setSavedVariables({ ...variables });
      }
    } catch {
      // Silently fail
    } finally {
      setSaving(false);
    }
  }

  async function handleGenerateEmail() {
    setGenerating(true);
    setGenerateError(null);

    try {
      const res = await fetch("/api/generate-signup-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prospectData: parsedData,
          connectionMatches,
        }),
      });

      const result = await res.json();

      if (!result.success) {
        throw new Error(result.error || "Failed to generate email");
      }

      const fields: SignupLLMFields = result.fields;

      // Update variables with generated fields
      const updated = {
        ...variables,
        CONNECTION_BLURB: fields.CONNECTION_BLURB || "",
        LOCATION_INVITE: fields.LOCATION_INVITE || "",
        SWAG_OFFER: fields.SWAG_OFFER || "",
      };

      setVariables(updated);
      onVariablesGenerated(updated);
      setHasGenerated(true);
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : "Failed to generate email");
    } finally {
      setGenerating(false);
    }
  }

  async function copyVariables() {
    const lines = [
      "--- Template Variables ---",
      ...SIGNUP_TEMPLATE_VARIABLE_KEYS.map((k) => `${k}: ${variables[k] || ""}`),
      "",
      "--- Apollo Attributes ---",
      ...SIGNUP_APOLLO_VARIABLE_KEYS.map((k) => `${k}: ${variables[k] || ""}`),
      "",
      "--- LLM Generated Fields ---",
      ...SIGNUP_LLM_VARIABLE_KEYS.map((k) => `${k}: ${variables[k] || ""}`),
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard not available
    }
  }

  async function copyEmail() {
    if (activeTab === "variables") return;
    const email = previews[activeTab as keyof SignupEmailSequence];
    const text = `Subject: ${email.subject}\n\n${email.body}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard not available
    }
  }

  const isVariablesTab = activeTab === "variables";

  // Check if any LLM fields have values
  const hasLLMFields = Boolean(
    variables.CONNECTION_BLURB || variables.LOCATION_INVITE || variables.SWAG_OFFER
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-accent">Welcome Email Sequence</h3>
        <div className="flex items-center gap-3">
          <button
            onClick={isVariablesTab ? copyVariables : copyEmail}
            className="inline-flex items-center gap-1.5 text-sm text-primary hover:text-primary-hover font-medium"
          >
            {copied ? (
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
              onClick={() => setActiveTab(key)}
              className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors -mb-px whitespace-nowrap ${
                activeTab === key
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

      {/* Tab Content */}
      <div className="bg-bg-subtle border border-border rounded-lg p-4">
        {isVariablesTab ? (
          <div className="space-y-4">
            {/* Template Variables (used in emails) */}
            <div>
              <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">
                Template Variables
              </p>
              <div className="space-y-3">
                {SIGNUP_TEMPLATE_VARIABLE_KEYS.map((key) => (
                  <div key={key}>
                    <label className="text-xs font-medium text-accent block mb-1">
                      {SIGNUP_VARIABLE_LABELS[key]}
                      <span className="text-text-muted font-normal ml-1">({key})</span>
                    </label>
                    <input
                      type="text"
                      value={variables[key] || ""}
                      onChange={(e) => handleVariableEdit(key, e.target.value)}
                      className="w-full px-3 py-2 text-sm text-text-primary bg-white border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Apollo Attributes (sent to Apollo) */}
            <div className="border-t border-border pt-4">
              <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">
                Apollo Custom Attributes
              </p>
              <div className="space-y-2">
                {SIGNUP_APOLLO_VARIABLE_KEYS.map((key) => (
                  <div key={key} className="flex items-center gap-2">
                    <span className="text-xs font-medium text-text-muted shrink-0 w-32">
                      {SIGNUP_VARIABLE_LABELS[key]}
                    </span>
                    <input
                      type="text"
                      value={variables[key] || ""}
                      onChange={(e) => handleVariableEdit(key, e.target.value)}
                      className="flex-1 px-2 py-1.5 text-sm text-text-primary bg-white border border-border rounded focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Generate Email Button */}
            <div className="border-t border-border pt-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-semibold text-text-muted uppercase tracking-wide">
                  LLM Generated Fields
                </p>
                <button
                  onClick={handleGenerateEmail}
                  disabled={generating}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed rounded-lg transition-colors"
                >
                  {generating ? (
                    <>
                      <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      Generating...
                    </>
                  ) : (
                    <>
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                      {hasGenerated ? "Regenerate" : "Generate Email"}
                    </>
                  )}
                </button>
              </div>

              {generateError && (
                <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                  {generateError}
                </div>
              )}

              {!hasGenerated && !generating && (
                <p className="text-xs text-text-muted mb-3">
                  Click &quot;Generate Email&quot; to create personalized content based on prospect data and connection matches.
                </p>
              )}

              {/* LLM Generated Fields - always show inputs so user can edit */}
              <div className="space-y-3">
                {SIGNUP_LLM_VARIABLE_KEYS.map((key) => (
                  <div key={key}>
                    <label className="text-xs font-medium text-indigo-700 block mb-1">
                      {SIGNUP_VARIABLE_LABELS[key]}
                      <span className="text-indigo-400 font-normal ml-1">({key})</span>
                    </label>
                    <textarea
                      value={variables[key] || ""}
                      onChange={(e) => handleVariableEdit(key, e.target.value)}
                      rows={2}
                      placeholder={
                        !hasGenerated
                          ? "Will be generated..."
                          : "No content generated (criteria not met)"
                      }
                      className={`w-full px-3 py-2 text-sm text-text-primary bg-white border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 resize-y ${
                        hasGenerated && variables[key]
                          ? "border-indigo-300 bg-indigo-50/30"
                          : "border-border"
                      }`}
                    />
                  </div>
                ))}
              </div>

              {hasGenerated && (
                <p className="mt-2 text-xs text-green-600 flex items-center gap-1">
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  Fields generated! You can edit them above before sending.
                </p>
              )}
            </div>
          </div>
        ) : (
          /* Email Preview */
          <div className="space-y-3">
            {!hasGenerated && (
              <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <p className="text-sm text-amber-800 flex items-center gap-2">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  Preview may be incomplete. Go to Variables tab and click &quot;Generate Email&quot; to add personalized content.
                </p>
              </div>
            )}
            <div className="flex items-start gap-2">
              <label className="text-sm font-medium text-accent shrink-0 pt-2">Subject:</label>
              <div className="flex-1 px-3 py-2 text-sm text-text-primary bg-white border border-border rounded-lg">
                {previews[activeTab as keyof SignupEmailSequence].subject}
              </div>
            </div>
            <div className="border-t border-border pt-3">
              <label className="text-sm font-medium text-accent block mb-2">Body:</label>
              <div className="w-full px-3 py-2 text-sm text-text-secondary bg-white border border-border rounded-lg whitespace-pre-wrap font-sans min-h-[200px]">
                {previews[activeTab as keyof SignupEmailSequence].body}
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs text-text-muted">
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Sends {previews[activeTab as keyof SignupEmailSequence].dayOffset} days after signup
            </div>
          </div>
        )}
      </div>

      {/* Unsaved changes bar */}
      {hasUnsavedChanges() && (
        <div className="flex items-center justify-between px-4 py-2 bg-amber-50 border border-amber-200 rounded-lg">
          <span className="text-xs text-amber-600">You have unsaved variable changes</span>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 text-sm font-medium bg-primary hover:bg-primary-hover text-white rounded-lg transition-colors disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      )}

      {/* Continue button - only show after generation */}
      <div className="border-t border-border pt-5">
        {hasGenerated ? (
          <button
            type="button"
            onClick={onContinueToSend}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary hover:bg-primary-hover text-white font-medium rounded-lg transition-colors"
          >
            Send to Apollo
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          </button>
        ) : (
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-gray-200 text-gray-500 font-medium rounded-lg cursor-not-allowed"
            >
              Send to Apollo
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </button>
            <span className="text-xs text-text-muted">
              Generate email first to enable sending
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
