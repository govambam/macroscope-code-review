"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { MobileMenu } from "@/components/MobileMenu";
import { UserMenu } from "@/components/UserMenu";

export default function NewSessionPage() {
  const router = useRouter();
  const [companyName, setCompanyName] = useState("");
  const [githubOrg, setGithubOrg] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFieldError(null);
    setError(null);

    if (!companyName.trim()) {
      setFieldError("Company name is required");
      return;
    }

    setSubmitting(true);

    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_name: companyName.trim(),
          github_org: githubOrg.trim() || undefined,
          notes: notes.trim() || undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to create session");
      }

      router.push(`/prospector/${data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create session");
      setSubmitting(false);
    }
  }

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
      <main className="flex-1 bg-bg-subtle min-h-screen pt-14 md:pt-0">
        <div className="max-w-xl mx-auto px-4 md:px-8 py-8 md:py-16">
          {/* Back link */}
          <Link
            href="/prospector"
            className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-accent transition-colors mb-8"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Back to Sessions
          </Link>

          {/* Form card */}
          <div className="bg-white border border-border rounded-xl shadow-sm">
            <div className="px-6 py-5 border-b border-border">
              <h1 className="text-xl font-semibold text-accent">New Prospecting Session</h1>
              <p className="mt-1 text-sm text-text-secondary">Start a guided session to find and engage with a company.</p>
            </div>

            <form onSubmit={handleSubmit} className="px-6 py-5 space-y-5">
              {error && (
                <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                  {error}
                </div>
              )}

              {/* Company Name */}
              <div>
                <label htmlFor="company-name" className="block text-sm font-medium text-accent mb-1">
                  Company Name <span className="text-red-500">*</span>
                </label>
                <input
                  id="company-name"
                  type="text"
                  value={companyName}
                  onChange={(e) => {
                    setCompanyName(e.target.value);
                    if (fieldError) setFieldError(null);
                  }}
                  placeholder="e.g., Astronomer, Vercel, Netlify"
                  autoCapitalize="words"
                  autoFocus
                  className={`w-full px-3 py-2 bg-white border rounded-lg text-sm focus:ring-2 focus:ring-primary focus:border-primary ${
                    fieldError ? "border-red-400" : "border-border"
                  }`}
                />
                {fieldError && (
                  <p className="mt-1 text-xs text-red-600">{fieldError}</p>
                )}
              </div>

              {/* GitHub Organization */}
              <div>
                <label htmlFor="github-org" className="block text-sm font-medium text-accent mb-1">
                  GitHub Organization
                </label>
                <input
                  id="github-org"
                  type="text"
                  value={githubOrg}
                  onChange={(e) => setGithubOrg(e.target.value)}
                  placeholder="e.g., vercel, netlify (optional)"
                  className="w-full px-3 py-2 bg-white border border-border rounded-lg text-sm focus:ring-2 focus:ring-primary focus:border-primary"
                />
                <p className="mt-1 text-xs text-text-muted">
                  If you know their GitHub org, add it here. This helps with context but is optional.
                </p>
              </div>

              {/* Notes */}
              <div>
                <label htmlFor="notes" className="block text-sm font-medium text-accent mb-1">
                  Notes
                </label>
                <textarea
                  id="notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Any context about this company or prospecting effort..."
                  rows={3}
                  className="w-full px-3 py-2 bg-white border border-border rounded-lg text-sm focus:ring-2 focus:ring-primary focus:border-primary resize-none"
                />
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-3 pt-2">
                <Link
                  href="/prospector"
                  className="px-4 py-2.5 text-sm font-medium text-text-secondary hover:text-accent border border-border rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </Link>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2.5 text-sm font-medium text-white bg-primary hover:bg-primary-hover rounded-lg transition-colors disabled:opacity-50"
                >
                  {submitting ? "Creating..." : "Start Prospecting"}
                </button>
              </div>
            </form>
          </div>
        </div>
      </main>
    </div>
  );
}
