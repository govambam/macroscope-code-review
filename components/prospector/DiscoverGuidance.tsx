"use client";

import React, { useState } from "react";

export function DiscoverGuidance() {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="mb-4">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-2 text-sm font-medium text-primary hover:text-primary-hover transition-colors"
      >
        <svg
          className={`w-4 h-4 transition-transform ${expanded ? "rotate-90" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        Tips for Finding Good PRs
      </button>

      {expanded && (
        <div className="mt-3 p-4 bg-blue-50 border border-blue-200 rounded-lg text-sm text-gray-700 space-y-3">
          <div>
            <p className="font-semibold text-gray-800 mb-1">What makes a good candidate PR?</p>
            <ul className="space-y-0.5 text-xs">
              <li className="flex items-start gap-1.5">
                <span className="text-green-600 mt-0.5">&#10003;</span>
                100+ lines changed (shows substantial code changes)
              </li>
              <li className="flex items-start gap-1.5">
                <span className="text-green-600 mt-0.5">&#10003;</span>
                Core functionality (auth, database, API) not just docs or config
              </li>
              <li className="flex items-start gap-1.5">
                <span className="text-green-600 mt-0.5">&#10003;</span>
                Recently opened or closed (last 2 weeks ideal)
              </li>
              <li className="flex items-start gap-1.5">
                <span className="text-green-600 mt-0.5">&#10003;</span>
                Multiple files changed (indicates broader impact)
              </li>
            </ul>
          </div>

          <div>
            <p className="font-semibold text-gray-800 mb-1">How to identify target repositories</p>
            <ul className="space-y-0.5 text-xs text-gray-600">
              <li>&#8226; Look for main product repos (not marketing sites or docs)</li>
              <li>&#8226; Check repo activity: 100+ stars, recent commits</li>
              <li>&#8226; Prefer repos named after the company or core product</li>
            </ul>
          </div>

          <div>
            <p className="font-semibold text-gray-800 mb-1">Red flags to avoid</p>
            <ul className="space-y-0.5 text-xs">
              <li className="flex items-start gap-1.5">
                <span className="text-red-500 mt-0.5">&#10007;</span>
                Documentation-only PRs (readme updates, typo fixes)
              </li>
              <li className="flex items-start gap-1.5">
                <span className="text-red-500 mt-0.5">&#10007;</span>
                Dependency updates (package.json bumps)
              </li>
              <li className="flex items-start gap-1.5">
                <span className="text-red-500 mt-0.5">&#10007;</span>
                Very old PRs (&gt;1 month ago)
              </li>
              <li className="flex items-start gap-1.5">
                <span className="text-red-500 mt-0.5">&#10007;</span>
                Tiny PRs (&lt;50 lines) unless critical bug fixes
              </li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
