"use client";

import React from "react";

const STEPS = [
  { number: 1, label: "Select PR" },
  { number: 2, label: "Simulate" },
  { number: 3, label: "Analyze" },
  { number: 4, label: "Email" },
  { number: 5, label: "Send" },
];

interface ProgressStepperProps {
  currentStep: number;
  completedSteps: Set<number>;
  onStepClick: (step: number) => void;
}

export function ProgressStepper({
  currentStep,
  completedSteps,
  onStepClick,
}: ProgressStepperProps) {
  return (
    <div className="flex items-center justify-center gap-0 w-full max-w-2xl mx-auto py-3">
      {STEPS.map((step, i) => {
        const isCompleted = completedSteps.has(step.number);
        const isActive = step.number === currentStep;
        const isClickable = isCompleted;

        return (
          <React.Fragment key={step.number}>
            {/* Step */}
            <button
              type="button"
              disabled={!isClickable}
              onClick={() => isClickable && onStepClick(step.number)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                isClickable ? "cursor-pointer" : "cursor-default"
              } ${
                isActive
                  ? "bg-primary/10 text-primary"
                  : isCompleted
                  ? "bg-green-50 text-green-700 hover:bg-green-100"
                  : "text-text-muted"
              }`}
            >
              <span
                className={`flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold shrink-0 ${
                  isCompleted
                    ? "bg-green-500 text-white"
                    : isActive
                    ? "bg-primary text-white"
                    : "bg-gray-200 text-text-muted"
                }`}
              >
                {isCompleted ? (
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  step.number
                )}
              </span>
              <span className="hidden sm:inline">{step.label}</span>
            </button>

            {/* Arrow connector */}
            {i < STEPS.length - 1 && (
              <svg
                className={`w-4 h-4 shrink-0 ${
                  completedSteps.has(step.number) ? "text-green-400" : "text-gray-300"
                }`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}
