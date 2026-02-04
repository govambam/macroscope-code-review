"use client";

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";

export interface SelectedPR {
  url: string;
  owner: string;
  repo: string;
  prNumber: number;
  source: "direct-url" | "discover" | "existing";
  score?: number;
  title?: string;
  additions?: number;
  deletions?: number;
  changed_files?: number;
}

export interface WorkflowState {
  currentStep: number;
  completedSteps: Set<number>;
  collapsedSections: Set<number>;
  selectedPRs: SelectedPR[];
}

interface WorkflowContextValue extends WorkflowState {
  advanceToStep: (step: number) => void;
  markStepComplete: (step: number) => void;
  setSelectedPRs: (prs: SelectedPR[]) => void;
  toggleSectionCollapsed: (step: number) => void;
  scrollToSection: (sectionId: string) => void;
  validateSession: (createdAt: string) => void;
}

const WorkflowContext = createContext<WorkflowContextValue | null>(null);

function getStorageKey(sessionId: string) {
  return `workflow-${sessionId}`;
}

function loadState(sessionId: string): Partial<WorkflowState> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(getStorageKey(sessionId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return {
      currentStep: parsed.currentStep,
      completedSteps: new Set(parsed.completedSteps),
      collapsedSections: new Set(parsed.collapsedSections),
      selectedPRs: parsed.selectedPRs ?? [],
    };
  } catch {
    return null;
  }
}

function saveState(sessionId: string, state: WorkflowState, sessionCreatedAt?: string) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(
      getStorageKey(sessionId),
      JSON.stringify({
        currentStep: state.currentStep,
        completedSteps: Array.from(state.completedSteps),
        collapsedSections: Array.from(state.collapsedSections),
        selectedPRs: state.selectedPRs,
        sessionCreatedAt,
      })
    );
  } catch {
    // sessionStorage full or unavailable
  }
}

const SECTION_IDS = [
  "", // 0 index placeholder
  "select-pr",
  "simulate",
  "analyze",
  "email",
  "send",
];

export function WorkflowProvider({
  sessionId,
  children,
}: {
  sessionId: string;
  children: React.ReactNode;
}) {
  const sessionCreatedAtRef = useRef<string | undefined>(undefined);

  const [state, setState] = useState<WorkflowState>(() => {
    const saved = loadState(sessionId);
    return {
      currentStep: saved?.currentStep ?? 1,
      completedSteps: saved?.completedSteps ?? new Set<number>(),
      collapsedSections: saved?.collapsedSections ?? new Set<number>(),
      selectedPRs: saved?.selectedPRs ?? [],
    };
  });

  const stateRef = useRef(state);
  stateRef.current = state;

  // Persist on change
  useEffect(() => {
    saveState(sessionId, state, sessionCreatedAtRef.current);
  }, [sessionId, state]);

  const scrollToSection = useCallback((sectionId: string) => {
    const el = document.getElementById(sectionId);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);

  const advanceToStep = useCallback(
    (step: number) => {
      setState((prev) => {
        const next = { ...prev, currentStep: step };
        // uncollapse target section
        const collapsed = new Set(prev.collapsedSections);
        collapsed.delete(step);
        next.collapsedSections = collapsed;
        return next;
      });
      // Scroll after a tick so DOM updates
      setTimeout(() => {
        if (SECTION_IDS[step]) {
          scrollToSection(SECTION_IDS[step]);
        }
      }, 100);
    },
    [scrollToSection]
  );

  const markStepComplete = useCallback((step: number) => {
    setState((prev) => {
      const completed = new Set(prev.completedSteps);
      completed.add(step);
      return { ...prev, completedSteps: completed };
    });
  }, []);

  const setSelectedPRs = useCallback((prs: SelectedPR[]) => {
    setState((prev) => ({ ...prev, selectedPRs: prs }));
  }, []);

  const toggleSectionCollapsed = useCallback((step: number) => {
    setState((prev) => {
      const collapsed = new Set(prev.collapsedSections);
      if (collapsed.has(step)) {
        collapsed.delete(step);
      } else {
        collapsed.add(step);
      }
      return { ...prev, collapsedSections: collapsed };
    });
  }, []);

  const validateSession = useCallback(
    (createdAt: string) => {
      if (typeof window === "undefined") return;
      try {
        const raw = sessionStorage.getItem(getStorageKey(sessionId));
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed.sessionCreatedAt && parsed.sessionCreatedAt !== createdAt) {
            // Session ID was reused (e.g. after DB wipe) — clear stale state
            sessionCreatedAtRef.current = createdAt;
            setState({
              currentStep: 1,
              completedSteps: new Set<number>(),
              collapsedSections: new Set<number>(),
              selectedPRs: [],
            });
            return;
          }
        }
      } catch {
        // ignore
      }
      sessionCreatedAtRef.current = createdAt;
    },
    [sessionId]
  );

  return (
    <WorkflowContext.Provider
      value={{
        ...state,
        advanceToStep,
        markStepComplete,
        setSelectedPRs,
        toggleSectionCollapsed,
        scrollToSection,
        validateSession,
      }}
    >
      {children}
    </WorkflowContext.Provider>
  );
}

export function useWorkflow(): WorkflowContextValue {
  const ctx = useContext(WorkflowContext);
  if (!ctx) {
    throw new Error("useWorkflow must be used within a WorkflowProvider");
  }
  return ctx;
}
