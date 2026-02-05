"use client";

import React, { useState, useEffect } from "react";
import type { ParsedSignupData } from "@/lib/types/signup-lead";

interface SignupDataReviewProps {
  initialData: ParsedSignupData;
  onSave: (data: ParsedSignupData) => void;
  onBack: () => void;
}

export function SignupDataReview({ initialData, onSave, onBack }: SignupDataReviewProps) {
  const [data, setData] = useState<ParsedSignupData>(initialData);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    setHasChanges(JSON.stringify(data) !== JSON.stringify(initialData));
  }, [data, initialData]);

  function updateField<K extends keyof ParsedSignupData>(field: K, value: ParsedSignupData[K]) {
    setData((prev) => ({ ...prev, [field]: value }));
  }

  function handleContinue() {
    onSave(data);
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
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">LinkedIn URL</label>
            <input
              type="url"
              value={data.linkedinUrl || ""}
              onChange={(e) => updateField("linkedinUrl", e.target.value)}
              className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:ring-2 focus:ring-primary focus:border-primary"
              placeholder="https://linkedin.com/in/..."
            />
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
