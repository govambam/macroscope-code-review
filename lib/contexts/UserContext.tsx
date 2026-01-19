"use client";

import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from "react";
import { SalesRep, SALES_REPS } from "@/lib/config/users";

const STORAGE_KEY = "macroscope-current-user";

interface UserContextType {
  currentUser: SalesRep | null;
  setCurrentUser: (user: SalesRep | null) => void;
  isUserSelected: boolean;
  salesReps: SalesRep[];
  refreshUsers: () => Promise<void>;
  isLoading: boolean;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

// Convert database user to SalesRep format
interface DbUser {
  id: number;
  name: string;
  initials: string;
  is_active: boolean;
}

function dbUserToSalesRep(user: DbUser): SalesRep {
  // Use database ID as the string id
  return {
    id: String(user.id),
    displayName: user.name,
  };
}

export function UserProvider({ children }: { children: ReactNode }) {
  const [currentUser, setCurrentUserState] = useState<SalesRep | null>(null);
  const [salesReps, setSalesReps] = useState<SalesRep[]>(SALES_REPS);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Fetch users from the database
  const fetchUsers = useCallback(async (): Promise<SalesRep[]> => {
    try {
      const response = await fetch("/api/settings/users");
      const data = await response.json();
      if (data.success && data.users && data.users.length > 0) {
        return data.users.map(dbUserToSalesRep);
      }
    } catch {
      // Fall back to config file
    }
    return SALES_REPS;
  }, []);

  // Refresh users from API
  const refreshUsers = useCallback(async () => {
    setIsLoading(true);
    const users = await fetchUsers();
    setSalesReps(users);

    // If current user is no longer in the list, clear selection
    if (currentUser) {
      const stillExists = users.find((u) => u.id === currentUser.id);
      if (!stillExists) {
        setCurrentUserState(null);
        localStorage.removeItem(STORAGE_KEY);
      }
    }
    setIsLoading(false);
  }, [currentUser, fetchUsers]);

  // Load users and current user on mount
  useEffect(() => {
    const initialize = async () => {
      // Fetch users from database
      const users = await fetchUsers();
      setSalesReps(users);

      // Load stored user from localStorage
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        try {
          const parsedUser = JSON.parse(stored) as SalesRep;
          // Validate that the stored user still exists
          const validUser = users.find((rep) => rep.id === parsedUser.id);
          if (validUser) {
            setCurrentUserState(validUser);
          } else {
            // User no longer exists, clear storage
            localStorage.removeItem(STORAGE_KEY);
          }
        } catch {
          // Invalid JSON, clear storage
          localStorage.removeItem(STORAGE_KEY);
        }
      }

      setIsLoading(false);
      setIsInitialized(true);
    };

    initialize();
  }, [fetchUsers]);

  const setCurrentUser = (user: SalesRep | null) => {
    setCurrentUserState(user);
    if (user) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  };

  // Don't render children until we've initialized
  // This prevents flash of user selection modal
  if (!isInitialized) {
    return null;
  }

  return (
    <UserContext.Provider
      value={{
        currentUser,
        setCurrentUser,
        isUserSelected: currentUser !== null,
        salesReps,
        refreshUsers,
        isLoading,
      }}
    >
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  const context = useContext(UserContext);
  if (context === undefined) {
    throw new Error("useUser must be used within a UserProvider");
  }
  return context;
}
