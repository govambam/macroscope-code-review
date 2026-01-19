"use client";

import { useState } from "react";
import { useUsers, useCreateUser, useUpdateUser, useRemoveUser, User } from "@/lib/hooks/use-settings";
import { useUser } from "@/lib/contexts/UserContext";
import { UserModal } from "./UserModal";

export function TeamManagementSection() {
  const { data: users = [], isLoading: usersLoading } = useUsers();
  const createUserMutation = useCreateUser();
  const updateUserMutation = useUpdateUser();
  const removeUserMutation = useRemoveUser();
  const { currentUser, refreshUsers } = useUser();

  const [modalOpen, setModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [removeConfirmUser, setRemoveConfirmUser] = useState<User | null>(null);
  const [notification, setNotification] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const showNotification = (type: "success" | "error", message: string) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 3000);
  };

  const handleAddNew = () => {
    setEditingUser(null);
    setModalOpen(true);
  };

  const handleEdit = (user: User) => {
    setEditingUser(user);
    setModalOpen(true);
  };

  const handleSave = async (name: string, initials: string) => {
    try {
      if (editingUser) {
        await updateUserMutation.mutateAsync({ id: editingUser.id, name, initials });
        showNotification("success", "Rep updated successfully");
      } else {
        await createUserMutation.mutateAsync({ name, initials });
        showNotification("success", "Rep added successfully");
      }
      // Refresh the user context
      await refreshUsers();
    } catch (error) {
      showNotification("error", error instanceof Error ? error.message : "Failed to save");
      throw error;
    }
  };

  const handleRemoveConfirm = async () => {
    if (!removeConfirmUser) return;

    try {
      await removeUserMutation.mutateAsync(removeConfirmUser.id);
      showNotification("success", "Rep removed");
      setRemoveConfirmUser(null);
      // Refresh the user context
      await refreshUsers();
    } catch (error) {
      showNotification("error", error instanceof Error ? error.message : "Failed to remove");
    }
  };

  const canRemoveUser = (user: User): boolean => {
    // Can't remove the currently logged-in user
    return currentUser?.id !== String(user.id);
  };

  const isMutating = createUserMutation.isPending || updateUserMutation.isPending || removeUserMutation.isPending;

  return (
    <div className="bg-white border border-border rounded-xl shadow-sm p-6">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-accent flex items-center gap-2">
            <span>Team Management</span>
          </h2>
          <p className="mt-1 text-sm text-text-secondary">
            Manage sales reps who use this tool
          </p>
        </div>
        <button
          onClick={handleAddNew}
          disabled={isMutating}
          className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary-hover text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Add New Rep
        </button>
      </div>

      {/* Notification */}
      {notification && (
        <div
          className={`mb-4 p-3 rounded-lg text-sm ${
            notification.type === "success"
              ? "bg-success-light border border-success/20 text-success"
              : "bg-error-light border border-error/20 text-error"
          }`}
        >
          {notification.message}
        </div>
      )}

      {/* Users list */}
      {usersLoading ? (
        <div className="text-center py-8">
          <svg className="animate-spin h-6 w-6 mx-auto text-primary" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        </div>
      ) : users.length === 0 ? (
        <div className="text-center py-8 text-text-muted">
          <p>No team members yet. Add your first rep to get started.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {users.map((user) => (
            <div
              key={user.id}
              className="flex items-center justify-between p-3 rounded-lg border border-border hover:border-primary/30 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-semibold text-sm">
                  {user.initials}
                </div>
                <div>
                  <div className="font-medium text-accent">{user.name}</div>
                  <div className="text-xs text-text-muted">({user.initials})</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleEdit(user)}
                  disabled={isMutating}
                  className="px-3 py-1.5 text-xs font-medium text-text-secondary hover:text-primary hover:bg-primary/5 rounded transition-colors"
                >
                  Edit
                </button>
                <button
                  onClick={() => setRemoveConfirmUser(user)}
                  disabled={isMutating || !canRemoveUser(user)}
                  className="px-3 py-1.5 text-xs font-medium text-text-secondary hover:text-error hover:bg-error/5 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  title={!canRemoveUser(user) ? "Cannot remove current user" : undefined}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add/Edit Modal */}
      <UserModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onSave={handleSave}
        user={editingUser}
        isLoading={createUserMutation.isPending || updateUserMutation.isPending}
        error={
          createUserMutation.error?.message ||
          updateUserMutation.error?.message ||
          null
        }
      />

      {/* Remove Confirmation Dialog */}
      {removeConfirmUser && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-lg max-w-md w-full p-6">
            <h3 className="text-lg font-semibold text-accent mb-2">Remove Team Member</h3>
            <p className="text-sm text-text-secondary mb-2">
              Are you sure you want to remove <span className="font-medium">{removeConfirmUser.name}</span>?
            </p>
            <p className="text-xs text-text-muted mb-4">
              This will not delete their PRs or analyses, but they won&apos;t appear in the user selector.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setRemoveConfirmUser(null)}
                disabled={removeUserMutation.isPending}
                className="px-4 py-2 text-sm font-medium text-text-secondary hover:text-accent transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleRemoveConfirm}
                disabled={removeUserMutation.isPending}
                className="px-4 py-2 bg-error hover:bg-error/90 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {removeUserMutation.isPending && (
                  <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                )}
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
