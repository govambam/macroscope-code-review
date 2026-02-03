"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { MobileMenu } from "@/components/MobileMenu";
import { UserMenu } from "@/components/UserMenu";
import { EditSessionModal } from "@/components/EditSessionModal";
import { ProgressStepper } from "@/components/prospector/ProgressStepper";
import { SectionHeader } from "@/components/prospector/SectionHeader";
import { InfoTooltip } from "@/components/prospector/InfoTooltip";
import { DiscoverGuidance } from "@/components/prospector/DiscoverGuidance";
import { DiscoverResults, type DiscoveredPR } from "@/components/prospector/DiscoverResults";
import { parseGitHubPRUrl, parseGitHubRepo } from "@/lib/utils/github-url-parser";
import { WorkflowProvider, useWorkflow, type SelectedPR } from "./WorkflowContext";

interface SessionData {
  id: number;
  company_name: string;
  github_org: string | null;
  github_repo: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  status: "in_progress" | "completed";
  notes: string | null;
  pr_count: number;
  bugs_found: number;
  emails_sent: number;
}

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const seconds = Math.floor((now - then) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ── Confirmation Modal ─────────────────────────────────────────────

interface ConfirmModalProps {
  open: boolean;
  title: string;
  children: React.ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmModal({ open, title, children, confirmLabel, onConfirm, onCancel }: ConfirmModalProps) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onCancel}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-border">
          <h2 className="text-lg font-semibold text-accent">{title}</h2>
        </div>
        <div className="px-6 py-5 text-sm text-text-secondary">{children}</div>
        <div className="px-6 py-4 border-t border-border flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-text-secondary hover:text-accent border border-border rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="px-4 py-2 text-sm font-medium text-white bg-primary hover:bg-primary-hover rounded-lg transition-colors"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Workflow Content ──────────────────────────────────────────

function WorkflowContent({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const workflow = useWorkflow();
  const [editModalOpen, setEditModalOpen] = useState(false);

  // Option A state
  const [prUrl, setPrUrl] = useState("");
  const [prUrlError, setPrUrlError] = useState<string | null>(null);
  const [confirmPr, setConfirmPr] = useState<{ owner: string; repo: string; prNumber: number } | null>(null);

  // Option B state
  const [discoverRepo, setDiscoverRepo] = useState("");
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [discoverResults, setDiscoverResults] = useState<DiscoveredPR[] | null>(null);
  const [discoverRepoName, setDiscoverRepoName] = useState("");
  const [discoverApiError, setDiscoverApiError] = useState<string | null>(null);

  // Multi-PR confirmation
  const [confirmMulti, setConfirmMulti] = useState<SelectedPR[] | null>(null);

  const {
    data,
    isLoading,
    error,
    refetch,
  } = useQuery<{ success: boolean; session: SessionData }>({
    queryKey: ["session", sessionId],
    queryFn: async () => {
      const res = await fetch(`/api/sessions/${sessionId}`);
      if (!res.ok) {
        if (res.status === 404) throw new Error("Session not found");
        throw new Error("Failed to load session");
      }
      return res.json();
    },
  });

  const session = data?.session;

  function handleEditSaved() {
    refetch();
  }

  // ── Option A: Direct URL ─────────────────────────────────────

  function handleSimulatePrUrl() {
    if (!prUrl.trim()) {
      setPrUrlError("Enter a PR URL");
      return;
    }
    const parsed = parseGitHubPRUrl(prUrl.trim());
    if (!parsed.isValid) {
      setPrUrlError(parsed.error ?? "Invalid URL");
      return;
    }
    setConfirmPr(parsed);
  }

  function confirmDirectUrl() {
    if (!confirmPr) return;
    const pr: SelectedPR = {
      url: prUrl.trim(),
      owner: confirmPr.owner,
      repo: confirmPr.repo,
      prNumber: confirmPr.prNumber,
      source: "direct-url",
    };
    workflow.setSelectedPRs([pr]);
    workflow.markStepComplete(1);
    workflow.advanceToStep(2);
    setConfirmPr(null);
    updateSessionRepo(confirmPr.owner, confirmPr.repo);
  }

  // ── Option B: Discover ───────────────────────────────────────

  async function handleDiscover() {
    setDiscoverApiError(null);
    if (!discoverRepo.trim()) {
      setDiscoverError("Enter a repository");
      return;
    }
    const parsed = parseGitHubRepo(discoverRepo.trim());
    if (!parsed.isValid) {
      setDiscoverError(parsed.error ?? "Invalid format");
      return;
    }

    setDiscovering(true);
    setDiscoverResults(null);

    try {
      const res = await fetch("/api/prospector/discover-prs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner: parsed.owner, repo: parsed.repo }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to discover PRs");
      }

      setDiscoverResults(data.prs);
      setDiscoverRepoName(`${parsed.owner}/${parsed.repo}`);
      updateSessionRepo(parsed.owner, parsed.repo);
    } catch (err) {
      setDiscoverApiError(err instanceof Error ? err.message : "Failed to discover PRs");
    } finally {
      setDiscovering(false);
    }
  }

  function handleDiscoverSimulateSingle(pr: DiscoveredPR) {
    const parsed = parseGitHubRepo(discoverRepoName);
    const selected: SelectedPR = {
      url: pr.url,
      owner: parsed.owner,
      repo: parsed.repo,
      prNumber: pr.number,
      source: "discover",
      score: pr.score,
      title: pr.title,
      additions: pr.additions,
      deletions: pr.deletions,
      changed_files: pr.changed_files,
    };
    workflow.setSelectedPRs([selected]);
    workflow.markStepComplete(1);
    workflow.advanceToStep(2);
  }

  function handleDiscoverSimulateMulti(prs: DiscoveredPR[]) {
    const parsed = parseGitHubRepo(discoverRepoName);
    const selected: SelectedPR[] = prs.map((pr) => ({
      url: pr.url,
      owner: parsed.owner,
      repo: parsed.repo,
      prNumber: pr.number,
      source: "discover" as const,
      score: pr.score,
      title: pr.title,
      additions: pr.additions,
      deletions: pr.deletions,
      changed_files: pr.changed_files,
    }));

    if (selected.length > 1) {
      setConfirmMulti(selected);
    } else {
      workflow.setSelectedPRs(selected);
      workflow.markStepComplete(1);
      workflow.advanceToStep(2);
    }
  }

  function confirmMultiSelect() {
    if (!confirmMulti) return;
    workflow.setSelectedPRs(confirmMulti);
    workflow.markStepComplete(1);
    workflow.advanceToStep(2);
    setConfirmMulti(null);
  }

  // ── Session helpers ──────────────────────────────────────────

  function updateSessionRepo(owner: string, repo: string) {
    fetch(`/api/sessions/${sessionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ github_org: owner, github_repo: repo }),
    }).catch(() => {});
  }

  // ── Loading state ────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-32">
        <svg className="animate-spin h-8 w-8 text-primary" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </div>
    );
  }

  // ── Error state ──────────────────────────────────────────────

  if (error || !session) {
    return (
      <div className="flex flex-col items-center justify-center py-32 text-center px-4">
        <svg className="w-12 h-12 text-text-muted mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
        </svg>
        <h3 className="text-lg font-medium text-accent">
          {(error as Error)?.message === "Session not found" ? "Session Not Found" : "Failed to Load Session"}
        </h3>
        <p className="mt-2 text-sm text-text-secondary">
          {(error as Error)?.message === "Session not found"
            ? "This session may have been deleted."
            : "Something went wrong loading this session."}
        </p>
        <button
          onClick={() => router.push("/prospector")}
          className="mt-6 inline-flex items-center gap-1.5 px-4 py-2.5 bg-primary hover:bg-primary-hover text-white text-sm font-medium rounded-lg transition-colors"
        >
          Back to Sessions
        </button>
      </div>
    );
  }

  const sectionStates = [1, 2, 3, 4, 5].map((step) => ({
    isActive: workflow.currentStep === step,
    isCompleted: workflow.completedSteps.has(step),
    isCollapsed: workflow.collapsedSections.has(step),
  }));

  return (
    <>
      {/* Page Header */}
      <div className="bg-white border-b border-border px-4 md:px-8 py-4">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center gap-2 text-sm text-text-secondary mb-3">
            <Link href="/prospector" className="hover:text-accent transition-colors">
              Prospector
            </Link>
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
            <span className="text-accent font-medium">{session.company_name}</span>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <div>
              <h1 className="text-xl md:text-2xl font-semibold text-accent tracking-tight">
                {session.company_name}
              </h1>
              <p className="mt-1 text-sm text-text-secondary">
                Created by @{session.created_by} &middot; Last updated {timeAgo(session.updated_at)}
              </p>
            </div>
            <button
              onClick={() => setEditModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-text-secondary hover:text-accent border border-border rounded-lg hover:bg-gray-50 transition-colors shrink-0"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
              </svg>
              Edit Session Info
            </button>
          </div>
        </div>
      </div>

      {/* Sticky Progress Stepper */}
      <div className="sticky top-0 md:top-0 z-20 bg-white border-b border-border shadow-sm px-4">
        <div className="max-w-5xl mx-auto">
          <ProgressStepper
            currentStep={workflow.currentStep}
            completedSteps={workflow.completedSteps}
            onStepClick={(step) => workflow.advanceToStep(step)}
          />
        </div>
      </div>

      {/* Workflow Sections */}
      <div className="max-w-5xl mx-auto px-4 md:px-8 py-6 space-y-6">

        {/* ── Section 1: Select PR ─────────────────────────────── */}
        <section id="select-pr" className="bg-white border border-border rounded-xl shadow-sm overflow-hidden">
          <SectionHeader
            stepNumber={1}
            title="Select PR to Simulate"
            isActive={sectionStates[0].isActive}
            isCompleted={sectionStates[0].isCompleted}
            canCollapse={sectionStates[0].isCompleted}
            isCollapsed={sectionStates[0].isCollapsed}
            onToggleCollapse={() => workflow.toggleSectionCollapsed(1)}
          />
          {!sectionStates[0].isCollapsed && (
            <div className="p-5">
              {/* Show selected PRs summary if step already completed */}
              {workflow.selectedPRs.length > 0 && sectionStates[0].isCompleted && (
                <div className="mb-5 p-3 bg-green-50 border border-green-200 rounded-lg text-sm">
                  <p className="font-medium text-green-800">
                    {workflow.selectedPRs.length} PR{workflow.selectedPRs.length !== 1 ? "s" : ""} selected
                  </p>
                  <ul className="mt-1 space-y-0.5 text-green-700 text-xs">
                    {workflow.selectedPRs.map((pr) => (
                      <li key={pr.prNumber}>
                        {pr.owner}/{pr.repo} #{pr.prNumber}
                        {pr.title && <span className="text-green-600"> &ndash; {pr.title}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <p className="text-sm text-text-secondary mb-5">Two ways to get started:</p>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                {/* Option A: PR URL */}
                <div className="border border-border rounded-lg p-5">
                  <h3 className="text-sm font-semibold text-accent mb-3">
                    Option A: Already have a PR URL?
                  </h3>
                  <label htmlFor="pr-url" className="block text-sm text-text-secondary mb-1.5">
                    Paste the GitHub PR URL:
                  </label>
                  <input
                    id="pr-url"
                    type="url"
                    value={prUrl}
                    onChange={(e) => {
                      setPrUrl(e.target.value);
                      if (prUrlError) setPrUrlError(null);
                    }}
                    placeholder="https://github.com/owner/repo/pull/123"
                    className={`w-full px-3 py-2 bg-white border rounded-lg text-sm focus:ring-2 focus:ring-primary focus:border-primary ${
                      prUrlError ? "border-red-400" : "border-border"
                    }`}
                  />
                  {prUrlError && <p className="mt-1 text-xs text-red-600">{prUrlError}</p>}
                  <div className="flex items-center justify-between mt-3">
                    <span className="flex items-center gap-1 text-xs text-text-muted">
                      <InfoTooltip content="Look for PRs with 100+ lines changed in core functionality (auth, API, database, not docs)" />
                      Tip: large PRs in core code work best
                    </span>
                    <button
                      type="button"
                      onClick={handleSimulatePrUrl}
                      className="px-4 py-2 text-sm font-medium text-white bg-primary hover:bg-primary-hover rounded-lg transition-colors"
                    >
                      Simulate PR
                    </button>
                  </div>
                </div>

                {/* Option B: Discover */}
                <div className="border border-border rounded-lg p-5">
                  <h3 className="text-sm font-semibold text-accent mb-3">
                    Option B: Discover PRs in a Repository
                  </h3>
                  <DiscoverGuidance />
                  <label htmlFor="discover-repo" className="block text-sm text-text-secondary mb-1.5">
                    Enter repository:
                  </label>
                  <input
                    id="discover-repo"
                    type="text"
                    value={discoverRepo}
                    onChange={(e) => {
                      setDiscoverRepo(e.target.value);
                      if (discoverError) setDiscoverError(null);
                    }}
                    placeholder="owner/repo (e.g., vercel/next.js)"
                    className={`w-full px-3 py-2 bg-white border rounded-lg text-sm focus:ring-2 focus:ring-primary focus:border-primary ${
                      discoverError ? "border-red-400" : "border-border"
                    }`}
                  />
                  {discoverError && <p className="mt-1 text-xs text-red-600">{discoverError}</p>}
                  <div className="flex items-center justify-between mt-3">
                    <span className="flex items-center gap-1 text-xs text-text-muted">
                      <InfoTooltip content="Look for repos with 1000+ stars, active development, and lots of recent PRs" />
                      Tip: active repos with many PRs
                    </span>
                    <button
                      type="button"
                      onClick={handleDiscover}
                      disabled={discovering}
                      className="px-4 py-2 text-sm font-medium text-white bg-primary hover:bg-primary-hover rounded-lg transition-colors disabled:opacity-50"
                    >
                      {discovering ? "Discovering..." : "Discover PRs"}
                    </button>
                  </div>
                </div>
              </div>

              {/* Discover loading */}
              {discovering && (
                <div className="mt-5 flex items-center gap-3 p-4 bg-gray-50 border border-border rounded-lg">
                  <svg className="animate-spin h-5 w-5 text-primary shrink-0" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  <span className="text-sm text-text-secondary">
                    Discovering PRs in {discoverRepo}...
                  </span>
                </div>
              )}

              {/* Discover API error */}
              {discoverApiError && !discovering && (
                <div className="mt-5 p-4 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-sm font-medium text-red-800">{discoverApiError}</p>
                  {discoverApiError.includes("not found") && (
                    <ul className="mt-2 text-xs text-red-700 space-y-0.5">
                      <li>&bull; Check if the repository name is correct</li>
                      <li>&bull; Make sure the repository is public</li>
                    </ul>
                  )}
                </div>
              )}

              {/* Discover results */}
              {discoverResults && !discovering && (
                discoverResults.length > 0 ? (
                  <DiscoverResults
                    prs={discoverResults}
                    repoFullName={discoverRepoName}
                    onSimulateSingle={handleDiscoverSimulateSingle}
                    onSimulateSelected={handleDiscoverSimulateMulti}
                  />
                ) : (
                  <div className="mt-5 p-6 border border-border rounded-lg text-center">
                    <p className="text-sm font-medium text-accent">No PRs found in {discoverRepoName} from the last 30 days.</p>
                    <ul className="mt-3 text-xs text-text-muted space-y-0.5">
                      <li>&bull; Try a more active repository</li>
                      <li>&bull; Check if the repository name is correct</li>
                    </ul>
                  </div>
                )
              )}
            </div>
          )}
        </section>

        {/* ── Section 2: PR Simulation ─────────────────────────── */}
        <section id="simulate" className="bg-white border border-border rounded-xl shadow-sm overflow-hidden">
          <SectionHeader
            stepNumber={2}
            title="PR Simulation"
            isActive={sectionStates[1].isActive}
            isCompleted={sectionStates[1].isCompleted}
            canCollapse={sectionStates[1].isCompleted}
            isCollapsed={sectionStates[1].isCollapsed}
            onToggleCollapse={() => workflow.toggleSectionCollapsed(2)}
          />
          {!sectionStates[1].isCollapsed && (
            <div className="p-5">
              {workflow.selectedPRs.length > 0 && (sectionStates[1].isActive || sectionStates[1].isCompleted) ? (
                <div>
                  <p className="text-sm text-text-secondary mb-3">
                    {workflow.selectedPRs.length} PR{workflow.selectedPRs.length !== 1 ? "s" : ""} ready for simulation.
                  </p>
                  <p className="text-sm text-text-muted italic">Simulation will be implemented in Phase 4.</p>
                </div>
              ) : (
                <p className="text-sm text-text-muted italic">Select a PR above to begin simulation.</p>
              )}
            </div>
          )}
        </section>

        {/* ── Section 3: Analysis ──────────────────────────────── */}
        <section id="analyze" className="bg-white border border-border rounded-xl shadow-sm overflow-hidden">
          <SectionHeader
            stepNumber={3}
            title="Analysis"
            isActive={sectionStates[2].isActive}
            isCompleted={sectionStates[2].isCompleted}
            canCollapse={sectionStates[2].isCompleted}
            isCollapsed={sectionStates[2].isCollapsed}
            onToggleCollapse={() => workflow.toggleSectionCollapsed(3)}
          />
          {!sectionStates[2].isCollapsed && (
            <div className="p-5">
              {sectionStates[2].isActive || sectionStates[2].isCompleted ? (
                <p className="text-sm text-text-secondary">Analysis content will be implemented in Phase 5.</p>
              ) : (
                <p className="text-sm text-text-muted italic">Analysis will appear after simulation completes.</p>
              )}
            </div>
          )}
        </section>

        {/* ── Section 4: Email Generation ──────────────────────── */}
        <section id="email" className="bg-white border border-border rounded-xl shadow-sm overflow-hidden">
          <SectionHeader
            stepNumber={4}
            title="Email Generation"
            isActive={sectionStates[3].isActive}
            isCompleted={sectionStates[3].isCompleted}
            canCollapse={sectionStates[3].isCompleted}
            isCollapsed={sectionStates[3].isCollapsed}
            onToggleCollapse={() => workflow.toggleSectionCollapsed(4)}
          />
          {!sectionStates[3].isCollapsed && (
            <div className="p-5">
              {sectionStates[3].isActive || sectionStates[3].isCompleted ? (
                <p className="text-sm text-text-secondary">Email generation will be implemented in Phase 5.</p>
              ) : (
                <p className="text-sm text-text-muted italic">Email generation will appear after finding bugs.</p>
              )}
            </div>
          )}
        </section>

        {/* ── Section 5: Send to Attio ─────────────────────────── */}
        <section id="send" className="bg-white border border-border rounded-xl shadow-sm overflow-hidden">
          <SectionHeader
            stepNumber={5}
            title="Send to Attio"
            isActive={sectionStates[4].isActive}
            isCompleted={sectionStates[4].isCompleted}
            canCollapse={sectionStates[4].isCompleted}
            isCollapsed={sectionStates[4].isCollapsed}
            onToggleCollapse={() => workflow.toggleSectionCollapsed(5)}
          />
          {!sectionStates[4].isCollapsed && (
            <div className="p-5">
              {sectionStates[4].isActive || sectionStates[4].isCompleted ? (
                <p className="text-sm text-text-secondary">Send to Attio will be implemented in Phase 5.</p>
              ) : (
                <p className="text-sm text-text-muted italic">Ready to send after email generation.</p>
              )}
            </div>
          )}
        </section>
      </div>

      {/* ── Modals ─────────────────────────────────────────────── */}

      {session && (
        <EditSessionModal
          session={session}
          open={editModalOpen}
          onClose={() => setEditModalOpen(false)}
          onSaved={handleEditSaved}
        />
      )}

      {/* Direct URL confirmation */}
      <ConfirmModal
        open={!!confirmPr}
        title="Ready to simulate"
        confirmLabel="Simulate"
        onConfirm={confirmDirectUrl}
        onCancel={() => setConfirmPr(null)}
      >
        {confirmPr && (
          <div className="space-y-2">
            <div className="flex justify-between">
              <span className="text-text-muted">Repository:</span>
              <span className="font-medium text-accent">{confirmPr.owner}/{confirmPr.repo}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-muted">PR #:</span>
              <span className="font-medium text-accent">{confirmPr.prNumber}</span>
            </div>
            <div className="mt-3 pt-3 border-t border-border text-xs text-text-muted">
              This will fork the repository (if not already forked), create a simulated PR, and wait for Macroscope review.
            </div>
          </div>
        )}
      </ConfirmModal>

      {/* Multi-PR confirmation */}
      <ConfirmModal
        open={!!confirmMulti}
        title="Simulate multiple PRs"
        confirmLabel="Start Simulations"
        onConfirm={confirmMultiSelect}
        onCancel={() => setConfirmMulti(null)}
      >
        {confirmMulti && (
          <div className="space-y-3">
            <p>
              You&apos;ve selected <span className="font-semibold text-accent">{confirmMulti.length} PRs</span> to simulate.
            </p>
            <p className="text-xs text-text-muted">
              We&apos;ll simulate them one at a time with a wait between each to avoid GitHub rate limits.
            </p>
            <ul className="text-xs space-y-1 max-h-40 overflow-y-auto">
              {confirmMulti.map((pr) => (
                <li key={pr.prNumber} className="flex items-center gap-2">
                  <span className="text-text-muted">#{pr.prNumber}</span>
                  <span className="truncate">{pr.title}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </ConfirmModal>
    </>
  );
}

// ── Page Component ─────────────────────────────────────────────────

export default function SessionWorkflowPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const resolvedParams = React.use(params);

  return (
    <div className="min-h-screen flex">
      <MobileMenu />

      {/* Left Sidebar */}
      <aside className="hidden md:flex w-64 bg-white border-r border-border flex-col shrink-0 sticky top-0 h-screen overflow-y-auto">
        <div className="h-16 flex items-center px-6 border-b border-border">
          <div className="flex flex-col">
            <span className="text-lg font-semibold text-accent tracking-tight" style={{ fontFamily: 'var(--font-geist-mono)' }}>Code Review Studio</span>
            <span className="text-xs text-text-muted">Powered by <span className="text-primary">Macroscope</span></span>
          </div>
        </div>

        <nav className="flex-1 px-4 py-6">
          <div className="space-y-1">
            <Link
              href="/prospector"
              className="w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-lg bg-primary/10 text-primary"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              Prospector
            </Link>
            <Link
              href="/"
              className="w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-lg text-text-secondary hover:bg-bg-subtle hover:text-accent transition-colors"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              PR Reviews
            </Link>
            <Link
              href="/settings"
              className="w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-lg text-text-secondary hover:bg-bg-subtle hover:text-accent transition-colors"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Settings
            </Link>
          </div>
        </nav>
        <UserMenu />
      </aside>

      {/* Main Content */}
      <main className="flex-1 bg-bg-subtle min-h-screen pt-14 md:pt-0 overflow-y-auto scroll-smooth">
        <WorkflowProvider sessionId={resolvedParams.sessionId}>
          <WorkflowContent sessionId={resolvedParams.sessionId} />
        </WorkflowProvider>
      </main>
    </div>
  );
}
