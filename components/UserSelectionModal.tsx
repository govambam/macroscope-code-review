"use client";

import { useUser } from "@/lib/contexts/UserContext";
import { SalesRep } from "@/lib/config/users";

export function UserSelectionModal() {
  const { isUserSelected, setCurrentUser, salesReps } = useUser();

  // Don't show if user is already selected
  if (isUserSelected) {
    return null;
  }

  const handleSelectUser = (user: SalesRep) => {
    setCurrentUser(user);
  };

  // Get initials from display name
  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((word) => word[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop - no onClick handler since we don't want to dismiss */}
      <div className="fixed inset-0 bg-black/50 transition-opacity" />

      {/* Modal container */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div
          className="relative w-full max-w-md bg-white rounded-xl shadow-xl transform transition-all"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="px-6 py-5 border-b border-border">
            <h2 className="text-lg font-semibold text-accent">Welcome to Macroscope</h2>
            <p className="mt-1 text-sm text-text-secondary">
              Please select your identity to continue
            </p>
          </div>

          {/* Content */}
          <div className="p-6">
            <p className="text-sm text-text-muted mb-4">
              Select who you are from the list below. This helps track who performs each action.
            </p>

            <div className="space-y-2">
              {salesReps.map((user) => (
                <button
                  key={user.id}
                  onClick={() => handleSelectUser(user)}
                  className="w-full flex items-center gap-3 p-3 rounded-lg border border-border hover:border-primary hover:bg-primary-light transition-colors text-left"
                >
                  <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-semibold text-sm">
                    {getInitials(user.displayName)}
                  </div>
                  <span className="font-medium text-accent">{user.displayName}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
