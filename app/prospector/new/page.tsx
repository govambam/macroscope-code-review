"use client";

import React, { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { MobileMenu } from "@/components/MobileMenu";
import { UserMenu } from "@/components/UserMenu";

interface ApolloAccount {
  id: string;
  name: string;
  domain: string | null;
  website_url: string | null;
}

export default function NewSessionPage() {
  const router = useRouter();
  const [companyName, setCompanyName] = useState("");
  const [githubOrg, setGithubOrg] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);

  // Apollo company search state
  const [apolloAccounts, setApolloAccounts] = useState<ApolloAccount[]>([]);
  const [showCompanyDropdown, setShowCompanyDropdown] = useState(false);
  const [apolloSearching, setApolloSearching] = useState(false);
  const [selectedApolloAccount, setSelectedApolloAccount] = useState<ApolloAccount | null>(null);
  const companyDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const companyContainerRef = useRef<HTMLDivElement>(null);

  // Create new account modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newAccountDomain, setNewAccountDomain] = useState("");
  const [creatingAccount, setCreatingAccount] = useState(false);

  // Org autocomplete state
  const [orgSuggestions, setOrgSuggestions] = useState<Array<{ org: string; prCount: number }>>([]);
  const [showOrgDropdown, setShowOrgDropdown] = useState(false);
  const orgDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const orgContainerRef = useRef<HTMLDivElement>(null);

  function handleCompanyNameChange(value: string) {
    setCompanyName(value);
    if (fieldError) setFieldError(null);

    // Clear selected account if user is editing
    if (selectedApolloAccount && selectedApolloAccount.name !== value) {
      setSelectedApolloAccount(null);
    }

    // Debounce the Apollo search
    if (companyDebounceRef.current) clearTimeout(companyDebounceRef.current);

    if (!value.trim() || value.trim().length < 2) {
      setApolloAccounts([]);
      setShowCompanyDropdown(false);
      return;
    }

    setApolloSearching(true);
    companyDebounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch("/api/apollo/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: value.trim() }),
        });
        const data = await res.json();
        if (data.success && data.accounts) {
          setApolloAccounts(data.accounts);
          setShowCompanyDropdown(true);
        }
      } catch {
        // Silently ignore autocomplete errors
      } finally {
        setApolloSearching(false);
      }
    }, 300);
  }

  function handleSelectApolloAccount(account: ApolloAccount) {
    setCompanyName(account.name);
    setSelectedApolloAccount(account);
    setShowCompanyDropdown(false);
    setApolloAccounts([]);
  }

  function handleOpenCreateModal() {
    setShowCompanyDropdown(false);
    setNewAccountDomain("");
    setShowCreateModal(true);
  }

  async function handleCreateApolloAccount() {
    if (!companyName.trim()) return;

    setCreatingAccount(true);
    try {
      const res = await fetch("/api/apollo/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: companyName.trim(),
          domain: newAccountDomain.trim() || undefined,
        }),
      });
      const data = await res.json();

      if (data.success && data.account) {
        setSelectedApolloAccount(data.account);
        setShowCreateModal(false);
      } else {
        setError(data.error || "Failed to create account in Apollo");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create account");
    } finally {
      setCreatingAccount(false);
    }
  }

  function handleOrgChange(value: string) {
    setGithubOrg(value);

    // Debounce the search
    if (orgDebounceRef.current) clearTimeout(orgDebounceRef.current);

    if (!value.trim()) {
      setOrgSuggestions([]);
      setShowOrgDropdown(false);
      return;
    }

    orgDebounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/orgs/search?q=${encodeURIComponent(value.trim())}`);
        const data = await res.json();
        if (data.success && data.orgs) {
          setOrgSuggestions(data.orgs);
          setShowOrgDropdown(data.orgs.length > 0);
        }
      } catch {
        // Silently ignore autocomplete errors
      }
    }, 300);
  }

  function handleSelectOrg(org: string) {
    setGithubOrg(org);
    setShowOrgDropdown(false);
    setOrgSuggestions([]);
  }

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (orgContainerRef.current && !orgContainerRef.current.contains(event.target as Node)) {
        setShowOrgDropdown(false);
      }
      if (companyContainerRef.current && !companyContainerRef.current.contains(event.target as Node)) {
        setShowCompanyDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Cleanup debounce timeouts on unmount
  useEffect(() => {
    return () => {
      if (orgDebounceRef.current) clearTimeout(orgDebounceRef.current);
      if (companyDebounceRef.current) clearTimeout(companyDebounceRef.current);
    };
  }, []);

  function highlightMatch(text: string, query: string): React.ReactNode {
    if (!query) return text;
    const idx = text.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return text;
    return (
      <>
        {text.slice(0, idx)}
        <span className="font-semibold text-accent">{text.slice(idx, idx + query.length)}</span>
        {text.slice(idx + query.length)}
      </>
    );
  }

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
          apollo_account_id: selectedApolloAccount?.id || undefined,
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

              {/* Company Name with Apollo Search */}
              <div ref={companyContainerRef} className="relative">
                <label htmlFor="company-name" className="block text-sm font-medium text-accent mb-1">
                  Company Name <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <input
                    id="company-name"
                    type="text"
                    value={companyName}
                    onChange={(e) => handleCompanyNameChange(e.target.value)}
                    onFocus={() => {
                      if (apolloAccounts.length > 0 && !selectedApolloAccount) {
                        setShowCompanyDropdown(true);
                      }
                    }}
                    placeholder="e.g., Astronomer, Vercel, Netlify"
                    autoCapitalize="words"
                    autoComplete="off"
                    autoFocus
                    className={`w-full px-3 py-2 bg-white border rounded-lg text-sm focus:ring-2 focus:ring-primary focus:border-primary ${
                      fieldError ? "border-red-400" : selectedApolloAccount ? "border-green-400" : "border-border"
                    }`}
                  />
                  {apolloSearching && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      <svg className="animate-spin h-4 w-4 text-text-muted" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                    </div>
                  )}
                  {selectedApolloAccount && !apolloSearching && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      <svg className="h-4 w-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                  )}
                </div>

                {/* Apollo search dropdown */}
                {showCompanyDropdown && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-border rounded-lg shadow-lg z-30 max-h-[280px] overflow-y-auto">
                    {apolloAccounts.length > 0 ? (
                      <>
                        {apolloAccounts.map((account) => (
                          <button
                            key={account.id}
                            type="button"
                            onClick={() => handleSelectApolloAccount(account)}
                            className="w-full px-3 py-2.5 text-left hover:bg-bg-subtle transition-colors flex items-center gap-3 border-b border-border last:border-b-0"
                          >
                            <div className="h-8 w-8 bg-primary/10 rounded-lg flex items-center justify-center flex-shrink-0">
                              <span className="text-sm font-semibold text-primary">
                                {account.name.charAt(0).toUpperCase()}
                              </span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium text-accent truncate">
                                {highlightMatch(account.name, companyName)}
                              </div>
                              {account.domain && (
                                <div className="text-xs text-text-muted truncate">{account.domain}</div>
                              )}
                            </div>
                            <span className="text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded-full shrink-0">
                              In Apollo
                            </span>
                          </button>
                        ))}
                        <button
                          type="button"
                          onClick={handleOpenCreateModal}
                          className="w-full px-3 py-2.5 text-left hover:bg-primary/5 transition-colors flex items-center gap-3 border-t border-border bg-gray-50"
                        >
                          <div className="h-8 w-8 border-2 border-dashed border-primary/40 rounded-lg flex items-center justify-center flex-shrink-0">
                            <svg className="h-4 w-4 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                            </svg>
                          </div>
                          <div className="flex-1">
                            <div className="text-sm font-medium text-primary">
                              Add &quot;{companyName}&quot; to Apollo
                            </div>
                            <div className="text-xs text-text-muted">Create a new account</div>
                          </div>
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={handleOpenCreateModal}
                        className="w-full px-3 py-3 text-left hover:bg-primary/5 transition-colors flex items-center gap-3"
                      >
                        <div className="h-8 w-8 border-2 border-dashed border-primary/40 rounded-lg flex items-center justify-center flex-shrink-0">
                          <svg className="h-4 w-4 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                          </svg>
                        </div>
                        <div className="flex-1">
                          <div className="text-sm font-medium text-primary">
                            Add &quot;{companyName}&quot; to Apollo
                          </div>
                          <div className="text-xs text-text-muted">No matches found - create a new account</div>
                        </div>
                      </button>
                    )}
                  </div>
                )}

                {fieldError && (
                  <p className="mt-1 text-xs text-red-600">{fieldError}</p>
                )}
                {selectedApolloAccount && (
                  <p className="mt-1 text-xs text-green-600 flex items-center gap-1">
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    Linked to Apollo account{selectedApolloAccount.domain ? ` (${selectedApolloAccount.domain})` : ""}
                  </p>
                )}
                {!selectedApolloAccount && !fieldError && (
                  <p className="mt-1 text-xs text-text-muted">
                    Search for existing Apollo accounts or create a new one
                  </p>
                )}
              </div>

              {/* GitHub Organization */}
              <div ref={orgContainerRef} className="relative">
                <label htmlFor="github-org" className="block text-sm font-medium text-accent mb-1">
                  GitHub Organization
                </label>
                <input
                  id="github-org"
                  type="text"
                  value={githubOrg}
                  onChange={(e) => handleOrgChange(e.target.value)}
                  onFocus={() => {
                    if (orgSuggestions.length > 0) setShowOrgDropdown(true);
                  }}
                  placeholder="e.g., vercel, netlify (optional)"
                  autoComplete="off"
                  className="w-full px-3 py-2 bg-white border border-border rounded-lg text-sm focus:ring-2 focus:ring-primary focus:border-primary"
                />
                {showOrgDropdown && orgSuggestions.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-border rounded-lg shadow-lg z-30 max-h-[240px] overflow-y-auto">
                    {orgSuggestions.map((s) => (
                      <button
                        key={s.org}
                        type="button"
                        onClick={() => handleSelectOrg(s.org)}
                        className="w-full px-3 py-2 text-left hover:bg-bg-subtle transition-colors flex items-center gap-2 border-b border-border last:border-b-0"
                      >
                        <svg className="h-4 w-4 text-text-muted flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                        </svg>
                        <span className="text-sm flex-1 truncate">
                          {highlightMatch(s.org, githubOrg)}
                        </span>
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700 shrink-0">
                          {s.prCount} PR{s.prCount !== 1 ? "s" : ""}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
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

      {/* Create Apollo Account Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setShowCreateModal(false)}
          />
          <div className="relative bg-white rounded-xl shadow-xl max-w-md w-full mx-4 p-6">
            <h2 className="text-lg font-semibold text-accent mb-1">
              Add to Apollo
            </h2>
            <p className="text-sm text-text-secondary mb-4">
              Create a new account for &quot;{companyName}&quot; in Apollo.
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-accent mb-1">
                  Company Name
                </label>
                <input
                  type="text"
                  value={companyName}
                  disabled
                  className="w-full px-3 py-2 bg-gray-50 border border-border rounded-lg text-sm text-text-secondary"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-accent mb-1">
                  Domain <span className="text-text-muted font-normal">(optional)</span>
                </label>
                <input
                  type="text"
                  value={newAccountDomain}
                  onChange={(e) => setNewAccountDomain(e.target.value)}
                  placeholder="e.g., pendo.io"
                  className="w-full px-3 py-2 bg-white border border-border rounded-lg text-sm focus:ring-2 focus:ring-primary focus:border-primary"
                />
                <p className="mt-1 text-xs text-text-muted">
                  Adding a domain helps Apollo enrich the account with additional data
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="px-4 py-2 text-sm font-medium text-text-secondary border border-border rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreateApolloAccount}
                disabled={creatingAccount}
                className="px-4 py-2 text-sm font-medium text-white bg-primary hover:bg-primary-hover rounded-lg transition-colors disabled:opacity-50"
              >
                {creatingAccount ? "Creating..." : "Create Account"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
