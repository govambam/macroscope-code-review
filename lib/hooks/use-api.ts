import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

// Types
export interface BugSnippet {
  title: string;
  explanation: string;
  file_path: string;
  severity: "critical" | "high" | "medium";
  is_most_impactful: boolean;
}

interface NoMeaningfulBugsResult {
  meaningful_bugs_found: false;
  reason: string;
}

interface MeaningfulBugsResult {
  meaningful_bugs_found: true;
  bugs: BugSnippet[];
  total_macroscope_bugs_found: number;
}

export type PRAnalysisResult = NoMeaningfulBugsResult | MeaningfulBugsResult;

export interface PRRecord {
  prNumber: number;
  prUrl: string;
  prTitle: string;
  createdAt: string;
  commitCount: number;
  state: string;
  branchName: string;
  macroscopeBugs?: number;
  hasAnalysis?: boolean;
  analysisId?: number | null;
  createdByUser?: string | null;
  analyzedAt?: string | null;
}

export interface ForkRecord {
  repoName: string;
  forkUrl: string;
  createdAt: string;
  prs: PRRecord[];
}

export interface AnalysisResponse {
  success: boolean;
  result?: PRAnalysisResult;
  error?: string;
  forkedPrUrl?: string;
  originalPrUrl?: string;
  originalPrTitle?: string;
  cached?: boolean;
  analysisId?: number;
  cachedEmail?: string;
  analysisModel?: string;
  emailModel?: string;
}

interface ForksResponse {
  success: boolean;
  forks: ForkRecord[];
  error?: string;
  source?: string;
}

interface DeleteResponse {
  success: boolean;
  deletedRepos: string[];
  deletedPRs: { repo: string; prNumber: number }[];
  errors: string[];
}

interface CheckBugsResponse {
  success: boolean;
  bugCount: number;
}

interface EmailResponse {
  success: boolean;
  email?: string;
  error?: string;
  emailId?: number;
  model?: string;
}

// Query keys
export const queryKeys = {
  forks: ["forks"] as const,
  forksFromDb: ["forks", "db"] as const,
  forksFromGitHub: ["forks", "github"] as const,
  analysis: (url: string) => ["analysis", url] as const,
};

/**
 * Hook to fetch forks from database (fast, cached)
 */
export function useForksFromDb() {
  return useQuery({
    queryKey: queryKeys.forksFromDb,
    queryFn: async (): Promise<ForkRecord[]> => {
      const response = await fetch("/api/forks?source=db");
      const data: ForksResponse = await response.json();
      if (!data.success) {
        throw new Error(data.error || "Failed to fetch forks");
      }
      return data.forks;
    },
  });
}

/**
 * Hook to refresh forks from GitHub (slower, updates cache)
 */
export function useRefreshForksFromGitHub() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (): Promise<ForkRecord[]> => {
      const response = await fetch("/api/forks");
      const data: ForksResponse = await response.json();
      if (!data.success) {
        throw new Error(data.error || "Failed to fetch forks");
      }
      return data.forks;
    },
    onSuccess: (forks) => {
      // Update the cached forks data
      queryClient.setQueryData(queryKeys.forksFromDb, forks);
    },
  });
}

/**
 * Hook to check bug count for a single PR
 */
export function useCheckPRBugs() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      repoName,
      prNumber,
    }: {
      repoName: string;
      prNumber: number;
    }): Promise<{ repoName: string; prNumber: number; bugCount: number }> => {
      const response = await fetch("/api/forks/check-bugs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoName, prNumber }),
      });
      const data: CheckBugsResponse = await response.json();
      if (!data.success) {
        throw new Error("Failed to check bugs");
      }
      return { repoName, prNumber, bugCount: data.bugCount };
    },
    onSuccess: ({ repoName, prNumber, bugCount }) => {
      // Update the specific PR in the cached forks data
      queryClient.setQueryData(queryKeys.forksFromDb, (oldData: ForkRecord[] | undefined) => {
        if (!oldData) return oldData;
        return oldData.map((fork) => {
          if (fork.repoName === repoName) {
            return {
              ...fork,
              prs: fork.prs.map((pr) => {
                if (pr.prNumber === prNumber) {
                  return { ...pr, macroscopeBugs: bugCount };
                }
                return pr;
              }),
            };
          }
          return fork;
        });
      });
    },
  });
}

/**
 * Hook to delete forks/PRs
 */
export function useDeleteForksAndPRs() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      repos,
      prs,
    }: {
      repos: string[];
      prs: { repo: string; prNumber: number; branchName: string }[];
    }): Promise<DeleteResponse> => {
      const response = await fetch("/api/forks", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repos, prs }),
      });
      const data: DeleteResponse = await response.json();
      return data;
    },
    onSuccess: (data) => {
      // Update cached forks data by removing deleted items
      queryClient.setQueryData(queryKeys.forksFromDb, (oldData: ForkRecord[] | undefined) => {
        if (!oldData) return oldData;

        let updatedForks = [...oldData];

        // Remove deleted repos
        updatedForks = updatedForks.filter(
          (f) => !data.deletedRepos.includes(f.repoName)
        );

        // Remove deleted PRs
        data.deletedPRs.forEach((deleted) => {
          const forkIndex = updatedForks.findIndex(
            (f) => f.repoName === deleted.repo
          );
          if (forkIndex !== -1) {
            updatedForks[forkIndex] = {
              ...updatedForks[forkIndex],
              prs: updatedForks[forkIndex].prs.filter(
                (pr) => pr.prNumber !== deleted.prNumber
              ),
            };
            // Remove fork if no PRs left
            if (updatedForks[forkIndex].prs.length === 0) {
              updatedForks.splice(forkIndex, 1);
            }
          }
        });

        return updatedForks;
      });
    },
  });
}

/**
 * Hook to analyze a PR
 */
export function useAnalyzePR() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      forkedPrUrl,
      originalPrUrl,
      forceRefresh = false,
      createdByUser,
    }: {
      forkedPrUrl: string;
      originalPrUrl?: string;
      forceRefresh?: boolean;
      createdByUser?: string;
    }): Promise<AnalysisResponse> => {
      const response = await fetch("/api/analyze-pr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ forkedPrUrl, originalPrUrl, forceRefresh, createdByUser }),
      });
      const data: AnalysisResponse = await response.json();
      return data;
    },
    onSuccess: (data, variables) => {
      // Cache the analysis result
      if (data.success) {
        queryClient.setQueryData(
          queryKeys.analysis(variables.forkedPrUrl),
          data
        );

        // Update forks to mark this PR as having an analysis
        if (data.analysisId) {
          queryClient.setQueryData(queryKeys.forksFromDb, (oldData: ForkRecord[] | undefined) => {
            if (!oldData) return oldData;
            return oldData.map((fork) => ({
              ...fork,
              prs: fork.prs.map((pr) => {
                if (pr.prUrl === variables.forkedPrUrl) {
                  return { ...pr, hasAnalysis: true, analysisId: data.analysisId };
                }
                return pr;
              }),
            }));
          });
        }
      }
    },
  });
}

/**
 * Hook to get cached analysis for a PR URL
 */
export function useCachedAnalysis(forkedPrUrl: string | null) {
  return useQuery({
    queryKey: queryKeys.analysis(forkedPrUrl || ""),
    queryFn: async (): Promise<AnalysisResponse | null> => {
      if (!forkedPrUrl) return null;
      // This will be populated by useAnalyzePR mutation
      return null;
    },
    enabled: false, // Don't auto-fetch, only use cached data
  });
}

/**
 * Hook to generate email
 */
export function useGenerateEmail() {
  return useMutation({
    mutationFn: async ({
      originalPrUrl,
      prTitle,
      forkedPrUrl,
      bug,
      totalBugs,
      analysisId,
      createdByUser,
    }: {
      originalPrUrl: string;
      prTitle?: string;
      forkedPrUrl: string;
      bug: BugSnippet;
      totalBugs: number;
      analysisId?: number;
      createdByUser?: string;
    }): Promise<EmailResponse> => {
      const response = await fetch("/api/generate-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          originalPrUrl,
          prTitle,
          forkedPrUrl,
          bug,
          totalBugs,
          analysisId,
          createdByUser,
        }),
      });
      const data: EmailResponse = await response.json();
      return data;
    },
  });
}

/**
 * Hook to add a newly created PR to the forks cache
 */
export function useAddCreatedPR() {
  const queryClient = useQueryClient();

  return (prUrl: string, forkUrl: string, prTitle: string, commitCount: number) => {
    // Parse PR URL to extract repo name and PR number
    const prMatch = prUrl.match(/github\.com\/[\w.-]+\/([\w.-]+)\/pull\/(\d+)/);
    if (!prMatch) return;

    const repoName = prMatch[1];
    const prNumber = parseInt(prMatch[2], 10);

    const newPR: PRRecord = {
      prNumber,
      prUrl,
      prTitle,
      createdAt: new Date().toISOString(),
      commitCount,
      state: "open",
      branchName: `review-pr-${prNumber}`,
      macroscopeBugs: undefined,
    };

    queryClient.setQueryData(queryKeys.forksFromDb, (oldData: ForkRecord[] | undefined) => {
      if (!oldData) {
        // Create new array with just this fork
        return [{
          repoName,
          forkUrl,
          createdAt: new Date().toISOString(),
          prs: [newPR],
        }];
      }

      const existingForkIndex = oldData.findIndex((f) => f.repoName === repoName);

      if (existingForkIndex !== -1) {
        // Add PR to existing fork
        const existingPRIndex = oldData[existingForkIndex].prs.findIndex(
          (p) => p.prNumber === prNumber
        );
        if (existingPRIndex === -1) {
          const updatedForks = [...oldData];
          updatedForks[existingForkIndex] = {
            ...updatedForks[existingForkIndex],
            prs: [newPR, ...updatedForks[existingForkIndex].prs],
          };
          return updatedForks;
        }
        return oldData;
      } else {
        // Create new fork entry
        return [
          {
            repoName,
            forkUrl,
            createdAt: new Date().toISOString(),
            prs: [newPR],
          },
          ...oldData,
        ];
      }
    });
  };
}
