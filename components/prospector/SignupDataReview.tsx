"use client";

import React, { useState, useEffect, useRef } from "react";
import type { ParsedSignupData, ApolloEnrichmentData } from "@/lib/types/signup-lead";
import type { WorkHistoryEntry, ConnectionMatch } from "@/lib/constants/macroscope-team";
import { findConnectionMatches } from "@/lib/constants/macroscope-team";

interface SignupDataReviewProps {
  initialData: ParsedSignupData;
  initialApolloEnrichment?: ApolloEnrichmentData | null;
  leadId: number | null;
  onSave: (data: ParsedSignupData, apolloContactId?: string | null, connectionMatches?: ConnectionMatch[]) => void;
  onApolloEnrichment?: (enrichment: ApolloEnrichmentData) => void;
  onBack: () => void;
}

export function SignupDataReview({ initialData, initialApolloEnrichment, leadId, onSave, onApolloEnrichment, onBack }: SignupDataReviewProps) {
  const [data, setData] = useState<ParsedSignupData>(initialData);
  const [hasChanges, setHasChanges] = useState(false);

  // Apollo person lookup state
  const [apolloFetching, setApolloFetching] = useState(false);
  const [apolloError, setApolloError] = useState<string | null>(null);
  const [apolloSuccess, setApolloSuccess] = useState(() => !!initialApolloEnrichment);
  const [apolloContactId, setApolloContactId] = useState<string | null>(
    () => initialApolloEnrichment?.apolloContactId ?? null
  );
  const [contactCreated, setContactCreated] = useState(
    () => initialApolloEnrichment?.contactCreated ?? false
  );

  // LinkedIn profile parsing state (fallback)
  const [linkedinProfileText, setLinkedinProfileText] = useState("");
  const [workHistory, setWorkHistory] = useState<WorkHistoryEntry[]>(
    () => initialApolloEnrichment?.workHistory ?? []
  );
  const [connectionMatches, setConnectionMatches] = useState<ConnectionMatch[]>(
    () => (initialApolloEnrichment?.connectionMatches as ConnectionMatch[]) ?? []
  );
  const [linkedinParsing, setLinkedinParsing] = useState(false);
  const [linkedinError, setLinkedinError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showManualEntry, setShowManualEntry] = useState(false);

  useEffect(() => {
    setHasChanges(JSON.stringify(data) !== JSON.stringify(initialData));
  }, [data, initialData]);

  // Auto-fetch from Apollo when we have a LinkedIn URL and haven't already enriched
  const hasAttemptedAutoFetch = useRef(false);
  useEffect(() => {
    if (
      data.linkedinUrl &&
      !apolloSuccess &&
      !apolloFetching &&
      !hasAttemptedAutoFetch.current &&
      !initialApolloEnrichment // Don't auto-fetch if we already have enrichment
    ) {
      hasAttemptedAutoFetch.current = true;
      fetchFromApollo();
    }
  }, [data.linkedinUrl, apolloSuccess, apolloFetching, initialApolloEnrichment]);

  async function fetchFromApollo() {
    if (!data.linkedinUrl) {
      setApolloError("Please enter a LinkedIn URL first");
      return;
    }

    setApolloFetching(true);
    setApolloError(null);
    setApolloSuccess(false);

    try {
      const res = await fetch("/api/apollo/person", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          linkedin_url: data.linkedinUrl,
          create_contact: true, // Auto-create contact if not exists
          email: data.email,
          first_name: data.firstName,
          last_name: data.fullName?.split(" ").slice(1).join(" "),
          organization_name: data.companyName,
        }),
      });

      const result = await res.json();

      if (!result.success) {
        throw new Error(result.error || "Failed to fetch from Apollo");
      }

      const person = result.person;

      // Store the contact ID for later use
      if (person.contactId) {
        setApolloContactId(person.contactId);
      }
      setContactCreated(result.contactCreated || false);

      // Update form fields with Apollo data
      setData((prev) => ({
        ...prev,
        firstName: person.firstName || prev.firstName,
        fullName: person.fullName || prev.fullName,
        email: person.email || prev.email,
        location: person.location || prev.location,
        currentRole: person.title || prev.currentRole,
        companyName: person.organization?.name || prev.companyName,
        companyUrl: person.organization?.domain || prev.companyUrl,
        companySize: person.organization?.employeeCount || prev.companySize,
      }));

      // Convert Apollo employment history to our WorkHistoryEntry format
      let history: WorkHistoryEntry[] = [];
      let matches: ConnectionMatch[] = [];

      if (person.employmentHistory && person.employmentHistory.length > 0) {
        history = person.employmentHistory.map((emp: {
          company: string;
          title: string;
          startDate: string | null;
          endDate: string | null;
        }) => ({
          company: emp.company,
          title: emp.title,
          startDate: emp.startDate || "",
          endDate: emp.endDate || "Present",
        }));

        setWorkHistory(history);

        // Find connection matches with Macroscope team
        matches = findConnectionMatches(history);
        setConnectionMatches(matches);
      }

      setApolloSuccess(true);

      // Save enrichment data
      const enrichment: ApolloEnrichmentData = {
        apolloContactId: person.contactId || null,
        contactCreated: result.contactCreated || false,
        workHistory: history,
        connectionMatches: matches.map(m => ({
          teamMember: m.teamMember,
          teamMemberRole: m.teamMemberRole,
          prospectCompany: m.prospectCompany,
          blurb: m.blurb,
        })),
        enrichedAt: new Date().toISOString(),
      };

      // Notify parent
      if (onApolloEnrichment) {
        onApolloEnrichment(enrichment);
      }

      // Save to database
      if (leadId) {
        try {
          await fetch("/api/signup-lead", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ leadId, apolloEnrichment: enrichment }),
          });
        } catch {
          // Continue even if save fails
        }
      }
    } catch (err) {
      setApolloError(err instanceof Error ? err.message : "Failed to fetch from Apollo");
    } finally {
      setApolloFetching(false);
    }
  }

  async function parseLinkedInProfile(content: string | File) {
    setLinkedinParsing(true);
    setLinkedinError(null);

    try {
      let res: Response;

      if (content instanceof File) {
        // Upload PDF
        const formData = new FormData();
        formData.append("file", content);
        res = await fetch("/api/parse-linkedin-profile", {
          method: "POST",
          body: formData,
        });
      } else {
        // Send text content
        res = await fetch("/api/parse-linkedin-profile", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: content }),
        });
      }

      const result = await res.json();

      if (!result.success) {
        throw new Error(result.error || "Failed to parse LinkedIn profile");
      }

      const history = result.workHistory || [];
      setWorkHistory(history);

      // Find connection matches with Macroscope team
      const matches = findConnectionMatches(history);
      setConnectionMatches(matches);
    } catch (err) {
      setLinkedinError(err instanceof Error ? err.message : "Failed to parse profile");
    } finally {
      setLinkedinParsing(false);
    }
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      parseLinkedInProfile(file);
    }
    // Reset input so same file can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function updateField<K extends keyof ParsedSignupData>(field: K, value: ParsedSignupData[K]) {
    setData((prev) => ({ ...prev, [field]: value }));
  }

  function handleContinue() {
    onSave(data, apolloContactId, connectionMatches);
  }

  // Check if required fields are filled
  const hasRequiredFields = Boolean(data.firstName && data.repositoryName);

  return (
    <div className="space-y-6">
      {/* Validation warning */}
      {!hasRequiredFields && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
          <div className="flex items-center gap-2 text-amber-800">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span className="text-sm font-medium">
              First Name and Repository Name are required for the email sequence.
            </span>
          </div>
        </div>
      )}

      {/* Contact Information */}
      <fieldset className="border border-border rounded-lg p-4">
        <legend className="text-sm font-semibold text-accent px-2">Contact Information</legend>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">
              First Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={data.firstName || ""}
              onChange={(e) => updateField("firstName", e.target.value)}
              className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:ring-2 focus:ring-primary focus:border-primary"
              placeholder="e.g., Deniz"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">Full Name</label>
            <input
              type="text"
              value={data.fullName || ""}
              onChange={(e) => updateField("fullName", e.target.value)}
              className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:ring-2 focus:ring-primary focus:border-primary"
              placeholder="e.g., Deniz Erdal"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">GitHub Username</label>
            <input
              type="text"
              value={data.githubUsername || ""}
              onChange={(e) => updateField("githubUsername", e.target.value)}
              className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:ring-2 focus:ring-primary focus:border-primary"
              placeholder="e.g., denizerdalpendo"
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-text-secondary mb-1">LinkedIn URL</label>
            <div className="flex gap-2">
              <input
                type="url"
                value={data.linkedinUrl || ""}
                onChange={(e) => {
                  updateField("linkedinUrl", e.target.value);
                  setApolloSuccess(false);
                  setApolloError(null);
                  setApolloContactId(null);
                }}
                className={`flex-1 px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-primary focus:border-primary ${
                  apolloSuccess ? "border-green-400 bg-green-50" : "border-border"
                }`}
                placeholder="https://linkedin.com/in/..."
              />
              <button
                type="button"
                onClick={fetchFromApollo}
                disabled={apolloFetching || !data.linkedinUrl}
                className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors whitespace-nowrap ${
                  apolloSuccess
                    ? "text-green-700 bg-green-100 hover:bg-green-200 border border-green-300"
                    : "text-white bg-orange-500 hover:bg-orange-600 disabled:bg-gray-300 disabled:cursor-not-allowed"
                }`}
              >
                {apolloFetching ? (
                  <>
                    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Fetching...
                  </>
                ) : apolloSuccess ? (
                  <>
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    Enriched with Apollo
                  </>
                ) : (
                  <>
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
                    </svg>
                    Fetch from Apollo
                  </>
                )}
              </button>
            </div>
            {apolloError && (
              <p className="mt-1 text-xs text-red-600">{apolloError}</p>
            )}
            {apolloSuccess && (
              <p className="mt-1 text-xs text-green-600 flex items-center gap-1">
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                Profile data and work history fetched
                {contactCreated && " • Contact created in Apollo"}
                {apolloContactId && !contactCreated && " • Contact found in Apollo"}
              </p>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">Location</label>
            <input
              type="text"
              value={data.location || ""}
              onChange={(e) => updateField("location", e.target.value)}
              className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:ring-2 focus:ring-primary focus:border-primary"
              placeholder="e.g., Greater London, England"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">Email</label>
            <input
              type="email"
              value={data.email || ""}
              onChange={(e) => updateField("email", e.target.value)}
              className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:ring-2 focus:ring-primary focus:border-primary"
              placeholder="email@example.com"
            />
          </div>
        </div>
      </fieldset>

      {/* Role Information */}
      <fieldset className="border border-border rounded-lg p-4">
        <legend className="text-sm font-semibold text-accent px-2">Role Information</legend>
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">Current Role</label>
              <input
                type="text"
                value={data.currentRole || ""}
                onChange={(e) => updateField("currentRole", e.target.value)}
                className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:ring-2 focus:ring-primary focus:border-primary"
                placeholder="e.g., Product Design Manager"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">Company</label>
              <input
                type="text"
                value={data.companyName || ""}
                onChange={(e) => updateField("companyName", e.target.value)}
                className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:ring-2 focus:ring-primary focus:border-primary"
                placeholder="e.g., Pendo.io"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">Summary</label>
            <textarea
              value={data.userSummary || ""}
              onChange={(e) => updateField("userSummary", e.target.value)}
              rows={2}
              className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:ring-2 focus:ring-primary focus:border-primary resize-y"
              placeholder="Brief summary about the user..."
            />
          </div>
        </div>
      </fieldset>

      {/* LinkedIn Connection Matching */}
      <fieldset className="border border-purple-200 bg-purple-50/30 rounded-lg p-4">
        <legend className="text-sm font-semibold text-purple-800 px-2">LinkedIn Connection Matching</legend>

        {/* Show results if we have work history (from Apollo or manual) */}
        {workHistory.length === 0 && !apolloSuccess && (
          <p className="text-xs text-text-secondary mb-3">
            Use &quot;Fetch from Apollo&quot; above to automatically get work history, or manually enter it below.
          </p>
        )}

        {/* Manual entry toggle - show when no work history yet */}
        {workHistory.length === 0 && !showManualEntry && (
          <button
            type="button"
            onClick={() => setShowManualEntry(true)}
            className="text-sm text-purple-600 hover:text-purple-800 underline"
          >
            Enter work history manually (paste text or upload PDF)
          </button>
        )}

        {/* Manual entry form */}
        {workHistory.length === 0 && showManualEntry && (
          <div className="space-y-3">
            <textarea
              value={linkedinProfileText}
              onChange={(e) => setLinkedinProfileText(e.target.value)}
              rows={4}
              className="w-full px-3 py-2 text-sm border border-purple-200 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 resize-y bg-white"
              placeholder="Paste LinkedIn work history here (copy from the Experience section)..."
            />

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => parseLinkedInProfile(linkedinProfileText)}
                disabled={linkedinParsing || linkedinProfileText.trim().length < 20}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 disabled:bg-gray-300 disabled:cursor-not-allowed rounded-lg transition-colors"
              >
                {linkedinParsing ? (
                  <>
                    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Parsing...
                  </>
                ) : (
                <>
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                  Parse Text
                </>
              )}
            </button>

            <span className="text-xs text-text-muted">or</span>

            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileUpload}
              accept=".pdf"
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={linkedinParsing}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-purple-700 bg-white border border-purple-300 hover:bg-purple-50 disabled:bg-gray-100 disabled:cursor-not-allowed rounded-lg transition-colors"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              Upload PDF
            </button>

            <button
              type="button"
              onClick={() => setShowManualEntry(false)}
              className="text-xs text-text-muted hover:text-text-secondary"
            >
              Cancel
            </button>
          </div>
        </div>
        )}

        {/* Error message */}
        {linkedinError && (
          <div className="mt-3 p-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {linkedinError}
          </div>
        )}

        {/* Work History Results */}
        {workHistory.length > 0 && (
          <div className="mt-4 space-y-3">
            <h4 className="text-xs font-semibold text-purple-800 uppercase tracking-wide">
              Extracted Work History ({workHistory.length} positions)
            </h4>
            <div className="bg-white border border-purple-200 rounded-lg divide-y divide-purple-100 max-h-48 overflow-y-auto">
              {workHistory.map((entry, idx) => (
                <div key={idx} className="px-3 py-2 text-sm">
                  <div className="font-medium text-accent">{entry.company}</div>
                  <div className="text-text-secondary">{entry.title}</div>
                  <div className="text-xs text-text-muted">{entry.startDate} - {entry.endDate}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Connection Matches */}
        {connectionMatches.length > 0 && (
          <div className="mt-4 space-y-3">
            <h4 className="text-xs font-semibold text-green-800 uppercase tracking-wide flex items-center gap-2">
              <svg className="h-4 w-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Connection Matches Found ({connectionMatches.length})
            </h4>
            <div className="space-y-2">
              {connectionMatches.map((match, idx) => (
                <div key={idx} className="p-3 bg-green-50 border border-green-200 rounded-lg">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium text-green-800">
                      {match.teamMember} ({match.teamMemberRole})
                    </span>
                    <span className="text-xs text-green-600">
                      via {match.prospectCompany}
                    </span>
                  </div>
                  <p className="text-sm text-green-900 italic">&quot;{match.blurb}&quot;</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* No matches message */}
        {workHistory.length > 0 && connectionMatches.length === 0 && (
          <div className="mt-4 p-3 bg-gray-50 border border-gray-200 rounded-lg">
            <p className="text-sm text-text-secondary">
              No connection matches found with the Macroscope team. The prospect&apos;s work history doesn&apos;t overlap with Twitter, Blackboard, Airbnb, Apple, UnitedMasters, or HotelTonight.
            </p>
          </div>
        )}
      </fieldset>

      {/* Company Information */}
      <fieldset className="border border-border rounded-lg p-4">
        <legend className="text-sm font-semibold text-accent px-2">Company Information</legend>
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">Company URL</label>
              <input
                type="text"
                value={data.companyUrl || ""}
                onChange={(e) => updateField("companyUrl", e.target.value)}
                className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:ring-2 focus:ring-primary focus:border-primary"
                placeholder="e.g., pendo.io"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">Total Employees</label>
              <input
                type="number"
                value={data.companySize || ""}
                onChange={(e) => updateField("companySize", e.target.value ? parseInt(e.target.value, 10) : undefined)}
                className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:ring-2 focus:ring-primary focus:border-primary"
                placeholder="e.g., 1053"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">Engineering Count</label>
              <input
                type="number"
                value={data.engineeringCount || ""}
                onChange={(e) => updateField("engineeringCount", e.target.value ? parseInt(e.target.value, 10) : undefined)}
                className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:ring-2 focus:ring-primary focus:border-primary"
                placeholder="e.g., 244"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">Company LinkedIn</label>
              <input
                type="url"
                value={data.companyLinkedIn || ""}
                onChange={(e) => updateField("companyLinkedIn", e.target.value)}
                className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:ring-2 focus:ring-primary focus:border-primary"
                placeholder="https://linkedin.com/company/..."
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">Company Location</label>
              <input
                type="text"
                value={data.companyLocation || ""}
                onChange={(e) => updateField("companyLocation", e.target.value)}
                className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:ring-2 focus:ring-primary focus:border-primary"
                placeholder="e.g., Raleigh, North Carolina"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">Company Description</label>
            <textarea
              value={data.companyDescription || ""}
              onChange={(e) => updateField("companyDescription", e.target.value)}
              rows={2}
              className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:ring-2 focus:ring-primary focus:border-primary resize-y"
              placeholder="Brief description of the company..."
            />
          </div>
        </div>
      </fieldset>

      {/* Signup Context */}
      <fieldset className="border border-border rounded-lg p-4">
        <legend className="text-sm font-semibold text-accent px-2">Signup Context</legend>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">
              Repository Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={data.repositoryName || ""}
              onChange={(e) => updateField("repositoryName", e.target.value)}
              className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:ring-2 focus:ring-primary focus:border-primary"
              placeholder="e.g., open-saas"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">Language</label>
            <input
              type="text"
              value={data.repositoryLanguage || ""}
              onChange={(e) => updateField("repositoryLanguage", e.target.value)}
              className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:ring-2 focus:ring-primary focus:border-primary"
              placeholder="e.g., TypeScript"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">Account Type</label>
            <select
              value={data.accountType || ""}
              onChange={(e) => updateField("accountType", e.target.value as "individual" | "organization" | undefined)}
              className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:ring-2 focus:ring-primary focus:border-primary bg-white"
            >
              <option value="">Select...</option>
              <option value="individual">Individual</option>
              <option value="organization">Organization</option>
            </select>
          </div>
        </div>
      </fieldset>

      {/* Actions */}
      <div className="flex items-center justify-between pt-4 border-t border-border">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-text-secondary border border-border rounded-lg hover:bg-gray-50 transition-colors"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M11 17l-5-5m0 0l5-5m-5 5h12" />
          </svg>
          Back
        </button>

        <div className="flex items-center gap-3">
          {hasChanges && (
            <span className="text-xs text-amber-600">Unsaved changes</span>
          )}
          <button
            type="button"
            onClick={handleContinue}
            disabled={!hasRequiredFields}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary hover:bg-primary-hover disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
          >
            Continue to Email
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
