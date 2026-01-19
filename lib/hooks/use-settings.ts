import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

// Types
export interface User {
  id: number;
  name: string;
  initials: string;
  is_active: boolean;
  created_at: string;
}

export interface ApiConfig {
  githubToken?: string;
  anthropicApiKey?: string;
  tursoDatabaseUrl?: string;
  tursoAuthToken?: string;
  upstashRedisUrl?: string;
  upstashRedisToken?: string;
}

export interface VersionInfo {
  currentVersion: number;
  totalVersions: number;
  lastEditedBy: string | null;
  lastEditedAt: string | null;
  isDefault: boolean;
  model: string;
}

export interface Prompts {
  prAnalysis: string;
  emailGeneration: string;
}

export interface PromptsWithVersions {
  prompts: Prompts;
  versions: {
    prAnalysis: VersionInfo;
    emailGeneration: VersionInfo;
  };
}

export interface PromptVersion {
  id: number;
  prompt_type: "pr-analysis" | "email-generation";
  content: string;
  edited_by_user_id: number | null;
  edited_by_user_name: string | null;
  is_default: boolean;
  model: string | null;
  created_at: string;
}

// Response types
interface UsersResponse {
  success: boolean;
  users?: User[];
  error?: string;
}

interface CreateUserResponse {
  success: boolean;
  userId?: number;
  error?: string;
}

interface MutationResponse {
  success: boolean;
  error?: string;
}

interface ValidateGitHubResponse {
  success: boolean;
  username?: string;
  error?: string;
}

interface ConfigResponse {
  success: boolean;
  config?: ApiConfig;
  hasEnvVars?: Record<string, boolean>;
  error?: string;
}

interface PromptsResponse {
  success: boolean;
  prompts?: Prompts;
  versions?: {
    prAnalysis: VersionInfo;
    emailGeneration: VersionInfo;
  };
  error?: string;
}

interface PromptVersionsResponse {
  success: boolean;
  versions?: PromptVersion[];
  error?: string;
}

interface PromptVersionResponse {
  success: boolean;
  version?: PromptVersion;
  error?: string;
}

interface RevertPromptResponse {
  success: boolean;
  newVersionId?: number;
  error?: string;
}

interface UpdatePromptResponse {
  success: boolean;
  versionId?: number;
  error?: string;
}

// Query keys
export const settingsQueryKeys = {
  users: ["settings", "users"] as const,
  config: ["settings", "config"] as const,
  prompts: ["settings", "prompts"] as const,
  promptVersions: (type: string) => ["settings", "prompts", "versions", type] as const,
};

// ==================== User Hooks ====================

/**
 * Hook to fetch all active users.
 */
export function useUsers() {
  return useQuery({
    queryKey: settingsQueryKeys.users,
    queryFn: async (): Promise<User[]> => {
      const response = await fetch("/api/settings/users");
      const data: UsersResponse = await response.json();
      if (!data.success) {
        throw new Error(data.error || "Failed to fetch users");
      }
      return data.users || [];
    },
  });
}

/**
 * Hook to create a new user.
 */
export function useCreateUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ name, initials }: { name: string; initials: string }): Promise<number> => {
      const response = await fetch("/api/settings/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, initials }),
      });
      const data: CreateUserResponse = await response.json();
      if (!data.success) {
        throw new Error(data.error || "Failed to create user");
      }
      return data.userId!;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsQueryKeys.users });
    },
  });
}

/**
 * Hook to update a user.
 */
export function useUpdateUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, name, initials }: { id: number; name: string; initials: string }): Promise<void> => {
      const response = await fetch(`/api/settings/users/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, initials }),
      });
      const data: MutationResponse = await response.json();
      if (!data.success) {
        throw new Error(data.error || "Failed to update user");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsQueryKeys.users });
    },
  });
}

/**
 * Hook to remove (deactivate) a user.
 */
export function useRemoveUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: number): Promise<void> => {
      const response = await fetch(`/api/settings/users/${id}`, {
        method: "DELETE",
      });
      const data: MutationResponse = await response.json();
      if (!data.success) {
        throw new Error(data.error || "Failed to remove user");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsQueryKeys.users });
    },
  });
}

// ==================== GitHub Validation Hook ====================

/**
 * Hook to validate a GitHub token.
 */
export function useValidateGitHub() {
  return useMutation({
    mutationFn: async (token: string): Promise<{ username: string }> => {
      const response = await fetch("/api/settings/validate-github", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data: ValidateGitHubResponse = await response.json();
      if (!data.success) {
        throw new Error(data.error || "Validation failed");
      }
      return { username: data.username! };
    },
  });
}

// ==================== Config Hooks ====================

/**
 * Hook to fetch API configuration.
 */
export function useApiConfig() {
  return useQuery({
    queryKey: settingsQueryKeys.config,
    queryFn: async (): Promise<{ config: ApiConfig; hasEnvVars: Record<string, boolean> }> => {
      const response = await fetch("/api/settings/config");
      const data: ConfigResponse = await response.json();
      if (!data.success) {
        throw new Error(data.error || "Failed to fetch config");
      }
      return { config: data.config || {}, hasEnvVars: data.hasEnvVars || {} };
    },
  });
}

/**
 * Hook to update API configuration.
 */
export function useUpdateConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (config: ApiConfig): Promise<void> => {
      const response = await fetch("/api/settings/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config }),
      });
      const data: MutationResponse = await response.json();
      if (!data.success) {
        throw new Error(data.error || "Failed to update config");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsQueryKeys.config });
    },
  });
}

// ==================== Prompts Hooks ====================

/**
 * Hook to fetch prompts with version info.
 */
export function usePrompts() {
  return useQuery({
    queryKey: settingsQueryKeys.prompts,
    queryFn: async (): Promise<PromptsWithVersions> => {
      const response = await fetch("/api/settings/prompts");
      const data: PromptsResponse = await response.json();
      if (!data.success) {
        throw new Error(data.error || "Failed to fetch prompts");
      }
      const defaultModel = "claude-sonnet-4-20250514";
      return {
        prompts: data.prompts || { prAnalysis: "", emailGeneration: "" },
        versions: data.versions || {
          prAnalysis: { currentVersion: 0, totalVersions: 0, lastEditedBy: null, lastEditedAt: null, isDefault: true, model: defaultModel },
          emailGeneration: { currentVersion: 0, totalVersions: 0, lastEditedBy: null, lastEditedAt: null, isDefault: true, model: defaultModel },
        },
      };
    },
  });
}

/**
 * Hook to update a prompt (creates a new version).
 */
export function useUpdatePrompt() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      type,
      content,
      userId,
      model,
    }: {
      type: "pr-analysis" | "email-generation";
      content: string;
      userId?: number;
      model?: string;
    }): Promise<number> => {
      const response = await fetch("/api/settings/prompts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, content, userId, model }),
      });
      const data: UpdatePromptResponse = await response.json();
      if (!data.success) {
        throw new Error(data.error || "Failed to update prompt");
      }
      return data.versionId!;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: settingsQueryKeys.prompts });
      queryClient.invalidateQueries({ queryKey: settingsQueryKeys.promptVersions(variables.type) });
    },
  });
}

/**
 * Hook to fetch all versions of a prompt.
 */
export function usePromptVersions(type: "pr-analysis" | "email-generation") {
  return useQuery({
    queryKey: settingsQueryKeys.promptVersions(type),
    queryFn: async (): Promise<PromptVersion[]> => {
      const response = await fetch(`/api/settings/prompts/versions?type=${type}`);
      const data: PromptVersionsResponse = await response.json();
      if (!data.success) {
        throw new Error(data.error || "Failed to fetch prompt versions");
      }
      return data.versions || [];
    },
  });
}

/**
 * Hook to fetch a specific prompt version.
 */
export function usePromptVersion(id: number | null) {
  return useQuery({
    queryKey: ["settings", "prompts", "version", id],
    queryFn: async (): Promise<PromptVersion | null> => {
      if (!id) return null;
      const response = await fetch(`/api/settings/prompts/versions/${id}`);
      const data: PromptVersionResponse = await response.json();
      if (!data.success) {
        throw new Error(data.error || "Failed to fetch prompt version");
      }
      return data.version || null;
    },
    enabled: !!id,
  });
}

/**
 * Hook to revert a prompt to a specific version or default.
 */
export function useRevertPrompt() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      type,
      versionId,
      userId,
    }: {
      type: "pr-analysis" | "email-generation";
      versionId?: number;  // If undefined, reverts to default
      userId?: number;
    }): Promise<number> => {
      const response = await fetch("/api/settings/prompts/revert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, versionId, userId }),
      });
      const data: RevertPromptResponse = await response.json();
      if (!data.success) {
        throw new Error(data.error || "Failed to revert prompt");
      }
      return data.newVersionId!;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: settingsQueryKeys.prompts });
      queryClient.invalidateQueries({ queryKey: settingsQueryKeys.promptVersions(variables.type) });
    },
  });
}
