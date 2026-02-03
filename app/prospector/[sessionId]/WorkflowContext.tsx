"use client";

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";

export interface SelectedPR {
  url: string;
  number: number;
  repo: string;
  title?: string;
}

export interface WorkflowState {
  currentStep: number;
  completedSteps: Set<number>;
  collapsedSections: Set<number>;
  selectedPR: SelectedPR | null;
}

interface WorkflowContextValue extends WorkflowState {
  advanceToStep: (step: number) => void;
  markStepComplete: (step: number) => void;
  setSelectedPR: (pr: SelectedPR | null) => void;
  toggleSectionCollapsed: (step: number) => void;
  scrollToSection: (sectionId: string) => void;
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
      selectedPR: parsed.selectedPR,
    };
  } catch {
    return null;
  }
}

function saveState(sessionId: string, state: WorkflowState) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(
      getStorageKey(sessionId),
      JSON.stringify({
        currentStep: state.currentStep,
        completedSteps: Array.from(state.completedSteps),
        collapsedSections: Array.from(state.collapsedSections),
        selectedPR: state.selectedPR,
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
  const [state, setState] = useState<WorkflowState>(() => {
    const saved = loadState(sessionId);
    return {
      currentStep: saved?.currentStep ?? 1,
      completedSteps: saved?.completedSteps ?? new Set<number>(),
      collapsedSections: saved?.collapsedSections ?? new Set<number>(),
      selectedPR: saved?.selectedPR ?? null,
    };
  });

  const stateRef = useRef(state);
  stateRef.current = state;

  // Persist on change
  useEffect(() => {
    saveState(sessionId, state);
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

  const setSelectedPR = useCallback((pr: SelectedPR | null) => {
    setState((prev) => ({ ...prev, selectedPR: pr }));
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

  return (
    <WorkflowContext.Provider
      value={{
        ...state,
        advanceToStep,
        markStepComplete,
        setSelectedPR,
        toggleSectionCollapsed,
        scrollToSection,
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
