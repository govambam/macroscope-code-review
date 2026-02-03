"use client";

import React, { useState, useEffect, useRef } from "react";

interface SessionData {
  id: number;
  company_name: string;
  github_org: string | null;
  notes: string | null;
  status: "in_progress" | "completed";
}

interface EditSessionModalProps {
  session: SessionData;
  open: boolean;
  onClose: () => void;
  onSaved: (updated: SessionData) => void;
}

export function EditSessionModal({ session, open, onClose, onSaved }: EditSessionModalProps) {
  const [companyName, setCompanyName] = useState(session.company_name);
  const [githubOrg, setGithubOrg] = useState(session.github_org ?? "");
  const [notes, setNotes] = useState(session.notes ?? "");
  const [status, setStatus] = useState<"in_progress" | "completed">(session.status);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Sync form when session prop changes
  useEffect(() => {
    setCompanyName(session.company_name);
    setGithubOrg(session.github_org ?? "");
    setNotes(session.notes ?? "");
    setStatus(session.status);
    setError(null);
  }, [session]);

  // Close on escape
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  if (!open) return null;

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!companyName.trim()) {
      setError("Company name is required");
      return;
    }

    setSaving(true);
    setError(null);

    // Optimistic update
    const optimistic: SessionData = {
      ...session,
      company_name: companyName.trim(),
      github_org: githubOrg.trim() || null,
      notes: notes.trim() || null,
      status,
    };
    onSaved(optimistic);

    try {
      const res = await fetch(`/api/sessions/${session.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_name: companyName.trim(),
          github_org: githubOrg.trim() || null,
          notes: notes.trim() || null,
          status,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to update session");
      }

      onClose();
    } catch (err) {
      // Revert optimistic update
      onSaved(session);
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose();
      }}
    >
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4">
        <form onSubmit={handleSave}>
          <div className="px-6 py-4 border-b border-border">
            <h2 className="text-lg font-semibold text-accent">Edit Session Info</h2>
          </div>

          <div className="px-6 py-5 space-y-4">
            {error && (
              <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                {error}
              </div>
            )}

            <div>
              <label htmlFor="edit-company" className="block text-sm font-medium text-accent mb-1">
                Company Name <span className="text-red-500">*</span>
              </label>
              <input
                id="edit-company"
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-border rounded-lg text-sm focus:ring-2 focus:ring-primary focus:border-primary"
                autoCapitalize="words"
              />
            </div>

            <div>
              <label htmlFor="edit-org" className="block text-sm font-medium text-accent mb-1">
                GitHub Organization
              </label>
              <input
                id="edit-org"
                type="text"
                value={githubOrg}
                onChange={(e) => setGithubOrg(e.target.value)}
                placeholder="e.g., vercel, netlify"
                className="w-full px-3 py-2 bg-white border border-border rounded-lg text-sm focus:ring-2 focus:ring-primary focus:border-primary"
              />
            </div>

            <div>
              <label htmlFor="edit-notes" className="block text-sm font-medium text-accent mb-1">
                Notes
              </label>
              <textarea
                id="edit-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="Any context about this company or prospecting effort..."
                className="w-full px-3 py-2 bg-white border border-border rounded-lg text-sm focus:ring-2 focus:ring-primary focus:border-primary resize-none"
              />
            </div>

            <div>
              <label htmlFor="edit-status" className="block text-sm font-medium text-accent mb-1">
                Status
              </label>
              <select
                id="edit-status"
                value={status}
                onChange={(e) => setStatus(e.target.value as "in_progress" | "completed")}
                className="w-full px-3 py-2 bg-white border border-border rounded-lg text-sm focus:ring-2 focus:ring-primary focus:border-primary"
              >
                <option value="in_progress">In Progress</option>
                <option value="completed">Completed</option>
              </select>
            </div>
          </div>

          <div className="px-6 py-4 border-t border-border flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-text-secondary hover:text-accent border border-border rounded-lg hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-sm font-medium text-white bg-primary hover:bg-primary-hover rounded-lg transition-colors disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
