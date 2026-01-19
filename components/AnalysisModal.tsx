"use client";

import { useState, useEffect } from "react";
import { Modal } from "./Modal";
import {
  useAnalyzePR,
  useGenerateEmail,
  BugSnippet,
  AnalysisResponse,
} from "@/lib/hooks/use-api";
import { useUser } from "@/lib/contexts/UserContext";
import { getModelShortName } from "@/lib/config/models";

interface AnalysisModalProps {
  isOpen: boolean;
  onClose: () => void;
  prUrl: string | null;
  hasExistingAnalysis?: boolean;
}

type TabType = "analysis" | "email";

export function AnalysisModal({ isOpen, onClose, prUrl, hasExistingAnalysis = false }: AnalysisModalProps) {
  const analyzeMutation = useAnalyzePR();
  const emailMutation = useGenerateEmail();
  const { currentUser } = useUser();

  const [analysisForkedUrl, setAnalysisForkedUrl] = useState("");
  const [analysisOriginalUrl, setAnalysisOriginalUrl] = useState("");
  const [analysisResult, setAnalysisResult] = useState<AnalysisResponse | null>(null);
  const [copiedBugIndex, setCopiedBugIndex] = useState<number | null>(null);
  const [currentAnalysisId, setCurrentAnalysisId] = useState<number | null>(null);
  const [isViewingCached, setIsViewingCached] = useState(false);
  const [expectingCachedResult, setExpectingCachedResult] = useState(false);

  // Tab state
  const [activeTab, setActiveTab] = useState<TabType>("analysis");

  // Email state
  const [generatedEmail, setGeneratedEmail] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailCopied, setEmailCopied] = useState(false);
  const [emailModel, setEmailModel] = useState<string | null>(null);

  // Reset and initialize when modal opens
  useEffect(() => {
    if (isOpen) {
      setAnalysisForkedUrl(prUrl || "");
      setAnalysisOriginalUrl("");
      setAnalysisResult(null);
      setGeneratedEmail(null);
      setEmailError(null);
      setEmailModel(null);
      setCurrentAnalysisId(null);
      setIsViewingCached(false);
      setExpectingCachedResult(hasExistingAnalysis);
      setActiveTab("analysis");

      // Auto-trigger analysis if we have a PR URL
      if (prUrl) {
        // Trigger analysis after a short delay to allow state to settle
        setTimeout(() => {
          handleAnalysisSubmit(prUrl, hasExistingAnalysis);
        }, 100);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, prUrl, hasExistingAnalysis]);

  const handleAnalysisSubmit = async (url?: string, expectCached = false) => {
    const targetUrl = url || analysisForkedUrl;
    if (!targetUrl) return;

    setCopiedBugIndex(null);
    setCurrentAnalysisId(null);
    setIsViewingCached(false);
    setGeneratedEmail(null);
    setEmailError(null);
    setActiveTab("analysis");

    if (!expectCached) {
      setExpectingCachedResult(false);
    }

    analyzeMutation.mutate(
      {
        forkedPrUrl: targetUrl,
        originalPrUrl: analysisOriginalUrl || undefined,
        forceRefresh: false,
        createdByUser: currentUser?.id,
      },
      {
        onSuccess: (data) => {
          setAnalysisResult(data);
          if (data.analysisId) {
            setCurrentAnalysisId(data.analysisId);
          }
          if (data.cached) {
            setIsViewingCached(true);
          }
          if (data.cachedEmail) {
            setGeneratedEmail(data.cachedEmail);
            if (data.emailModel) {
              setEmailModel(data.emailModel);
            }
          }
          setExpectingCachedResult(false);
        },
        onError: (error) => {
          setAnalysisResult({
            success: false,
            error: error instanceof Error ? error.message : "Analysis failed",
          });
          setExpectingCachedResult(false);
        },
      }
    );
  };

  const handleRegenerate = () => {
    setCopiedBugIndex(null);
    setCurrentAnalysisId(null);
    setIsViewingCached(false);
    setGeneratedEmail(null);
    setEmailError(null);
    setEmailModel(null);
    setExpectingCachedResult(false);
    setActiveTab("analysis");

    analyzeMutation.mutate(
      {
        forkedPrUrl: analysisForkedUrl,
        originalPrUrl: analysisOriginalUrl || undefined,
        forceRefresh: true,
        createdByUser: currentUser?.id,
      },
      {
        onSuccess: (data) => {
          setAnalysisResult(data);
          if (data.analysisId) {
            setCurrentAnalysisId(data.analysisId);
          }
          if (data.cached) {
            setIsViewingCached(true);
          }
          if (data.cachedEmail) {
            setGeneratedEmail(data.cachedEmail);
            if (data.emailModel) {
              setEmailModel(data.emailModel);
            }
          }
        },
        onError: (error) => {
          setAnalysisResult({
            success: false,
            error: error instanceof Error ? error.message : "Analysis failed",
          });
        },
      }
    );
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleAnalysisSubmit();
  };

  const copyBugExplanation = async (text: string, index: number) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedBugIndex(index);
      setTimeout(() => setCopiedBugIndex(null), 2000);
    } catch {
      const textArea = document.createElement("textarea");
      textArea.value = text;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand("copy");
      document.body.removeChild(textArea);
      setCopiedBugIndex(index);
      setTimeout(() => setCopiedBugIndex(null), 2000);
    }
  };

  const copyEmail = async () => {
    if (!generatedEmail) return;
    try {
      await navigator.clipboard.writeText(generatedEmail);
      setEmailCopied(true);
      setTimeout(() => setEmailCopied(false), 2000);
    } catch {
      const textArea = document.createElement("textarea");
      textArea.value = generatedEmail;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand("copy");
      document.body.removeChild(textArea);
      setEmailCopied(true);
      setTimeout(() => setEmailCopied(false), 2000);
    }
  };

  const getMostImpactfulBug = (bugs: BugSnippet[]): BugSnippet | null => {
    const mostImpactful = bugs.find((bug) => bug.is_most_impactful);
    return mostImpactful || bugs[0] || null;
  };

  const handleGenerateEmail = async () => {
    if (!analysisResult?.result || !analysisResult.result.meaningful_bugs_found) return;

    const mostImpactfulBug = getMostImpactfulBug(analysisResult.result.bugs);
    if (!mostImpactfulBug) return;

    const originalPrUrl = analysisResult.originalPrUrl;
    if (!originalPrUrl) {
      setEmailError("Could not determine original PR URL. The analysis may need to be regenerated.");
      return;
    }

    setEmailError(null);
    setGeneratedEmail(null);
    setEmailModel(null);
    // Switch to email tab immediately to show loading state
    setActiveTab("email");

    emailMutation.mutate(
      {
        originalPrUrl,
        prTitle: analysisResult.originalPrTitle,
        forkedPrUrl: analysisForkedUrl,
        bug: mostImpactfulBug,
        totalBugs: analysisResult.result.total_macroscope_bugs_found,
        analysisId: currentAnalysisId ?? undefined,
        createdByUser: currentUser?.id,
      },
      {
        onSuccess: (data) => {
          if (data.success && data.email) {
            setGeneratedEmail(data.email);
            if (data.model) {
              setEmailModel(data.model);
            }
          } else {
            setEmailError(data.error || "Failed to generate email");
          }
        },
        onError: (error) => {
          setEmailError(error instanceof Error ? error.message : "Failed to generate email");
        },
      }
    );
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case "critical":
        return "bg-red-100 text-red-800 border-red-200";
      case "high":
        return "bg-orange-100 text-orange-800 border-orange-200";
      case "medium":
        return "bg-yellow-100 text-yellow-800 border-yellow-200";
      default:
        return "bg-gray-100 text-gray-800 border-gray-200";
    }
  };

  const analysisLoading = analyzeMutation.isPending;
  const emailLoading = emailMutation.isPending;

  // Determine if we should show tabs (only when we have meaningful bugs and email exists or is loading)
  const showTabs = analysisResult?.success &&
    analysisResult.result?.meaningful_bugs_found &&
    (generatedEmail || emailLoading || emailError);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="PR Analysis" size="xl" expandable>
      {/* Analysis Form - show if no analysis result yet and not loading with a pre-filled URL */}
      {!analysisResult && !analysisLoading && !prUrl && (
        <form onSubmit={handleFormSubmit} className="space-y-6">
          <div>
            <label htmlFor="analysisForkedUrl" className="block text-sm font-medium text-accent mb-2">
              Forked PR URL <span className="text-error">*</span>
            </label>
            <input
              type="text"
              id="analysisForkedUrl"
              value={analysisForkedUrl}
              onChange={(e) => setAnalysisForkedUrl(e.target.value)}
              placeholder="https://github.com/your-username/repo/pull/1"
              className="w-full px-4 py-3 bg-white border border-border rounded-lg text-black placeholder:text-text-muted focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors"
              required
              disabled={analysisLoading}
            />
            <p className="mt-2 text-sm text-text-muted">
              The PR in your fork that has Macroscope&apos;s review comments
            </p>
          </div>

          <div>
            <label htmlFor="analysisOriginalUrl" className="block text-sm font-medium text-accent mb-2">
              Original PR URL <span className="text-text-muted">(auto-extracted)</span>
            </label>
            <input
              type="text"
              id="analysisOriginalUrl"
              value={analysisOriginalUrl}
              onChange={(e) => setAnalysisOriginalUrl(e.target.value)}
              placeholder="Auto-extracted from PR description"
              className="w-full px-4 py-3 bg-white border border-border rounded-lg text-black placeholder:text-text-muted focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors"
              disabled={analysisLoading}
            />
            <p className="mt-2 text-sm text-text-muted">
              Automatically extracted from the forked PR description. Only fill this if extraction fails.
            </p>
          </div>

          <button
            type="submit"
            disabled={analysisLoading || !analysisForkedUrl}
            className="w-full flex items-center justify-center py-3 px-4 bg-primary hover:bg-primary-hover text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg className="mr-2 h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
            Analyze PR
          </button>
        </form>
      )}

      {/* Loading State */}
      {analysisLoading && (
        <div className="text-center py-12">
          <svg className="animate-spin h-12 w-12 mx-auto text-primary" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <p className="mt-4 text-sm text-text-muted">
            {expectingCachedResult ? "Loading analysis..." : "Analyzing PR with Claude..."}
          </p>
          <p className="mt-2 text-xs text-text-muted">This may take a moment</p>
        </div>
      )}

      {/* Analysis Results */}
      {analysisResult && !analysisLoading && (
        <div className="flex flex-col h-full min-h-0">
          {analysisResult.success && analysisResult.result ? (
            analysisResult.result.meaningful_bugs_found ? (
              // Meaningful bugs found
              <div className="flex flex-col h-full min-h-0 gap-6">
                {/* Tabs - only show when email exists or is loading */}
                {showTabs && (
                  <div className="border-b border-border -mx-6 px-6 shrink-0">
                    <nav className="-mb-px flex gap-6">
                      <button
                        onClick={() => setActiveTab("analysis")}
                        className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                          activeTab === "analysis"
                            ? "border-primary text-primary"
                            : "border-transparent text-text-secondary hover:text-accent hover:border-border"
                        }`}
                      >
                        Analysis
                      </button>
                      <button
                        onClick={() => setActiveTab("email")}
                        className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                          activeTab === "email"
                            ? "border-primary text-primary"
                            : "border-transparent text-text-secondary hover:text-accent hover:border-border"
                        }`}
                      >
                        Email
                        {emailLoading && (
                          <svg className="inline-block ml-2 animate-spin h-3 w-3" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                          </svg>
                        )}
                      </button>
                    </nav>
                  </div>
                )}

                {/* Analysis Tab Content */}
                {activeTab === "analysis" && (
                  <div className="flex flex-col flex-1 min-h-0 gap-6">
                    {/* Bug Summary Header */}
                    <div className="flex items-center justify-between shrink-0">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-orange-100 rounded-lg">
                          <svg className="h-6 w-6 text-orange-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                          </svg>
                        </div>
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="text-lg font-semibold text-accent">Meaningful Bugs Found</h3>
                            {analysisResult.analysisModel && (
                              <span className="px-2 py-0.5 text-xs font-medium bg-purple-100 text-purple-700 rounded">
                                {getModelShortName(analysisResult.analysisModel)}
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-text-secondary">
                            {analysisResult.result.bugs.length} meaningful bug{analysisResult.result.bugs.length !== 1 ? "s" : ""} out of {analysisResult.result.total_macroscope_bugs_found} total issue{analysisResult.result.total_macroscope_bugs_found !== 1 ? "s" : ""} detected
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={handleRegenerate}
                        disabled={analysisLoading}
                        className="flex items-center gap-1.5 text-xs px-3 py-1.5 border border-border text-text-secondary hover:text-accent hover:border-accent rounded-lg transition-colors disabled:opacity-50"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        Regenerate
                      </button>
                    </div>

                    {/* All Bugs List */}
                    <div className="space-y-4 flex-1 min-h-0 overflow-y-auto pr-2">
                      {analysisResult.result.bugs.map((bug, idx) => (
                        <div
                          key={idx}
                          className={`border rounded-lg p-5 ${
                            bug.is_most_impactful
                              ? "border-orange-300 bg-orange-50 ring-2 ring-orange-200"
                              : "border-border bg-bg-subtle"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-4 mb-3">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                {bug.is_most_impactful && (
                                  <span className="px-2 py-0.5 text-xs font-semibold bg-orange-500 text-white rounded">
                                    MOST IMPACTFUL
                                  </span>
                                )}
                              </div>
                              <h4 className="font-semibold text-accent">{bug.title}</h4>
                              <p className="text-sm text-text-muted mt-1 font-mono">
                                {bug.file_path}
                              </p>
                            </div>
                            <span className={`px-2.5 py-1 text-xs font-semibold rounded-full border shrink-0 ${getSeverityColor(bug.severity)}`}>
                              {bug.severity.toUpperCase()}
                            </span>
                          </div>

                          <div className="text-sm text-text-secondary whitespace-pre-wrap leading-relaxed">
                            {bug.explanation}
                          </div>

                          <div className="mt-3 pt-3 border-t border-border/50">
                            <button
                              onClick={() => copyBugExplanation(bug.explanation, idx)}
                              className="flex items-center gap-2 px-3 py-1.5 text-xs text-text-secondary hover:text-accent hover:bg-white rounded transition-colors"
                            >
                              {copiedBugIndex === idx ? (
                                <>
                                  <svg className="h-3.5 w-3.5 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                  </svg>
                                  Copied!
                                </>
                              ) : (
                                <>
                                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                  </svg>
                                  Copy explanation
                                </>
                              )}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Generate Email Button - only show if no email generated yet */}
                    {!generatedEmail && !emailLoading && (
                      <div className="pt-4 border-t border-border shrink-0">
                        <button
                          onClick={handleGenerateEmail}
                          disabled={emailLoading}
                          className="w-full flex items-center justify-center py-2.5 px-4 bg-primary hover:bg-primary-hover text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <svg className="mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                          </svg>
                          Generate Outreach Email
                        </button>
                        <p className="text-xs text-text-muted text-center mt-2">
                          Generate an email using the most impactful bug with Attio merge fields
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* Email Tab Content */}
                {activeTab === "email" && (
                  <div className="flex flex-col flex-1 min-h-0 gap-4">
                    {emailLoading && (
                      <div className="text-center py-12 flex-1 flex flex-col items-center justify-center">
                        <svg className="animate-spin h-10 w-10 mx-auto text-primary" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        <p className="mt-4 text-sm text-text-muted">Generating email with Claude...</p>
                      </div>
                    )}

                    {emailError && !emailLoading && (
                      <div className="p-4 rounded-lg bg-error-light border border-error/20 text-sm text-error">
                        {emailError}
                        <button
                          onClick={handleGenerateEmail}
                          className="mt-3 flex items-center gap-2 px-3 py-1.5 bg-error text-white text-xs font-medium rounded transition-colors hover:bg-error/90"
                        >
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                          Try Again
                        </button>
                      </div>
                    )}

                    {generatedEmail && !emailLoading && (
                      <div className="border border-border rounded-lg bg-white flex-1 min-h-0 flex flex-col">
                        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-bg-subtle rounded-t-lg shrink-0">
                          <div className="flex items-center gap-2">
                            <svg className="h-5 w-5 text-text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                            </svg>
                            <span className="text-sm font-medium text-accent">Generated Email</span>
                            {emailModel && (
                              <span className="px-2 py-0.5 text-xs font-medium bg-purple-100 text-purple-700 rounded">
                                {getModelShortName(emailModel)}
                              </span>
                            )}
                          </div>
                          <button
                            onClick={copyEmail}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-primary text-white hover:bg-primary-hover rounded transition-colors"
                          >
                            {emailCopied ? (
                              <>
                                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                </svg>
                                Copied!
                              </>
                            ) : (
                              <>
                                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                </svg>
                                Copy Email
                              </>
                            )}
                          </button>
                        </div>
                        <div
                          className="p-4 text-sm text-text-secondary whitespace-pre-wrap leading-relaxed flex-1 min-h-0 overflow-y-auto"
                          dangerouslySetInnerHTML={{
                            __html: generatedEmail
                              .replace(/&/g, "&amp;")
                              .replace(/</g, "&lt;")
                              .replace(/>/g, "&gt;")
                              .replace(/\{ (First Name|Company Name|Sender Name) \}/g,
                                '<span class="px-1 py-0.5 bg-purple-100 text-purple-700 rounded font-medium">{ $1 }</span>')
                          }}
                        />
                        <div className="px-4 py-3 border-t border-border bg-purple-50 rounded-b-lg shrink-0">
                          <p className="text-xs text-purple-700">
                            <span className="font-semibold">Attio merge fields:</span> The highlighted placeholders ({"{ First Name }"}, {"{ Company Name }"}, {"{ Sender Name }"}) will be automatically replaced with actual data when you paste this into an Attio sequence.
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Regenerate Email Button */}
                    {generatedEmail && !emailLoading && (
                      <button
                        onClick={handleGenerateEmail}
                        className="flex items-center gap-1.5 text-xs px-3 py-1.5 border border-border text-text-secondary hover:text-accent hover:border-accent rounded-lg transition-colors shrink-0 self-start"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        Regenerate Email
                      </button>
                    )}
                  </div>
                )}
              </div>
            ) : (
              // No meaningful bugs
              <div className="rounded-xl border border-border bg-bg-subtle p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-gray-100 rounded-lg">
                      <svg className="h-6 w-6 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-lg font-semibold text-accent">No Meaningful Bugs Found</h3>
                        {analysisResult.analysisModel && (
                          <span className="px-2 py-0.5 text-xs font-medium bg-purple-100 text-purple-700 rounded">
                            {getModelShortName(analysisResult.analysisModel)}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-text-secondary">
                        The issues found don&apos;t meet the threshold for meaningful bugs.
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={handleRegenerate}
                    disabled={analysisLoading}
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 border border-border text-text-secondary hover:text-accent hover:border-accent rounded-lg transition-colors disabled:opacity-50"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    Regenerate
                  </button>
                </div>
                <p className="text-sm text-text-secondary bg-white border border-border rounded-lg p-4">
                  {analysisResult.result.reason}
                </p>
              </div>
            )
          ) : (
            // Error
            <div className="rounded-xl border border-error/20 bg-error-light p-6">
              <div className="flex items-center gap-2 mb-3">
                <svg className="h-5 w-5 text-error" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <h3 className="text-lg font-semibold text-accent">Analysis Failed</h3>
              </div>
              <p className="text-sm text-text-secondary">{analysisResult.error}</p>
              <button
                onClick={() => handleAnalysisSubmit()}
                className="mt-4 flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary-hover text-white font-medium rounded-lg transition-colors"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Try Again
              </button>
            </div>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="mt-auto pt-4 border-t border-border text-center shrink-0">
        <p className="text-xs text-text-muted">
          Powered by Claude for intelligent bug analysis.
        </p>
      </div>
    </Modal>
  );
}
