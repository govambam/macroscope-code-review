"use client";

import React from "react";

interface SectionHeaderProps {
  stepNumber: number;
  title: string;
  isActive: boolean;
  isCompleted: boolean;
  canCollapse?: boolean;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

export function SectionHeader({
  stepNumber,
  title,
  isActive,
  isCompleted,
  canCollapse = false,
  isCollapsed = false,
  onToggleCollapse,
}: SectionHeaderProps) {
  return (
    <button
      type="button"
      onClick={canCollapse ? onToggleCollapse : undefined}
      className={`w-full flex items-center gap-3 px-5 py-4 rounded-t-xl border-b transition-colors ${
        canCollapse ? "cursor-pointer" : "cursor-default"
      } ${
        isActive
          ? "bg-primary/5 border-primary/20"
          : isCompleted
          ? "bg-green-50 border-green-200"
          : "bg-gray-50 border-border"
      }`}
    >
      {/* Step badge */}
      <span
        className={`flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold shrink-0 ${
          isCompleted
            ? "bg-green-500 text-white"
            : isActive
            ? "bg-primary text-white"
            : "bg-gray-200 text-text-muted"
        }`}
      >
        {isCompleted ? (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          stepNumber
        )}
      </span>

      {/* Title */}
      <span
        className={`text-sm font-semibold ${
          isActive
            ? "text-primary"
            : isCompleted
            ? "text-green-700"
            : "text-text-muted"
        }`}
      >
        {title}
      </span>

      {/* Collapse toggle */}
      {canCollapse && (
        <svg
          className={`ml-auto w-5 h-5 text-text-muted transition-transform ${
            isCollapsed ? "" : "rotate-180"
          }`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      )}
    </button>
  );
}
