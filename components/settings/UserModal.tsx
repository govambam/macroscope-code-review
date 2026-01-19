"use client";

import { useState, useEffect } from "react";
import { Modal } from "../Modal";
import { User } from "@/lib/hooks/use-settings";

interface UserModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (name: string, initials: string) => Promise<void>;
  user?: User | null;
  isLoading?: boolean;
  error?: string | null;
}

function generateInitials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 0 || !parts[0]) {
    return "";
  }
  if (parts.length === 1) {
    return parts[0].substring(0, 2).toUpperCase();
  }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function UserModal({ isOpen, onClose, onSave, user, isLoading, error }: UserModalProps) {
  const [name, setName] = useState("");
  const [initials, setInitials] = useState("");
  const [initialsManuallySet, setInitialsManuallySet] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const isEditing = !!user;

  // Initialize form when modal opens or user changes
  useEffect(() => {
    if (isOpen) {
      if (user) {
        setName(user.name);
        setInitials(user.initials);
        setInitialsManuallySet(true);
      } else {
        setName("");
        setInitials("");
        setInitialsManuallySet(false);
      }
      setLocalError(null);
    }
  }, [isOpen, user]);

  // Auto-generate initials when name changes (unless manually set)
  useEffect(() => {
    if (!initialsManuallySet && name) {
      setInitials(generateInitials(name));
    }
  }, [name, initialsManuallySet]);

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setName(e.target.value);
    setLocalError(null);
  };

  const handleInitialsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.toUpperCase().slice(0, 3);
    setInitials(value);
    setInitialsManuallySet(true);
    setLocalError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);

    // Validation
    if (!name.trim()) {
      setLocalError("Name is required");
      return;
    }

    if (!initials || initials.length < 2) {
      setLocalError("Initials must be 2-3 characters");
      return;
    }

    try {
      await onSave(name.trim(), initials);
      onClose();
    } catch {
      // Error is handled by parent
    }
  };

  const displayError = error || localError;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={isEditing ? "Edit Rep" : "Add New Rep"} size="md">
      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label htmlFor="userName" className="block text-sm font-medium text-accent mb-2">
            Full Name <span className="text-error">*</span>
          </label>
          <input
            type="text"
            id="userName"
            value={name}
            onChange={handleNameChange}
            placeholder="Jane Doe"
            className="w-full px-4 py-3 bg-white border border-border rounded-lg text-black placeholder:text-text-muted focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors"
            disabled={isLoading}
            autoFocus
          />
        </div>

        <div>
          <label htmlFor="userInitials" className="block text-sm font-medium text-accent mb-2">
            Initials <span className="text-error">*</span>
          </label>
          <input
            type="text"
            id="userInitials"
            value={initials}
            onChange={handleInitialsChange}
            placeholder="JD"
            maxLength={3}
            className="w-full px-4 py-3 bg-white border border-border rounded-lg text-black placeholder:text-text-muted focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors uppercase"
            disabled={isLoading}
          />
          <p className="mt-1 text-xs text-text-muted">
            Auto-generated from name. You can edit it manually (2-3 characters).
          </p>
        </div>

        {displayError && (
          <div className="p-3 rounded-lg bg-error-light border border-error/20 text-sm text-error">
            {displayError}
          </div>
        )}

        <div className="flex gap-3 justify-end pt-4 border-t border-border">
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="px-4 py-2 text-sm font-medium text-text-secondary hover:text-accent transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isLoading || !name.trim() || !initials}
            className="px-4 py-2 bg-primary hover:bg-primary-hover text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isLoading && (
              <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            )}
            Save
          </button>
        </div>
      </form>
    </Modal>
  );
}
