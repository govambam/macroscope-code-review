"use client";

import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import Image from "next/image";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { UserMenu } from "@/components/UserMenu";
import { MobileMenu } from "@/components/MobileMenu";
import { PRCard, RepoGroupHeader } from "@/components/PRCard";
import { DiscoverPRs } from "@/components/DiscoverPRs";
import { QueueStatus } from "@/components/QueueStatus";

type InternalFilter = "all" | "internal" | "external";
type SortMode = "alpha-asc" | "alpha-desc" | "created-desc" | "created-asc" | "prs-desc" | "prs-asc";

type CreateMode = "commit" | "pr" | "discover";

// PR Analysis types - V1 format (old)
interface BugSnippet {
  title: string;
  explanation: string;
  file_path: string;
  severity: "critical" | "high" | "medium";
  is_most_impactful: boolean;
  macroscope_comment_text?: string;
}

interface NoMeaningfulBugsResult {
  meaningful_bugs_found: false;
  reason: string;
  macroscope_comments_found?: number;
}

interface MeaningfulBugsResult {
  meaningful_bugs_found: true;
  bugs: BugSnippet[];
  total_macroscope_bugs_found: number;
  macroscope_comments_found?: number;
}

type PRAnalysisResultV1 = NoMeaningfulBugsResult | MeaningfulBugsResult;

// PR Analysis types - V2 format (new)
type CommentCategory =
  | "bug_critical"
  | "bug_high"
  | "bug_medium"
  | "bug_low"
  | "suggestion"
  | "style"
  | "nitpick";

interface AnalysisComment {
  index: number;
  macroscope_comment_text: string;
  file_path: string;
  line_number: number | null;
  category: CommentCategory;
  title: string;
  explanation: string;
  explanation_short: string | null;
  impact_scenario: string | null;
  code_suggestion: string | null;
  code_snippet_image_url?: string | null;
  is_meaningful_bug: boolean;
  outreach_ready: boolean;
  outreach_skip_reason: string | null;
}

interface AnalysisSummary {
  bugs_by_severity: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  non_bugs: {
    suggestions: number;
    style: number;
    nitpicks: number;
  };
  recommendation: string;
}

interface PRAnalysisResultV2 {
  total_comments_processed: number;
  meaningful_bugs_count: number;
  outreach_ready_count: number;
  best_bug_for_outreach_index: number | null;
  all_comments: AnalysisComment[];
  summary: AnalysisSummary;
}

// Union type for both formats
type PRAnalysisResult = PRAnalysisResultV1 | PRAnalysisResultV2;

// Email sequence types for Apollo integration
interface EmailEntry {
  subject: string;
  body: string;
}

interface EmailSequence {
  email_1: EmailEntry;
  email_2: EmailEntry;
  email_3: EmailEntry;
  email_4: EmailEntry;
}

type EmailTabKey = "email_1" | "email_2" | "email_3" | "email_4";

// Type guards
function isV2Result(result: PRAnalysisResult): result is PRAnalysisResultV2 {
  return "all_comments" in result && "summary" in result;
}

function isV1Result(result: PRAnalysisResult): result is PRAnalysisResultV1 {
  return "meaningful_bugs_found" in result;
}

// Helper to check if result has meaningful bugs (works with both formats)
function resultHasMeaningfulBugs(result: PRAnalysisResult): boolean {
  if (isV2Result(result)) {
    return result.meaningful_bugs_count > 0;
  }
  return result.meaningful_bugs_found === true;
}

// Helper to get total bug count (works with both formats)
function getTotalBugCount(result: PRAnalysisResult): number {
  if (isV2Result(result)) {
    return result.meaningful_bugs_count;
  }
  if (result.meaningful_bugs_found) {
    return result.total_macroscope_bugs_found;
  }
  return 0;
}

// Extended BugSnippet with V2 fields for email generation
interface ExtendedBugSnippet extends BugSnippet {
  explanation_short?: string;
  impact_scenario?: string;
  code_suggestion?: string;
  code_snippet_image_url?: string;
}

// Helper to convert V2 comment to extended BugSnippet for email generation
function commentToBugSnippet(comment: AnalysisComment, isMostImpactful: boolean = false): ExtendedBugSnippet {
  const severityMap: Partial<Record<CommentCategory, "critical" | "high" | "medium">> = {
    bug_critical: "critical",
    bug_high: "high",
    bug_medium: "medium",
    bug_low: "medium",
  };

  return {
    title: comment.title,
    explanation: comment.explanation,
    explanation_short: comment.explanation_short || undefined,
    impact_scenario: comment.impact_scenario || undefined,
    code_suggestion: comment.code_suggestion || undefined,
    code_snippet_image_url: comment.code_snippet_image_url || undefined,
    file_path: comment.file_path,
    severity: severityMap[comment.category] || "medium",
    is_most_impactful: isMostImpactful,
    macroscope_comment_text: comment.macroscope_comment_text,
  };
}

// Email Generation types
interface EmailGenerationResponse {
  success: boolean;
  email?: EmailSequence;
  error?: string;
}

interface AnalysisApiResponse {
  success: boolean;
  result?: PRAnalysisResult;
  error?: string;
  forkedPrUrl?: string;
  originalPrUrl?: string;
  originalPrTitle?: string;
  originalPrState?: "open" | "merged" | "closed";
  originalPrMergedAt?: string | null;
  cached?: boolean;
  analysisId?: number;
  cachedEmail?: string; // JSON string of EmailSequence
  needsOriginalPrUrl?: boolean;
}

interface ApiResponse {
  success: boolean;
  prUrl?: string;
  message: string;
  commitHash?: string;
  forkUrl?: string;
  error?: string;
  commitCount?: number;
  originalPrNumber?: number;
}

interface StatusMessage {
  type: "info" | "success" | "error" | "progress";
  text: string;
  timestamp: string;
  step?: number;
  totalSteps?: number;
}

interface PRRecord {
  prNumber: number;
  prUrl: string;
  prTitle: string;
  createdAt: string;
  updatedAt?: string | null;
  commitCount: number;
  state: string;
  branchName: string;
  macroscopeBugs?: number;
  hasAnalysis?: boolean;
  analysisId?: number | null;
  originalPrUrl?: string | null;
  isInternal?: boolean;
  createdBy?: string | null;
}

interface ForkRecord {
  repoName: string;
  repoOwner: string;
  forkUrl: string;
  createdAt: string;
  isInternal?: boolean;
  isCached?: boolean;
  originalOrg?: string | null; // The GitHub org of the original repo
  prs: PRRecord[];
}

interface OrgMetricsRecord {
  id: number;
  org: string;
  monthly_prs: number;
  monthly_commits: number;
  monthly_lines_changed: number;
  period_start: string;
  period_end: string;
  calculated_at: string;
  created_at: string;
}

interface OrgGroup {
  org: string;
  forks: ForkRecord[];
  metrics?: OrgMetricsRecord;
}

interface OrgUser {
  login: string;
  avatar_url: string;
}

interface Selection {
  repos: Set<string>;
  prs: Set<string>; // Format: "repoName:prNumber"
}

export default function Home() {
  // Session for user filtering
  const { data: session } = useSession();
  const currentUserLogin = session?.user?.login;

  // Owner filter state - "all" or a specific username
  const [selectedOwner, setSelectedOwner] = useState<string>("all");

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 20;

  // Create PR modal state
  const [showCreatePRModal, setShowCreatePRModal] = useState(false);
  const [createPRModalExpanded, setCreatePRModalExpanded] = useState(false);
  const [createMode, setCreateMode] = useState<CreateMode>("discover");
  const [repoUrl, setRepoUrl] = useState("");
  const [specifyCommit, setSpecifyCommit] = useState(false);
  const [commitHash, setCommitHash] = useState("");
  const [prUrl, setPrUrl] = useState("");
  const [cacheRepo, setCacheRepo] = useState(false);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<StatusMessage[]>([]);
  const [formValidationError, setFormValidationError] = useState<string | null>(null);
  const [result, setResult] = useState<ApiResponse | null>(null);

  // Auto-scroll status container to bottom when new messages arrive
  useEffect(() => {
    if (statusContainerRef.current) {
      statusContainerRef.current.scrollTop = statusContainerRef.current.scrollHeight;
    }
  }, [status]);

  // React Query client for cache manipulation
  const queryClient = useQueryClient();

  // State for org metrics
  const [orgMetrics, setOrgMetrics] = useState<OrgMetricsRecord[]>([]);

  // Fetch forks from API
  const fetchForks = async (source: "db" | "github" = "db"): Promise<ForkRecord[]> => {
    const url = source === "db" ? "/api/forks?source=db" : "/api/forks";
    const response = await fetch(url);
    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error || "Failed to fetch forks");
    }

    // Cache in localStorage as backup
    if (data.forks) {
      localStorage.setItem("macroscope-forks", JSON.stringify(data.forks));
    }

    // Store org metrics
    if (data.orgMetrics) {
      setOrgMetrics(data.orgMetrics);
    }

    return data.forks || [];
  };

  // React Query for forks - loads from database initially
  // Note: We don't use initialData from localStorage to avoid hydration mismatch
  // (server renders empty state, client would render cached data)
  const {
    data: forks = [],
    isLoading: forksLoading,
    error: forksQueryError,
    refetch: refetchForks,
    isFetching: forksRefetching,
  } = useQuery({
    queryKey: ["forks"],
    queryFn: () => fetchForks("db"),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // Fetch organization users for owner dropdown
  const { data: orgUsers = [] } = useQuery<OrgUser[]>({
    queryKey: ["orgUsers"],
    queryFn: async () => {
      const response = await fetch("/api/users");
      const data = await response.json();
      if (!data.success) throw new Error(data.error);
      return data.users;
    },
    staleTime: 30 * 60 * 1000, // 30 minutes - users don't change often
  });

  // Owner dropdown state
  const [ownerDropdownOpen, setOwnerDropdownOpen] = useState<string | null>(null); // PR URL of open dropdown
  const ownerDropdownRef = useRef<HTMLDivElement>(null);

  // Close owner dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (ownerDropdownRef.current && !ownerDropdownRef.current.contains(event.target as Node)) {
        setOwnerDropdownOpen(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Handle owner change
  const handleOwnerChange = async (prUrl: string, newOwner: string) => {
    try {
      const response = await fetch("/api/prs/owner", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prUrl, owner: newOwner }),
      });
      const data = await response.json();
      if (!data.success) {
        console.error("Failed to update owner:", data.error);
        return;
      }
      // Refresh forks to show updated owner
      queryClient.invalidateQueries({ queryKey: ["forks"] });
      setOwnerDropdownOpen(null);
    } catch (error) {
      console.error("Error updating owner:", error);
    }
  };

  const forksError = forksQueryError ? (forksQueryError as Error).message : null;
  const [isRefreshingFromGitHub, setIsRefreshingFromGitHub] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearchAutocomplete, setShowSearchAutocomplete] = useState(false);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<Selection>({ repos: new Set(), prs: new Set() });
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteResult, setDeleteResult] = useState<{ success: boolean; message: string } | null>(null);
  const [showOnlyWithIssues, setShowOnlyWithIssues] = useState(false);
  const [checkingPR, setCheckingPR] = useState<{ repo: string; pr: number } | null>(null);
  const [expandedOrgs, setExpandedOrgs] = useState<Set<string>>(new Set());
  const [expandedRepos, setExpandedRepos] = useState<Set<string>>(new Set());
  const forksLoadedRef = useRef(false);
  const checkedPRsRef = useRef<Set<string>>(new Set());
  const expandedOrgsInitialized = useRef(false);
  const expandedReposInitialized = useRef(false);

  // PR Analysis tab state
  const [analysisForkedUrl, setAnalysisForkedUrl] = useState("");
  const [analysisOriginalUrl, setAnalysisOriginalUrl] = useState("");
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AnalysisApiResponse | null>(null);
  const [copiedBugIndex, setCopiedBugIndex] = useState<number | null>(null);
  const [selectedBugIndex, setSelectedBugIndex] = useState<number | null>(null);
  const [currentAnalysisId, setCurrentAnalysisId] = useState<number | null>(null);
  const [isViewingCached, setIsViewingCached] = useState(false);
  const [expectingCachedResult, setExpectingCachedResult] = useState(false);

  // Email Generation state
  const [emailLoading, setEmailLoading] = useState(false);
  const [generatedEmail, setGeneratedEmail] = useState<EmailSequence | null>(null);
  const [editedEmail, setEditedEmail] = useState<EmailSequence | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailCopied, setEmailCopied] = useState(false);
  const [activeEmailTab, setActiveEmailTab] = useState<EmailTabKey>("email_1");
  const [emailSaving, setEmailSaving] = useState(false);
  const [showUnsavedChangesPrompt, setShowUnsavedChangesPrompt] = useState(false);

  // Apollo integration state
  const [apolloSearchQuery, setApolloSearchQuery] = useState("");
  const [apolloSearchResults, setApolloSearchResults] = useState<Array<{
    id: string;
    name: string;
    domain: string | null;
    website_url: string | null;
  }>>([]);
  const [apolloSearchLoading, setApolloSearchLoading] = useState(false);
  const [apolloSelectedAccount, setApolloSelectedAccount] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [apolloSending, setApolloSending] = useState(false);
  const [apolloSendSuccess, setApolloSendSuccess] = useState(false);
  const [apolloError, setApolloError] = useState<string | null>(null);

  // Attio integration state
  const [attioSearchQuery, setAttioSearchQuery] = useState("");
  const [attioSearchResults, setAttioSearchResults] = useState<Array<{
    id: string;
    name: string;
    domain: string | null;
  }>>([]);
  const [attioSearchLoading, setAttioSearchLoading] = useState(false);
  const [attioSelectedRecord, setAttioSelectedRecord] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [attioSending, setAttioSending] = useState(false);
  const [attioSendSuccess, setAttioSendSuccess] = useState(false);
  const [attioError, setAttioError] = useState<string | null>(null);

  // Analysis Modal state
  const [showAnalysisModal, setShowAnalysisModal] = useState(false);
  const [modalTab, setModalTab] = useState<"analysis" | "email">("analysis");
  const [modalExpanded, setModalExpanded] = useState(true); // Default to expanded
  const [selectedPrTitle, setSelectedPrTitle] = useState("");
  const [showUrlPrompt, setShowUrlPrompt] = useState(false);
  const [pendingForceRefresh, setPendingForceRefresh] = useState(false);

  // Analyze Internal PR state
  const [showAnalyzeCard, setShowAnalyzeCard] = useState(false);
  const [analyzeInternalUrl, setAnalyzeInternalUrl] = useState("");
  const [isInternalPR, setIsInternalPR] = useState(true);
  const [analyzeLoading, setAnalyzeLoading] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);

  // Filters state
  const [sortMode, setSortMode] = useState<SortMode>("created-desc");
  const [internalFilter, setInternalFilter] = useState<InternalFilter>("all");
  const [showFiltersDropdown, setShowFiltersDropdown] = useState(false);
  const filtersRef = useRef<HTMLDivElement>(null);
  const statusContainerRef = useRef<HTMLDivElement>(null);

  // Cache operations state - tracks repos being cached/uncached
  const [cachingRepos, setCachingRepos] = useState<Set<string>>(new Set());

  // Close filters dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (filtersRef.current && !filtersRef.current.contains(event.target as Node)) {
        setShowFiltersDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Close search autocomplete when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (searchContainerRef.current && !searchContainerRef.current.contains(event.target as Node)) {
        setShowSearchAutocomplete(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Mark forks as loaded when data is available
  useEffect(() => {
    if (forks.length > 0) {
      forksLoadedRef.current = true;
    }
  }, [forks]);

  // Auto-expand orgs and repos that have PRs
  useEffect(() => {
    if (forks.length > 0 && !expandedOrgsInitialized.current) {
      // Get all unique orgs that have forks with PRs
      const orgsWithPRs = new Set(
        forks
          .filter(f => f.prs.length > 0)
          .map(f => f.originalOrg || "Other")
      );
      setExpandedOrgs(orgsWithPRs);
      expandedOrgsInitialized.current = true;
    }
  }, [forks]);

  // Auto-expand repos that have PRs, collapse repos with no PRs
  useEffect(() => {
    if (forks.length > 0 && !expandedReposInitialized.current) {
      // Always expand repos with 1+ PRs by default, collapse repos with 0 PRs
      const reposWithPRs = new Set(forks.filter(f => f.prs.length > 0).map(f => f.repoName));
      setExpandedRepos(reposWithPRs);
      expandedReposInitialized.current = true;
    }
  }, [forks]);


  // Auto-check missing bug counts when forks are loaded
  useEffect(() => {
    if (forks.length > 0) {
      // Find PRs with missing bug counts that we haven't already checked
      const prsToCheck: { repoName: string; prNumber: number }[] = [];
      forks.forEach((fork) => {
        fork.prs.forEach((pr) => {
          const prKey = `${fork.repoName}:${pr.prNumber}`;
          if (pr.macroscopeBugs === undefined && !checkedPRsRef.current.has(prKey)) {
            prsToCheck.push({ repoName: fork.repoName, prNumber: pr.prNumber });
            checkedPRsRef.current.add(prKey); // Mark as being checked
          }
        });
      });

      // Check each PR sequentially
      if (prsToCheck.length > 0) {
        const checkBugs = async () => {
          for (const { repoName, prNumber } of prsToCheck) {
            try {
              const response = await fetch("/api/forks/check-bugs", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ repoName, prNumber }),
              });
              const data = await response.json();
              if (data.success) {
                queryClient.setQueryData(["forks"], (prevForks: ForkRecord[] | undefined) => {
                  if (!prevForks) return prevForks;
                  const updatedForks = prevForks.map((fork) => {
                    if (fork.repoName === repoName) {
                      return {
                        ...fork,
                        prs: fork.prs.map((pr) => {
                          if (pr.prNumber === prNumber) {
                            return { ...pr, macroscopeBugs: data.bugCount };
                          }
                          return pr;
                        }),
                      };
                    }
                    return fork;
                  });
                  localStorage.setItem("macroscope-forks", JSON.stringify(updatedForks));
                  return updatedForks;
                });
              }
            } catch {
              // Ignore errors for individual checks
            }
          }
        };
        checkBugs();
      }
    }
  }, [forks, queryClient]);

  const addStatus = (
    text: string,
    type: "info" | "success" | "error" | "progress" = "info",
    step?: number,
    totalSteps?: number
  ) => {
    const timestamp = new Date().toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    setStatus((prev) => [...prev, { type, text, timestamp, step, totalSteps }]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Inline validation (same pattern as Discover tab)
    if (createMode === "pr") {
      if (!prUrl.trim()) {
        setFormValidationError("Please enter a Pull Request URL");
        return;
      }
      const prUrlRegex = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/;
      if (!prUrlRegex.test(prUrl)) {
        setFormValidationError("Invalid PR URL format. Expected: https://github.com/owner/repo/pull/123");
        return;
      }
    } else {
      if (!repoUrl.trim()) {
        setFormValidationError("Please enter a Repository URL");
        return;
      }
      const githubUrlRegex = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/;
      if (!githubUrlRegex.test(repoUrl)) {
        setFormValidationError("Invalid GitHub URL format. Expected: https://github.com/owner/repo-name");
        return;
      }
      if (specifyCommit && !commitHash.trim()) {
        setFormValidationError("Please enter a commit hash");
        return;
      }
      if (specifyCommit && commitHash) {
        const hashRegex = /^[a-f0-9]{7,40}$/i;
        if (!hashRegex.test(commitHash)) {
          setFormValidationError("Invalid commit hash format. Expected 7-40 character hex string");
          return;
        }
      }
    }

    setFormValidationError(null);
    setLoading(true);
    setStatus([]);
    setResult(null);

    try {

      // Build request body
      const body =
        createMode === "commit"
          ? { repoUrl, commitHash: specifyCommit ? commitHash : undefined, cacheRepo }
          : { prUrl, cacheRepo };

      const response = await fetch("/api/create-pr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }

      if (!response.body) {
        throw new Error("No response body");
      }

      // Read the SSE stream
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process complete SSE events (separated by double newlines)
        const events = buffer.split("\n\n");
        buffer = events.pop() || ""; // Keep incomplete event in buffer

        for (const event of events) {
          if (!event.trim()) continue;

          // Parse SSE data line
          const dataMatch = event.match(/^data: (.+)$/m);
          if (!dataMatch) continue;

          try {
            const data = JSON.parse(dataMatch[1]);

            if (data.eventType === "status") {
              // Add status message
              addStatus(data.message, data.statusType || "info", data.step, data.totalSteps);
            } else if (data.eventType === "result") {
              // Final result
              if (data.success) {
                addStatus("PR created successfully!", "success");
                // Add the PR to My Forks tab
                if (data.prUrl && data.forkUrl) {
                  // Use the PR title from the API response
                  const prTitle = data.prTitle || "Review PR";
                  addCreatedPRToForks(data.prUrl, data.forkUrl, prTitle, data.commitCount || 1);
                }
              }
              setResult({
                success: data.success,
                message: data.message,
                prUrl: data.prUrl,
                error: data.error,
                commitHash: data.commitHash,
                forkUrl: data.forkUrl,
                commitCount: data.commitCount,
                originalPrNumber: data.originalPrNumber,
              });
            }
          } catch {
            // Ignore parse errors for individual events
          }
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
      addStatus(errorMessage, "error");
      setResult({
        success: false,
        message: errorMessage,
        error: errorMessage,
      });
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (type: "info" | "success" | "error" | "progress") => {
    switch (type) {
      case "success":
        return "text-success";
      case "error":
        return "text-error";
      case "progress":
        return "text-primary";
      default:
        return "text-accent";
    }
  };

  const handleCreateModeChange = (newMode: CreateMode) => {
    setCreateMode(newMode);
    setStatus([]);
    setResult(null);
    setFormValidationError(null);
  };

  const openCreatePRModal = () => {
    setShowCreatePRModal(true);
    setStatus([]);
    setResult(null);
    setFormValidationError(null);
  };

  const closeCreatePRModal = () => {
    setShowCreatePRModal(false);
    setCreatePRModalExpanded(false);
    setCacheRepo(false);
    setFormValidationError(null);
  };

  // Analyze Internal PR function
  const analyzeInternalPR = async () => {
    if (!analyzeInternalUrl.trim()) {
      setAnalyzeError("Please enter a PR URL");
      return;
    }

    // Validate URL format
    const prUrlMatch = analyzeInternalUrl.match(/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/);
    if (!prUrlMatch) {
      setAnalyzeError("Invalid GitHub PR URL format. Expected: https://github.com/owner/repo/pull/123");
      return;
    }

    setAnalyzeLoading(true);
    setAnalyzeError(null);

    try {
      if (isInternalPR) {
        // Call the internal PR analysis endpoint
        const response = await fetch("/api/analyze-internal-pr", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prUrl: analyzeInternalUrl.trim() }),
        });

        const data = await response.json();

        if (data.success) {
          // Refresh forks to show the new internal repo/PR
          await refreshFromGitHub();

          // Set up the analysis modal with the result
          setAnalysisResult(data);
          if (data.result && isV2Result(data.result)) {
            setSelectedBugIndex(data.result.best_bug_for_outreach_index);
          } else {
            setSelectedBugIndex(null);
          }
          setAnalysisForkedUrl(data.forkedPrUrl || data.prUrl);
          setAnalysisOriginalUrl(data.originalPrUrl || data.prUrl);
          setSelectedPrTitle(data.prTitle || "");
          setCurrentAnalysisId(data.analysisId || null);
          setIsViewingCached(data.cached || false);
          setShowAnalysisModal(true);
          setShowAnalyzeCard(false);
          setAnalyzeInternalUrl("");
        } else {
          setAnalyzeError(data.error || "Failed to analyze PR");
        }
      } else {
        // For external PRs, check if it's already simulated
        const normalizedUrl = analyzeInternalUrl.trim().toLowerCase().replace(/\/+$/, "");
        let foundPR: PRRecord | null = null;
        let foundFork: ForkRecord | null = null;

        for (const fork of forks) {
          for (const pr of fork.prs) {
            if (pr.originalPrUrl && pr.originalPrUrl.toLowerCase().replace(/\/+$/, "") === normalizedUrl) {
              foundPR = pr;
              foundFork = fork;
              break;
            }
          }
          if (foundPR) break;
        }

        if (foundPR && foundFork) {
          // Found existing simulated PR - open analysis
          startAnalysisFromForks(foundPR.prUrl, foundPR.hasAnalysis || false, foundPR.prTitle);
          setShowAnalyzeCard(false);
          setAnalyzeInternalUrl("");
        } else {
          // Not simulated yet - prompt to simulate
          setAnalyzeError("This PR hasn't been simulated yet. Check 'This is an internal PR' if Macroscope has already reviewed it, or click 'Simulate PR' to create a simulated version.");
        }
      }
    } catch (error) {
      setAnalyzeError(error instanceof Error ? error.message : "Failed to analyze PR");
    } finally {
      setAnalyzeLoading(false);
    }
  };

  // My Forks functions
  const refreshFromGitHub = useCallback(async () => {
    setDeleteResult(null);
    setIsRefreshingFromGitHub(true);
    // Clear the checked PRs set so all PRs will be re-checked after refresh
    checkedPRsRef.current.clear();

    try {
      // Fetch fresh data from GitHub
      const freshForks = await fetchForks("github");

      // Update the query cache with the new data
      queryClient.setQueryData(["forks"], freshForks);
      forksLoadedRef.current = true;
    } catch (error) {
      console.error("Failed to refresh from GitHub:", error);
      // The error will be shown via forksError from the query
    } finally {
      setIsRefreshingFromGitHub(false);
    }
  }, [queryClient]);

  const checkSinglePRBugs = async (repoName: string, prNumber: number) => {
    setCheckingPR({ repo: repoName, pr: prNumber });

    try {
      const response = await fetch("/api/forks/check-bugs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoName, prNumber }),
      });

      const data = await response.json();

      // Debug: log the response to see what usernames are commenting
      console.log("Bug check response:", data);

      if (data.success) {
        // Optimistic update for immediate UI feedback
        queryClient.setQueryData(["forks"], (prevForks: ForkRecord[] | undefined) => {
          if (!prevForks) return prevForks;
          const updatedForks = prevForks.map((fork) => {
            if (fork.repoName === repoName) {
              return {
                ...fork,
                prs: fork.prs.map((pr) => {
                  if (pr.prNumber === prNumber) {
                    return { ...pr, macroscopeBugs: data.bugCount };
                  }
                  return pr;
                }),
              };
            }
            return fork;
          });
          localStorage.setItem("macroscope-forks", JSON.stringify(updatedForks));
          return updatedForks;
        });
        // Refetch to get complete updated data (updatedAt, etc.)
        queryClient.invalidateQueries({ queryKey: ["forks"] });
      }
    } catch (error) {
      console.error("Failed to check bugs:", error);
    } finally {
      setCheckingPR(null);
    }
  };

  // Add a newly created PR to the forks list (without checking for bugs yet)
  const addCreatedPRToForks = useCallback(
    (prUrl: string, forkUrl: string, prTitle: string, commitCount: number) => {
      // Parse PR URL to extract owner, repo name and PR number
      const prMatch = prUrl.match(/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/);
      if (!prMatch) return;

      const repoOwner = prMatch[1];
      const repoName = prMatch[2];
      const prNumber = parseInt(prMatch[3], 10);

      // Mark this PR as "checked" so the auto-check effect skips it
      // (Macroscope hasn't had time to analyze it yet, so checking would just return 0)
      const prKey = `${repoName}:${prNumber}`;
      checkedPRsRef.current.add(prKey);

      // Create the new PR record for optimistic update
      const newPR: PRRecord = {
        prNumber,
        prUrl,
        prTitle,
        createdAt: new Date().toISOString(),
        commitCount,
        state: "open",
        branchName: `review-pr-${prNumber}`,
        macroscopeBugs: undefined, // Will show refresh icon, user can check manually later
      };

      // Optimistic update for immediate UI feedback
      queryClient.setQueryData(["forks"], (prevForks: ForkRecord[] | undefined) => {
        let updatedForks = [...(prevForks || [])];
        const existingForkIndex = updatedForks.findIndex((f) => f.repoName === repoName);

        if (existingForkIndex !== -1) {
          // Add PR to existing fork (check if PR already exists)
          const existingPRIndex = updatedForks[existingForkIndex].prs.findIndex(
            (p) => p.prNumber === prNumber
          );
          if (existingPRIndex === -1) {
            updatedForks[existingForkIndex] = {
              ...updatedForks[existingForkIndex],
              prs: [newPR, ...updatedForks[existingForkIndex].prs],
            };
          }
        } else {
          // Create new fork entry
          const newFork: ForkRecord = {
            repoName,
            repoOwner,
            forkUrl,
            createdAt: new Date().toISOString(),
            isCached: false,
            prs: [newPR],
          };
          updatedForks = [newFork, ...updatedForks];
        }

        localStorage.setItem("macroscope-forks", JSON.stringify(updatedForks));
        return updatedForks;
      });

      // Refetch from database to get complete data (createdBy, updatedAt, etc.)
      queryClient.invalidateQueries({ queryKey: ["forks"] });
    },
    [queryClient]
  );

  // Helper to check if a string looks like a GitHub PR URL
  const isPrUrl = useCallback((query: string): boolean => {
    return /github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/i.test(query.trim());
  }, []);

  // Helper to normalize a PR URL for comparison (remove trailing slashes, lowercase)
  const normalizePrUrl = useCallback((url: string): string => {
    return url.trim().toLowerCase().replace(/\/+$/, "");
  }, []);

  // Get unique owners from all PRs (sorted alphabetically)
  const allOwners = useMemo(() => {
    const owners = new Set<string>();
    forks.forEach(fork => {
      fork.prs.forEach(pr => {
        if (pr.createdBy) {
          owners.add(pr.createdBy);
        }
      });
    });
    return Array.from(owners).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  }, [forks]);

  // Count PRs per owner
  const ownerCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    forks.forEach(fork => {
      fork.prs.forEach(pr => {
        if (pr.createdBy) {
          counts[pr.createdBy] = (counts[pr.createdBy] || 0) + 1;
        }
      });
    });
    return counts;
  }, [forks]);

  // Total PR count for "All Users"
  const totalPRCount = useMemo(() => {
    return forks.reduce((sum, fork) => sum + fork.prs.length, 0);
  }, [forks]);

  const filteredForks = useCallback(() => {
    let result = forks;

    // Apply search filter
    if (searchQuery.trim()) {
      const lowerQuery = searchQuery.toLowerCase().trim();
      const isUrlSearch = isPrUrl(searchQuery);

      if (isUrlSearch) {
        // Search by original PR URL
        const normalizedSearchUrl = normalizePrUrl(searchQuery);
        result = result
          .map((fork) => ({
            ...fork,
            prs: fork.prs.filter((pr) => {
              if (!pr.originalPrUrl) return false;
              return normalizePrUrl(pr.originalPrUrl) === normalizedSearchUrl;
            }),
          }))
          .filter((fork) => fork.prs.length > 0);
      } else {
        // Regular text search
        result = result
          .filter((fork) => {
            if (fork.repoName.toLowerCase().includes(lowerQuery)) return true;
            if (fork.prs.some((pr) => pr.prTitle.toLowerCase().includes(lowerQuery))) return true;
            return false;
          })
          .map((fork) => ({
            ...fork,
            prs: fork.prs.filter(
              (pr) =>
                fork.repoName.toLowerCase().includes(lowerQuery) ||
                pr.prTitle.toLowerCase().includes(lowerQuery)
            ),
          }));
      }
    }

    // Apply "show only with issues" filter
    if (showOnlyWithIssues) {
      result = result
        .map((fork) => ({
          ...fork,
          prs: fork.prs.filter((pr) => pr.macroscopeBugs !== undefined && pr.macroscopeBugs > 0),
        }))
        .filter((fork) => fork.prs.length > 0);
    }

    // Apply owner filter
    if (selectedOwner !== "all") {
      result = result
        .map((fork) => ({
          ...fork,
          prs: fork.prs.filter((pr) => pr.createdBy === selectedOwner),
        }))
        .filter((fork) => fork.prs.length > 0);
    }

    // Apply internal/external filter
    if (internalFilter === "internal") {
      result = result.filter((fork) => fork.isInternal);
    } else if (internalFilter === "external") {
      result = result.filter((fork) => !fork.isInternal);
    }

    // Apply sorting to repos
    result = [...result].sort((a, b) => {
      switch (sortMode) {
        case "alpha-asc":
          return a.repoName.localeCompare(b.repoName);
        case "alpha-desc":
          return b.repoName.localeCompare(a.repoName);
        case "created-desc":
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        case "created-asc":
          return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        case "prs-desc":
          return b.prs.length - a.prs.length;
        case "prs-asc":
          return a.prs.length - b.prs.length;
        default:
          return 0;
      }
    });

    return result;
  }, [forks, searchQuery, showOnlyWithIssues, isPrUrl, normalizePrUrl, selectedOwner, internalFilter, sortMode]);

  // Group forks by organization
  const orgGroups = useMemo((): OrgGroup[] => {
    const filtered = filteredForks();
    const groups: Map<string, ForkRecord[]> = new Map();

    for (const fork of filtered) {
      const org = fork.originalOrg || "Other";
      if (!groups.has(org)) {
        groups.set(org, []);
      }
      groups.get(org)!.push(fork);
    }

    // Convert to array and sort
    const result: OrgGroup[] = [];
    for (const [org, forks] of groups.entries()) {
      const metrics = orgMetrics.find(m => m.org === org);
      result.push({ org, forks, metrics });
    }

    // Sort: "Other" always last, then alphabetically
    result.sort((a, b) => {
      if (a.org === "Other") return 1;
      if (b.org === "Other") return -1;
      return a.org.localeCompare(b.org);
    });

    return result;
  }, [filteredForks, orgMetrics]);

  // Pagination data - keep repos together (don't split across pages)
  const paginationData = useMemo(() => {
    const filtered = filteredForks();
    const totalPRs = filtered.reduce((sum, fork) => sum + fork.prs.length, 0);
    const totalRows = filtered.reduce((sum, fork) => sum + 1 + fork.prs.length, 0); // 1 header + PRs per repo

    // Build pages by adding complete repos until page is full
    const pages: ForkRecord[][] = [];
    let currentPageRepos: ForkRecord[] = [];
    let currentPageRows = 0;

    filtered.forEach(fork => {
      const repoRows = 1 + fork.prs.length; // 1 header + PRs

      // If adding this repo would exceed the limit AND we already have items on the page
      if (currentPageRows + repoRows > ITEMS_PER_PAGE && currentPageRepos.length > 0) {
        // Push current page and start a new one
        pages.push(currentPageRepos);
        currentPageRepos = [fork];
        currentPageRows = repoRows;
      } else {
        // Add repo to current page
        currentPageRepos.push(fork);
        currentPageRows += repoRows;
      }
    });

    // Don't forget the last page
    if (currentPageRepos.length > 0) {
      pages.push(currentPageRepos);
    }

    const totalPages = Math.max(1, pages.length);
    const validCurrentPage = Math.min(Math.max(1, currentPage), totalPages);
    const currentPageForks = pages[validCurrentPage - 1] || [];

    return {
      totalRows,
      totalPRs,
      totalPages,
      currentPage: validCurrentPage,
      currentPageForks,
    };
  }, [filteredForks, currentPage, ITEMS_PER_PAGE]);

  // For display, map to the expected format (showHeader is always true now since repos stay together)
  const paginatedForks = useMemo(() => {
    return paginationData.currentPageForks.map(fork => ({
      fork,
      prs: fork.prs,
      showHeader: true,
    }));
  }, [paginationData.currentPageForks]);

  // Group paginated forks by org for 3-level display
  const paginatedOrgGroups = useMemo((): OrgGroup[] => {
    const groups: Map<string, ForkRecord[]> = new Map();

    for (const { fork } of paginatedForks) {
      const org = fork.originalOrg || "Other";
      if (!groups.has(org)) {
        groups.set(org, []);
      }
      groups.get(org)!.push(fork);
    }

    // Convert to array
    const result: OrgGroup[] = [];
    for (const [org, forks] of groups.entries()) {
      const metrics = orgMetrics.find(m => m.org === org);
      result.push({ org, forks, metrics });
    }

    // Sort: "Other" always last, then alphabetically
    result.sort((a, b) => {
      if (a.org === "Other") return 1;
      if (b.org === "Other") return -1;
      return a.org.localeCompare(b.org);
    });

    return result;
  }, [paginatedForks, orgMetrics]);

  // Helper to change page and scroll to top
  const goToPage = useCallback((page: number) => {
    const validPage = Math.min(Math.max(1, page), paginationData.totalPages);
    if (validPage !== currentPage) {
      setCurrentPage(validPage);
      // Use setTimeout to ensure scroll happens after React renders the new page
      setTimeout(() => {
        window.scrollTo({ top: 0, behavior: 'instant' });
      }, 0);
    }
  }, [currentPage, paginationData.totalPages]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [selectedOwner, searchQuery, showOnlyWithIssues, internalFilter, sortMode]);

  // Update URL with page parameter
  useEffect(() => {
    const url = new URL(window.location.href);
    if (currentPage > 1) {
      url.searchParams.set('page', currentPage.toString());
    } else {
      url.searchParams.delete('page');
    }
    window.history.replaceState({}, '', url.toString());
  }, [currentPage]);

  // Initialize from URL parameter
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const pageParam = params.get('page');
    if (pageParam) {
      const page = parseInt(pageParam, 10);
      if (!isNaN(page) && page > 0) {
        setCurrentPage(page);
      }
    }
  }, []);

  // Autocomplete suggestions for search
  const searchSuggestions = useMemo(() => {
    if (!searchQuery.trim() || searchQuery.length < 2) return [];

    const lowerQuery = searchQuery.toLowerCase().trim();
    const suggestions: Array<{ type: 'repo' | 'pr'; repoName: string; prNumber?: number; prTitle?: string; repoOwner: string }> = [];

    for (const fork of forks) {
      // Check if repo name matches
      if (fork.repoName.toLowerCase().includes(lowerQuery)) {
        suggestions.push({
          type: 'repo',
          repoName: fork.repoName,
          repoOwner: fork.repoOwner,
        });
      }

      // Check if any PR titles match
      for (const pr of fork.prs) {
        if (pr.prTitle?.toLowerCase()?.includes(lowerQuery) || `#${pr.prNumber}`.includes(lowerQuery)) {
          suggestions.push({
            type: 'pr',
            repoName: fork.repoName,
            repoOwner: fork.repoOwner,
            prNumber: pr.prNumber,
            prTitle: pr.prTitle,
          });
        }
      }
    }

    return suggestions;
  }, [forks, searchQuery]);

  const toggleOrgExpand = (org: string) => {
    setExpandedOrgs((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(org)) {
        newSet.delete(org);
      } else {
        newSet.add(org);
      }
      return newSet;
    });
  };

  const toggleRepoExpand = (repoName: string) => {
    setExpandedRepos((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(repoName)) {
        newSet.delete(repoName);
      } else {
        newSet.add(repoName);
      }
      return newSet;
    });
  };

  const toggleRepoSelection = (repoName: string) => {
    setSelection((prev) => {
      const newRepos = new Set(prev.repos);
      const newPrs = new Set(prev.prs);
      const fork = forks.find((f) => f.repoName === repoName);

      if (newRepos.has(repoName)) {
        // Deselect repo and all its PRs
        newRepos.delete(repoName);
        fork?.prs.forEach((pr) => newPrs.delete(`${repoName}:${pr.prNumber}`));
      } else {
        // Select repo and all its PRs
        newRepos.add(repoName);
        fork?.prs.forEach((pr) => newPrs.add(`${repoName}:${pr.prNumber}`));
      }

      return { repos: newRepos, prs: newPrs };
    });
  };

  const togglePrSelection = (repoName: string, prNumber: number) => {
    setSelection((prev) => {
      const newPrs = new Set(prev.prs);
      const newRepos = new Set(prev.repos);
      const prKey = `${repoName}:${prNumber}`;

      if (newPrs.has(prKey)) {
        newPrs.delete(prKey);
      } else {
        newPrs.add(prKey);
      }

      // If repo was selected and we're unchecking a PR, deselect the repo
      // (user is now selecting individual PRs, not the whole fork)
      if (newRepos.has(repoName)) {
        newRepos.delete(repoName);
      }

      return { repos: newRepos, prs: newPrs };
    });
  };

  // Toggle cache status for a repo
  const toggleRepoCache = async (repoOwner: string, repoName: string, currentlyCached: boolean) => {
    const cacheKey = `${repoOwner}/${repoName}`;

    // Mark as processing
    setCachingRepos(prev => new Set(prev).add(cacheKey));

    try {
      if (currentlyCached) {
        // Remove from cache
        const response = await fetch("/api/cache", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            repoOwner,
            repoName,
            deleteFromDisk: true
          }),
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || "Failed to remove from cache");
        }
      } else {
        // Add to cache and clone
        const response = await fetch("/api/cache/clone", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ repoOwner, repoName }),
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || "Failed to cache repo");
        }
      }

      // Update local state to reflect the change
      queryClient.setQueryData(["forks"], (prevForks: ForkRecord[] | undefined) =>
        (prevForks || []).map(fork =>
          fork.repoOwner === repoOwner && fork.repoName === repoName
            ? { ...fork, isCached: !currentlyCached }
            : fork
        )
      );
    } catch (error) {
      console.error("Error toggling cache:", error);
      // Could show a toast/alert here
    } finally {
      // Remove from processing state
      setCachingRepos(prev => {
        const newSet = new Set(prev);
        newSet.delete(cacheKey);
        return newSet;
      });
    }
  };

  const getRepoCheckboxState = (repoName: string): "checked" | "unchecked" | "indeterminate" => {
    // Repo is checked only if explicitly selected (will delete the whole fork)
    if (selection.repos.has(repoName)) return "checked";

    // Check if any PRs are selected (show indeterminate)
    const fork = forks.find((f) => f.repoName === repoName);
    if (!fork) return "unchecked";

    const hasSelectedPrs = fork.prs.some((pr) => selection.prs.has(`${repoName}:${pr.prNumber}`));
    return hasSelectedPrs ? "indeterminate" : "unchecked";
  };

  const getSelectedCounts = () => {
    // Only delete repos that are explicitly selected (not just because all PRs are selected)
    const reposToDelete = Array.from(selection.repos);

    // Find individual PRs to delete (from repos not being deleted)
    const prsToDelete: { repo: string; prNumber: number; branchName: string }[] = [];
    selection.prs.forEach((prKey) => {
      const [repoName, prNumberStr] = prKey.split(":");
      // Don't include PRs from repos being deleted (they'll be deleted with the repo)
      if (!selection.repos.has(repoName)) {
        const fork = forks.find((f) => f.repoName === repoName);
        const pr = fork?.prs.find((p) => p.prNumber === parseInt(prNumberStr));
        if (pr) {
          prsToDelete.push({ repo: repoName, prNumber: pr.prNumber, branchName: pr.branchName });
        }
      }
    });

    return { reposToDelete, prsToDelete };
  };

  const handleDelete = async () => {
    const { reposToDelete, prsToDelete } = getSelectedCounts();
    setDeleteLoading(true);
    setShowDeleteConfirm(false);

    try {
      const response = await fetch("/api/forks", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repos: reposToDelete, prs: prsToDelete }),
      });

      const data = await response.json();

      if (data.success) {
        // Update cache
        const updatedForks = queryClient.setQueryData(["forks"], (prevForks: ForkRecord[] | undefined) => {
          if (!prevForks) return prevForks;
          let newForks = [...prevForks];

          // Remove deleted repos
          newForks = newForks.filter((f) => !data.deletedRepos.includes(f.repoName));

          // Remove deleted PRs (but keep the repo even if it has no PRs left)
          data.deletedPRs.forEach((deleted: { repo: string; prNumber: number }) => {
            const forkIndex = newForks.findIndex((f) => f.repoName === deleted.repo);
            if (forkIndex !== -1) {
              newForks[forkIndex] = {
                ...newForks[forkIndex],
                prs: newForks[forkIndex].prs.filter((pr) => pr.prNumber !== deleted.prNumber),
              };
            }
          });

          localStorage.setItem("macroscope-forks", JSON.stringify(newForks));
          return newForks;
        }) as ForkRecord[] | undefined;

        setSelection({ repos: new Set(), prs: new Set() });

        // Collapse repos that now have no PRs
        if (updatedForks) {
          setExpandedRepos((prev) => {
            const newExpanded = new Set(prev);
            updatedForks.forEach((fork) => {
              if (fork.prs.length === 0) {
                newExpanded.delete(fork.repoName);
              }
            });
            return newExpanded;
          });
        }

        const message =
          data.errors.length > 0
            ? `Deleted ${data.deletedRepos.length} repos and ${data.deletedPRs.length} PRs. Some errors occurred.`
            : `Successfully deleted ${data.deletedRepos.length} repos and ${data.deletedPRs.length} PRs.`;

        setDeleteResult({ success: data.errors.length === 0, message });
        // Auto-hide success message after 5 seconds
        setTimeout(() => setDeleteResult(null), 5000);
      } else {
        setDeleteResult({ success: false, message: data.error || "Failed to delete" });
        setTimeout(() => setDeleteResult(null), 5000);
      }
    } catch (error) {
      setDeleteResult({
        success: false,
        message: error instanceof Error ? error.message : "Failed to delete",
      });
      setTimeout(() => setDeleteResult(null), 5000);
    } finally {
      setDeleteLoading(false);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const year = String(date.getFullYear()).slice(-2);
    const hours = date.getHours();
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const ampm = hours >= 12 ? "PM" : "AM";
    const hour12 = hours % 12 || 12;
    return `${month}/${day}/${year} ${hour12}:${minutes} ${ampm}`;
  };

  // Format large numbers with K/M suffix
  const formatMetricNumber = (num: number): string => {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
    }
    if (num >= 1000) {
      return (num / 1000).toFixed(1).replace(/\.0$/, "") + "K";
    }
    return num.toString();
  };

  // PR Analysis functions
  const handleAnalysis = async (e: React.FormEvent, forceRefresh = false) => {
    e.preventDefault();
    setAnalysisLoading(true);
    setAnalysisResult(null);
    setSelectedBugIndex(null);
    setCopiedBugIndex(null);
    setCurrentAnalysisId(null);
    setIsViewingCached(false);
    setShowUrlPrompt(false);

    // If forcing refresh (regenerate), we're running a new analysis
    if (forceRefresh) {
      setExpectingCachedResult(false);
    }

    try {
      const response = await fetch("/api/analyze-pr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          forkedPrUrl: analysisForkedUrl,
          originalPrUrl: analysisOriginalUrl || undefined,
          forceRefresh,
        }),
      });

      const data: AnalysisApiResponse = await response.json();

      // Check if we need to prompt for original PR URL
      if (data.needsOriginalPrUrl) {
        setShowUrlPrompt(true);
        setPendingForceRefresh(forceRefresh);
        setAnalysisLoading(false);
        setExpectingCachedResult(false);
        return;
      }

      setAnalysisResult(data);
      if (data.result && isV2Result(data.result)) {
        setSelectedBugIndex(data.result.best_bug_for_outreach_index);
      } else {
        setSelectedBugIndex(null);
      }

      // Track analysis ID and cache status
      if (data.analysisId) {
        setCurrentAnalysisId(data.analysisId);
      }
      if (data.cached) {
        setIsViewingCached(true);
      }

      // If there's a cached email, parse and display it
      if (data.cachedEmail) {
        try {
          const parsedEmail = JSON.parse(data.cachedEmail) as EmailSequence;
          setGeneratedEmail(parsedEmail);
          setEditedEmail(JSON.parse(JSON.stringify(parsedEmail))); // Deep copy for editing
        } catch {
          // Legacy format - ignore cached email if it's not valid JSON
          console.warn("Cached email is not in new JSON format, ignoring");
        }
      }

      // Update forks cache to reflect that this PR now has an analysis
      if (data.success && data.analysisId) {
        queryClient.setQueryData(["forks"], (prevForks: ForkRecord[] | undefined) => {
          if (!prevForks) return prevForks;
          const updatedForks = prevForks.map((fork) => ({
            ...fork,
            prs: fork.prs.map((pr) => {
              if (pr.prUrl === analysisForkedUrl) {
                return { ...pr, hasAnalysis: true, analysisId: data.analysisId };
              }
              return pr;
            }),
          }));
          localStorage.setItem("macroscope-forks", JSON.stringify(updatedForks));
          return updatedForks;
        });
        // Refetch to get complete updated data from database
        queryClient.invalidateQueries({ queryKey: ["forks"] });
      }
    } catch (error) {
      setAnalysisResult({
        success: false,
        error: error instanceof Error ? error.message : "Analysis failed",
      });
    } finally {
      setAnalysisLoading(false);
      setExpectingCachedResult(false); // Reset after analysis completes
    }
  };

  // Handle submission of original PR URL when prompted
  const handleOriginalUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!analysisOriginalUrl.trim()) return;
    setShowUrlPrompt(false);
    // Re-run analysis with the provided URL
    const syntheticEvent = { preventDefault: () => {} } as React.FormEvent;
    handleAnalysis(syntheticEvent, pendingForceRefresh);
  };

  const startAnalysisFromForks = (prUrl: string, hasExistingAnalysis = false, prTitle = "") => {
    setAnalysisForkedUrl(prUrl);
    setAnalysisOriginalUrl("");
    setAnalysisResult(null);
    setSelectedBugIndex(null);
    setGeneratedEmail(null);
    setEditedEmail(null);
    setEmailError(null);
    setCurrentAnalysisId(null);
    setIsViewingCached(false);
    setExpectingCachedResult(hasExistingAnalysis);
    setSelectedPrTitle(prTitle);
    setModalTab("analysis");
    // Reset Apollo state when switching PRs
    setApolloSearchQuery("");
    setApolloSearchResults([]);
    setApolloSelectedAccount(null);
    setApolloError(null);
    setApolloSendSuccess(false);
    // Reset Attio state when switching PRs
    setAttioSearchQuery("");
    setAttioSearchResults([]);
    setAttioSelectedRecord(null);
    setAttioError(null);
    setAttioSendSuccess(false);

    // If there's an existing analysis, set loading state BEFORE opening modal
    // This prevents the "Ready to Analyze" blip
    if (hasExistingAnalysis) {
      setAnalysisLoading(true);
    }

    setShowAnalysisModal(true);

    // If there's an existing analysis, auto-load it immediately
    if (hasExistingAnalysis) {
      // Use setTimeout(0) to ensure state updates are flushed before triggering fetch
      setTimeout(() => {
        const form = document.getElementById("analysis-form") as HTMLFormElement;
        if (form) {
          form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
        }
      }, 0);
    }
  };

  const closeAnalysisModal = () => {
    setShowAnalysisModal(false);
    setModalExpanded(true); // Reset to expanded for next open
    setModalTab("analysis");
    setShowUrlPrompt(false);
    setPendingForceRefresh(false);
  };

  const copyBugExplanation = async (text: string, index: number) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedBugIndex(index);
      setTimeout(() => setCopiedBugIndex(null), 2000);
    } catch {
      // Fallback for older browsers
      const textArea = document.createElement("textarea");
      textArea.value = text;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand("copy");
      document.body.removeChild(textArea);
      setCopiedBugIndex(index);
      setTimeout(() => setCopiedBugIndex(null), 2000);
    }
  };

  const copyEmail = async () => {
    if (!editedEmail) return;
    const activeEmail = editedEmail[activeEmailTab];
    const emailText = `Subject: ${activeEmail.subject}\n\n${activeEmail.body}`;
    try {
      await navigator.clipboard.writeText(emailText);
      setEmailCopied(true);
      setTimeout(() => setEmailCopied(false), 2000);
    } catch {
      const textArea = document.createElement("textarea");
      textArea.value = emailText;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand("copy");
      document.body.removeChild(textArea);
      setEmailCopied(true);
      setTimeout(() => setEmailCopied(false), 2000);
    }
  };

  // Apollo integration functions
  const handleApolloSearch = async () => {
    if (!apolloSearchQuery.trim()) return;

    setApolloSearchLoading(true);
    setApolloError(null);
    setApolloSearchResults([]);
    setApolloSelectedAccount(null);

    try {
      const response = await fetch("/api/apollo/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: apolloSearchQuery.trim() }),
      });

      const data = await response.json();

      if (data.success && data.accounts) {
        setApolloSearchResults(data.accounts);
        if (data.accounts.length === 0) {
          setApolloError("No accounts found matching your search");
        }
      } else {
        setApolloError(data.error || "Failed to search Apollo accounts");
      }
    } catch (error) {
      setApolloError(error instanceof Error ? error.message : "Failed to search Apollo accounts");
    } finally {
      setApolloSearchLoading(false);
    }
  };

  const handleApolloSend = async () => {
    if (!apolloSelectedAccount || !editedEmail) return;

    setApolloSending(true);
    setApolloError(null);
    setApolloSendSuccess(false);

    try {
      // Save any unsaved changes first
      if (hasUnsavedEmailChanges()) {
        const saved = await handleSaveEmail();
        if (!saved) {
          setApolloError("Failed to save email changes before sending");
          return;
        }
      }

      const response = await fetch("/api/apollo/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: apolloSelectedAccount.id,
          emailSequence: editedEmail,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setApolloSendSuccess(true);
        setTimeout(() => setApolloSendSuccess(false), 3000);
      } else {
        setApolloError(data.error || "Failed to send to Apollo");
      }
    } catch (error) {
      setApolloError(error instanceof Error ? error.message : "Failed to send to Apollo");
    } finally {
      setApolloSending(false);
    }
  };

  // Attio integration functions
  const handleAttioSearch = async () => {
    if (!attioSearchQuery.trim()) return;

    setAttioSearchLoading(true);
    setAttioError(null);
    setAttioSearchResults([]);
    setAttioSelectedRecord(null);

    try {
      const response = await fetch("/api/attio/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: attioSearchQuery.trim() }),
      });

      const data = await response.json();

      if (data.success && data.records) {
        setAttioSearchResults(data.records);
        if (data.records.length === 0) {
          setAttioError("No companies found matching your search");
        }
      } else {
        setAttioError(data.error || "Failed to search Attio companies");
      }
    } catch (error) {
      setAttioError(error instanceof Error ? error.message : "Failed to search Attio companies");
    } finally {
      setAttioSearchLoading(false);
    }
  };

  const handleAttioSend = async () => {
    if (!attioSelectedRecord || !editedEmail) return;

    setAttioSending(true);
    setAttioError(null);
    setAttioSendSuccess(false);

    try {
      // Save any unsaved changes first
      if (hasUnsavedEmailChanges()) {
        const saved = await handleSaveEmail();
        if (!saved) {
          setAttioError("Failed to save email changes before sending");
          return;
        }
      }

      const response = await fetch("/api/attio/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recordId: attioSelectedRecord.id,
          emailSequence: editedEmail,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setAttioSendSuccess(true);
        setTimeout(() => setAttioSendSuccess(false), 3000);
      } else {
        setAttioError(data.error || "Failed to send to Attio");
      }
    } catch (error) {
      setAttioError(error instanceof Error ? error.message : "Failed to send to Attio");
    } finally {
      setAttioSending(false);
    }
  };

  // Email editing functions
  const hasUnsavedEmailChanges = (): boolean => {
    if (!generatedEmail || !editedEmail) return false;
    return JSON.stringify(generatedEmail) !== JSON.stringify(editedEmail);
  };

  const handleEmailEdit = (field: "subject" | "body", value: string) => {
    if (!editedEmail) return;
    setEditedEmail({
      ...editedEmail,
      [activeEmailTab]: {
        ...editedEmail[activeEmailTab],
        [field]: value,
      },
    });
  };

  const handleSaveEmail = async (): Promise<boolean> => {
    if (!editedEmail || !currentAnalysisId) return false;

    setEmailSaving(true);
    try {
      const response = await fetch("/api/emails/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          analysisId: currentAnalysisId,
          emailContent: JSON.stringify(editedEmail),
        }),
      });

      const data = await response.json();

      if (data.success) {
        // Update generatedEmail to match editedEmail (no longer unsaved)
        setGeneratedEmail(JSON.parse(JSON.stringify(editedEmail)));
        return true;
      } else {
        setEmailError(data.error || "Failed to save email");
        return false;
      }
    } catch (error) {
      setEmailError(error instanceof Error ? error.message : "Failed to save email");
      return false;
    } finally {
      setEmailSaving(false);
    }
  };

  const handleCloseModalWithCheck = () => {
    if (hasUnsavedEmailChanges()) {
      setShowUnsavedChangesPrompt(true);
    } else {
      closeAnalysisModal();
    }
  };

  const handleDiscardChanges = () => {
    setShowUnsavedChangesPrompt(false);
    // Reset editedEmail to match generatedEmail
    if (generatedEmail) {
      setEditedEmail(JSON.parse(JSON.stringify(generatedEmail)));
    }
    closeAnalysisModal();
  };

  const handleSaveAndClose = async () => {
    const saved = await handleSaveEmail();
    if (saved) {
      setShowUnsavedChangesPrompt(false);
      closeAnalysisModal();
    }
  };

  // Helper to get the most impactful/best bug for outreach from either format
  // Returns an extended bug object that includes V2 fields like impact_scenario and code_suggestion
  const getBestBugForEmail = (result: PRAnalysisResult): (BugSnippet & {
    impact_scenario?: string;
    code_suggestion?: string;
    code_snippet_image_url?: string;
    explanation_short?: string;
  }) | null => {
    if (isV2Result(result)) {
      // V2 format - get the best bug for outreach with all V2 fields preserved
      let bestComment = null;
      if (result.best_bug_for_outreach_index !== null) {
        bestComment = result.all_comments.find(
          c => c.index === result.best_bug_for_outreach_index
        );
      }
      // Fallback to first meaningful bug
      if (!bestComment) {
        bestComment = result.all_comments.find(c => c.is_meaningful_bug);
      }

      if (bestComment) {
        // Map V2 categories to V1 severity
        const severityMap: Record<string, "critical" | "high" | "medium"> = {
          bug_critical: "critical",
          bug_high: "high",
          bug_medium: "medium",
          bug_low: "medium",
        };

        return {
          title: bestComment.title,
          explanation: bestComment.explanation,
          explanation_short: bestComment.explanation_short || undefined,
          file_path: bestComment.file_path,
          severity: severityMap[bestComment.category] || "medium",
          is_most_impactful: true,
          macroscope_comment_text: bestComment.macroscope_comment_text,
          // V2-specific fields for richer emails
          impact_scenario: bestComment.impact_scenario || undefined,
          code_suggestion: bestComment.code_suggestion || undefined,
          code_snippet_image_url: bestComment.code_snippet_image_url || undefined,
        };
      }
      return null;
    }

    // V1 format - use existing logic
    if (!result.meaningful_bugs_found) return null;
    const mostImpactful = result.bugs.find((bug) => bug.is_most_impactful);
    return mostImpactful || result.bugs[0] || null;
  };

  // Legacy helper for backwards compatibility
  const getMostImpactfulBug = (bugs: BugSnippet[]): BugSnippet | null => {
    const mostImpactful = bugs.find((bug) => bug.is_most_impactful);
    return mostImpactful || bugs[0] || null;
  };

  const extractCompanyFromUrl = (url: string): string => {
    const match = url.match(/github\.com\/([\w.-]+)\//);
    if (!match) return "";
    const orgName = match[1];
    return orgName
      .split("-")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join("");
  };

  const extractPrNumber = (url: string): string => {
    const match = url.match(/\/pull\/(\d+)/);
    return match ? match[1] : "";
  };

  const handleGenerateEmail = async () => {
    if (!analysisResult?.result) return;

    // Check if there are meaningful bugs using format-agnostic helper
    if (!resultHasMeaningfulBugs(analysisResult.result)) return;

    // Use user-selected bug if available, otherwise fall back to best bug
    let bestBug;
    if (selectedBugIndex !== null && isV2Result(analysisResult.result)) {
      const selectedComment = analysisResult.result.all_comments.find(
        c => c.index === selectedBugIndex
      );
      if (selectedComment) {
        bestBug = commentToBugSnippet(selectedComment, true);
      }
    }
    if (!bestBug) {
      bestBug = getBestBugForEmail(analysisResult.result);
    }
    if (!bestBug) return;

    // Get the original PR URL from the API response (always extracted from forked PR description)
    const originalPrUrl = analysisResult.originalPrUrl;
    if (!originalPrUrl) {
      setEmailError("Could not determine original PR URL. The analysis may need to be regenerated.");
      return;
    }

    setEmailLoading(true);
    setEmailError(null);
    setGeneratedEmail(null);
    setEditedEmail(null);
    // Switch to email tab immediately to show loading skeleton
    setModalTab("email");

    // Get total bug count using format-aware helper
    const totalBugs = getTotalBugCount(analysisResult.result);

    try {
      const response = await fetch("/api/generate-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          originalPrUrl,
          prTitle: analysisResult.originalPrTitle, // Use the actual PR title from GitHub
          prStatus: analysisResult.originalPrState, // Pass PR status for email personalization
          prMergedAt: analysisResult.originalPrMergedAt, // Pass merge date for context
          forkedPrUrl: analysisForkedUrl,
          bug: bestBug,
          totalBugs,
          analysisId: currentAnalysisId, // Link email to analysis in database
        }),
      });

      const data: EmailGenerationResponse = await response.json();

      if (data.success && data.email) {
        setGeneratedEmail(data.email);
        setEditedEmail(JSON.parse(JSON.stringify(data.email))); // Deep copy for editing
        // Automatically switch to email tab after successful generation
        setModalTab("email");
      } else {
        setEmailError(data.error || "Failed to generate email");
      }
    } catch (error) {
      setEmailError(error instanceof Error ? error.message : "Failed to generate email");
    } finally {
      setEmailLoading(false);
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case "critical":
        return "bg-red-100 text-red-800 border-red-200";
      case "high":
        return "bg-orange-100 text-orange-800 border-orange-200";
      case "medium":
        return "bg-yellow-100 text-yellow-800 border-yellow-200";
      default:
        return "bg-gray-100 text-gray-800 border-gray-200";
    }
  };

  const totalSelected = selection.prs.size;
  const { reposToDelete, prsToDelete } = getSelectedCounts();

  return (
    <div className="min-h-screen flex">
      {/* Mobile Menu - visible only on mobile */}
      <MobileMenu />

      {/* Left Sidebar - hidden on mobile */}
      <aside className="hidden md:flex w-64 bg-white border-r border-border flex-col shrink-0 sticky top-0 h-screen overflow-y-auto">
        {/* Logo */}
        <div className="h-16 flex items-center px-6 border-b border-border">
          <div className="flex flex-col">
            <span className="text-lg font-semibold text-accent tracking-tight" style={{ fontFamily: 'var(--font-geist-mono)' }}>Code Review Studio</span>
            <span className="text-xs text-text-muted">Powered by <span className="text-primary">Macroscope</span></span>
          </div>
        </div>

        {/* Navigation Links */}
        <nav className="flex-1 px-4 py-6">
          <div className="space-y-1">
            <div className="w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-lg bg-primary/10 text-primary">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              PR Reviews
            </div>
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

      {/* Main Content Area */}
      <main className="flex-1 bg-bg-subtle min-h-screen md:h-screen overflow-y-auto pt-14 md:pt-0">
        {/* Header Section - sticky on desktop only */}
        <div className="md:sticky md:top-0 z-10 bg-bg-subtle px-4 md:px-8 pt-4 md:pt-8 pb-4 border-b border-border md:shadow-sm">
          {/* Page Header */}
          <div className="flex flex-col gap-3 mb-4">
            {/* Title row - only on desktop */}
            <div className="hidden md:flex md:items-start md:justify-between">
              <div>
                <h1 className="text-2xl font-semibold text-accent tracking-tight">PR Reviews</h1>
                <p className="mt-2 text-base text-text-secondary">View and analyze pull requests grouped by repository</p>
              </div>
            </div>

            {/* Mobile title */}
            <h1 className="text-xl font-semibold text-accent tracking-tight md:hidden">PR Reviews</h1>

            {/* Action buttons row - Import, Simulate, Filters, Refresh */}
            <div className="flex items-center gap-2 flex-wrap">
              {totalSelected > 0 && (
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  disabled={deleteLoading}
                  className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] px-3 bg-error hover:bg-error/90 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
                >
                  {deleteLoading ? (
                    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                  ) : (
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  )}
                  <span className="hidden sm:inline ml-1.5">Delete</span>
                </button>
              )}
              <button
                onClick={() => setShowAnalyzeCard(!showAnalyzeCard)}
                className={`inline-flex items-center gap-1.5 px-3 py-2 min-h-[44px] text-sm font-medium rounded-lg transition-colors ${
                  showAnalyzeCard
                    ? "bg-primary text-white"
                    : "bg-white border border-border text-accent hover:bg-bg-subtle"
                }`}
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                Import
              </button>
              <button
                onClick={openCreatePRModal}
                className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[44px] bg-primary hover:bg-primary-hover text-white text-sm font-medium rounded-lg transition-colors"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                Simulate
              </button>

              {/* Spacer to push filter/refresh to right on desktop */}
              <div className="hidden md:flex flex-1"></div>

              {/* Filters button - icon only on mobile */}
              <div className="relative" ref={filtersRef}>
                <button
                  onClick={() => setShowFiltersDropdown(!showFiltersDropdown)}
                  className={`inline-flex items-center justify-center min-h-[44px] min-w-[44px] md:px-3 md:gap-1.5 bg-white border border-border rounded-lg text-sm font-medium hover:bg-bg-subtle transition-colors ${
                    (selectedOwner !== "all" || internalFilter !== "all" || sortMode !== "created-desc") ? "text-primary border-primary" : "text-accent"
                  }`}
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                  </svg>
                  <span className="hidden md:inline">Filters</span>
                  {(selectedOwner !== "all" || internalFilter !== "all" || sortMode !== "created-desc") && (
                    <span className="hidden md:inline ml-1 px-1.5 py-0.5 text-xs bg-primary text-white rounded-full">
                      {(selectedOwner !== "all" ? 1 : 0) + (internalFilter !== "all" ? 1 : 0) + (sortMode !== "created-desc" ? 1 : 0)}
                    </span>
                  )}
                </button>

                {/* Filters dropdown - moved here */}
                {showFiltersDropdown && (
                  <div className="absolute right-0 top-full mt-2 w-64 bg-white border border-border rounded-lg shadow-lg z-20 overflow-hidden max-h-[70vh] overflow-y-auto">
                    {/* User Filter */}
                    <div className="p-3 border-b border-border">
                      <p className="text-xs font-medium text-text-muted uppercase tracking-wide mb-2">Filter by User</p>
                      <div className="space-y-1 max-h-48 overflow-y-auto">
                        <label className="flex items-center justify-between gap-2 cursor-pointer p-1.5 rounded hover:bg-bg-subtle">
                          <div className="flex items-center gap-2">
                            <input
                              type="radio"
                              name="ownerFilter"
                              checked={selectedOwner === "all"}
                              onChange={() => setSelectedOwner("all")}
                              className="text-primary focus:ring-primary"
                            />
                            <span className="text-sm text-accent">All Users</span>
                          </div>
                          <span className="text-xs text-text-muted bg-gray-100 px-1.5 py-0.5 rounded">{totalPRCount}</span>
                        </label>
                        {currentUserLogin && allOwners.includes(currentUserLogin) && (
                          <label className="flex items-center justify-between gap-2 cursor-pointer p-1.5 rounded hover:bg-bg-subtle bg-blue-50">
                            <div className="flex items-center gap-2">
                              <input
                                type="radio"
                                name="ownerFilter"
                                checked={selectedOwner === currentUserLogin}
                                onChange={() => setSelectedOwner(currentUserLogin)}
                                className="text-primary focus:ring-primary"
                              />
                              <span className="text-sm text-accent font-medium">@{currentUserLogin}</span>
                              <span className="text-xs text-blue-600">(you)</span>
                            </div>
                            <span className="text-xs text-text-muted bg-gray-100 px-1.5 py-0.5 rounded">{ownerCounts[currentUserLogin] || 0}</span>
                          </label>
                        )}
                        {allOwners.filter(owner => owner !== currentUserLogin).map(owner => (
                          <label key={owner} className="flex items-center justify-between gap-2 cursor-pointer p-1.5 rounded hover:bg-bg-subtle">
                            <div className="flex items-center gap-2">
                              <input
                                type="radio"
                                name="ownerFilter"
                                checked={selectedOwner === owner}
                                onChange={() => setSelectedOwner(owner)}
                                className="text-primary focus:ring-primary"
                              />
                              <span className="text-sm text-accent">@{owner}</span>
                            </div>
                            <span className="text-xs text-text-muted bg-gray-100 px-1.5 py-0.5 rounded">{ownerCounts[owner] || 0}</span>
                          </label>
                        ))}
                      </div>
                    </div>

                    {/* PR Type Filter */}
                    <div className="p-3 border-b border-border">
                      <p className="text-xs font-medium text-text-muted uppercase tracking-wide mb-2">PR Type</p>
                      <div className="space-y-1">
                        <label className="flex items-center gap-2 cursor-pointer p-1.5 rounded hover:bg-bg-subtle">
                          <input
                            type="radio"
                            name="internalFilter"
                            checked={internalFilter === "all"}
                            onChange={() => setInternalFilter("all")}
                            className="text-primary focus:ring-primary"
                          />
                          <span className="text-sm text-accent">All PRs</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer p-1.5 rounded hover:bg-bg-subtle">
                          <input
                            type="radio"
                            name="internalFilter"
                            checked={internalFilter === "internal"}
                            onChange={() => setInternalFilter("internal")}
                            className="text-primary focus:ring-primary"
                          />
                          <span className="text-sm text-accent">Internal Only</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer p-1.5 rounded hover:bg-bg-subtle">
                          <input
                            type="radio"
                            name="internalFilter"
                            checked={internalFilter === "external"}
                            onChange={() => setInternalFilter("external")}
                            className="text-primary focus:ring-primary"
                          />
                          <span className="text-sm text-accent">Simulated Only</span>
                        </label>
                      </div>
                    </div>

                    {/* Sort Options */}
                    <div className="p-3 border-b border-border">
                      <p className="text-xs font-medium text-text-muted uppercase tracking-wide mb-2">Sort Repos By</p>
                      <div className="space-y-1">
                        <label className="flex items-center gap-2 cursor-pointer p-1.5 rounded hover:bg-bg-subtle">
                          <input
                            type="radio"
                            name="sortMode"
                            checked={sortMode === "created-desc"}
                            onChange={() => setSortMode("created-desc")}
                            className="text-primary focus:ring-primary"
                          />
                          <span className="text-sm text-accent">Newest First</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer p-1.5 rounded hover:bg-bg-subtle">
                          <input
                            type="radio"
                            name="sortMode"
                            checked={sortMode === "created-asc"}
                            onChange={() => setSortMode("created-asc")}
                            className="text-primary focus:ring-primary"
                          />
                          <span className="text-sm text-accent">Oldest First</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer p-1.5 rounded hover:bg-bg-subtle">
                          <input
                            type="radio"
                            name="sortMode"
                            checked={sortMode === "alpha-asc"}
                            onChange={() => setSortMode("alpha-asc")}
                            className="text-primary focus:ring-primary"
                          />
                          <span className="text-sm text-accent">A → Z</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer p-1.5 rounded hover:bg-bg-subtle">
                          <input
                            type="radio"
                            name="sortMode"
                            checked={sortMode === "alpha-desc"}
                            onChange={() => setSortMode("alpha-desc")}
                            className="text-primary focus:ring-primary"
                          />
                          <span className="text-sm text-accent">Z → A</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer p-1.5 rounded hover:bg-bg-subtle">
                          <input
                            type="radio"
                            name="sortMode"
                            checked={sortMode === "prs-desc"}
                            onChange={() => setSortMode("prs-desc")}
                            className="text-primary focus:ring-primary"
                          />
                          <span className="text-sm text-accent">Most PRs</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer p-1.5 rounded hover:bg-bg-subtle">
                          <input
                            type="radio"
                            name="sortMode"
                            checked={sortMode === "prs-asc"}
                            onChange={() => setSortMode("prs-asc")}
                            className="text-primary focus:ring-primary"
                          />
                          <span className="text-sm text-accent">Fewest PRs</span>
                        </label>
                      </div>
                    </div>

                    {/* Reset Button */}
                    {(selectedOwner !== "all" || internalFilter !== "all" || sortMode !== "created-desc") && (
                      <div className="p-3 border-t border-border">
                        <button
                          onClick={() => {
                            setSelectedOwner("all");
                            setInternalFilter("all");
                            setSortMode("created-desc");
                          }}
                          className="w-full text-sm text-text-secondary hover:text-accent py-1.5 transition-colors"
                        >
                          Reset Filters
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Refresh button - icon only */}
              <button
                onClick={refreshFromGitHub}
                disabled={isRefreshingFromGitHub}
                className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] bg-white border border-border rounded-lg text-accent hover:bg-bg-subtle transition-colors disabled:opacity-50"
              >
                {isRefreshingFromGitHub ? (
                  <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                ) : (
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          {/* Import PR Card */}
          {showAnalyzeCard && (
            <div className="mb-6 bg-white rounded-xl border border-border shadow-sm overflow-hidden">
              <div className="p-6">
                <h3 className="text-lg font-semibold text-accent mb-4">Import PR</h3>

                {/* PR URL Input */}
                <div className="mb-4">
                  <label className="block text-sm font-medium text-text-secondary mb-2">
                    GitHub PR URL
                  </label>
                  <input
                    type="text"
                    value={analyzeInternalUrl}
                    onChange={(e) => {
                      setAnalyzeInternalUrl(e.target.value);
                      setAnalyzeError(null);
                    }}
                    placeholder="https://github.com/owner/repo/pull/123"
                    className="w-full px-4 py-2.5 bg-white border border-border rounded-lg text-black placeholder:text-text-muted focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors"
                  />
                </div>

                {/* Internal PR Checkbox */}
                <div className="mb-4">
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isInternalPR}
                      onChange={(e) => setIsInternalPR(e.target.checked)}
                      className="mt-1 h-4 w-4 rounded border-border text-primary focus:ring-primary"
                    />
                    <div>
                      <span className="text-sm font-medium text-accent">This is an internal PR (I own this repo)</span>
                      <p className="text-xs text-text-muted mt-0.5">
                        Check this if Macroscope has already reviewed this PR. Uncheck to look up a previously simulated PR.
                      </p>
                    </div>
                  </label>
                </div>

                {/* Error Message */}
                {analyzeError && (
                  <div className="mb-4 p-3 bg-error-light border border-error/20 rounded-lg text-sm text-error">
                    {analyzeError}
                  </div>
                )}

                {/* Actions */}
                <div className="flex items-center gap-3">
                  <button
                    onClick={analyzeInternalPR}
                    disabled={analyzeLoading || !analyzeInternalUrl.trim()}
                    className="inline-flex items-center gap-1.5 px-3 py-2 bg-primary hover:bg-primary-hover text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {analyzeLoading ? (
                      <>
                        <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        Importing...
                      </>
                    ) : (
                      <>
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                        </svg>
                        Import PR
                      </>
                    )}
                  </button>
                  <button
                    onClick={() => {
                      setShowAnalyzeCard(false);
                      setAnalyzeInternalUrl("");
                      setAnalyzeError(null);
                    }}
                    className="px-3 py-2 text-text-secondary hover:text-accent text-sm font-medium rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Search */}
          <div className="relative" ref={searchContainerRef}>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setShowSearchAutocomplete(true);
              }}
              onFocus={() => setShowSearchAutocomplete(true)}
              placeholder="Search repos or PR titles..."
              className="w-full pl-10 pr-4 py-2.5 md:py-2 min-h-[44px] bg-white border border-border rounded-lg text-sm text-black placeholder:text-text-muted focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors"
            />
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>

            {/* Search Autocomplete Dropdown */}
            {showSearchAutocomplete && searchSuggestions.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-border rounded-lg shadow-lg z-30 max-h-[240px] overflow-y-auto">
                {searchSuggestions.slice(0, 20).map((suggestion, index) => (
                  <button
                    key={`${suggestion.type}-${suggestion.repoName}-${suggestion.prNumber || index}`}
                    onClick={() => {
                      if (suggestion.type === 'repo') {
                        setSearchQuery(suggestion.repoName);
                        // Auto-expand the repo
                        setExpandedRepos(prev => new Set(prev).add(suggestion.repoName));
                      } else {
                        setSearchQuery(suggestion.prTitle || `#${suggestion.prNumber}`);
                        // Auto-expand the repo containing this PR
                        setExpandedRepos(prev => new Set(prev).add(suggestion.repoName));
                      }
                      setShowSearchAutocomplete(false);
                    }}
                    className="w-full px-3 py-2 text-left hover:bg-bg-subtle transition-colors flex items-center gap-2 border-b border-border last:border-b-0"
                  >
                    {suggestion.type === 'repo' ? (
                      <>
                        <svg className="h-4 w-4 text-text-muted flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                        </svg>
                        <span className="text-sm text-accent truncate">{suggestion.repoName}</span>
                        <span className="text-xs text-text-muted ml-auto">Repo</span>
                      </>
                    ) : (
                      <>
                        <svg className="h-4 w-4 text-primary flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                        </svg>
                        <div className="flex-1 min-w-0">
                          <span className="text-sm text-primary">#{suggestion.prNumber}</span>
                          <span className="text-sm text-accent ml-1.5 truncate">{suggestion.prTitle}</span>
                        </div>
                        <span className="text-xs text-text-muted flex-shrink-0">{suggestion.repoName}</span>
                      </>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Content Area */}
        <div className="px-4 md:px-8 pt-4 pb-4 md:py-6">
          {/* My Repos Section */}
          <div className="bg-white border border-border rounded-xl shadow-sm overflow-hidden pt-2 md:pt-0">
            {/* Error display */}
            {forksError && (
              <div className="mx-6 mt-4 p-3 rounded-lg bg-error-light border border-error/20 text-sm text-error">
                {forksError}
              </div>
            )}

            {/* Delete result */}
            {deleteResult && (
              <div className={`mx-6 mt-4 p-3 rounded-lg border text-sm ${deleteResult.success ? "bg-success-light border-success/20 text-success" : "bg-error-light border-error/20 text-error"}`}>
                {deleteResult.message}
              </div>
            )}

            {/* Queue Status */}
            <div className="mx-6 mt-4">
              <QueueStatus />
            </div>

            {/* Repos List - with top padding on mobile to ensure first repo header is visible */}
            {forks.length === 0 ? (
              <div className="text-center py-12">
                <svg className="mx-auto h-12 w-12 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
                <h3 className="mt-4 text-sm font-medium text-accent">No repos tracked yet</h3>
                <p className="mt-2 text-sm text-text-muted">
                  Create a PR to get started, or click &quot;Refresh&quot; to load existing repos from GitHub.
                </p>
              </div>
            ) : paginationData.totalRows === 0 ? (
              <div className="text-center py-12">
                {searchQuery.trim() && isPrUrl(searchQuery) ? (
                  <>
                    <svg className="mx-auto h-12 w-12 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    <h3 className="mt-4 text-sm font-medium text-accent">PR not found in simulated PRs</h3>
                    <p className="mt-2 text-sm text-text-muted">
                      This PR hasn&apos;t been simulated yet. Would you like to simulate it now?
                    </p>
                    <button
                      onClick={() => {
                        setPrUrl(searchQuery.trim());
                        setSearchQuery("");
                        setCreateMode("pr");
                        openCreatePRModal();
                      }}
                      className="mt-4 inline-flex items-center px-4 py-2 rounded-lg bg-primary text-white font-medium text-sm hover:bg-primary-hover transition-colors"
                    >
                      <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                      Simulate PR
                    </button>
                  </>
                ) : (
                  <>
                    <svg className="mx-auto h-12 w-12 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                    </svg>
                    <h3 className="mt-4 text-sm font-medium text-accent">No PRs match the current filters</h3>
                    <p className="mt-2 text-sm text-text-muted">
                      {selectedOwner !== "all"
                        ? `No PRs found for @${selectedOwner}. Try selecting a different user or "All Users".`
                        : searchQuery.trim()
                        ? "Try a different search term, or paste a PR URL to check if it's been simulated."
                        : "Try adjusting your filters to see more PRs."}
                    </p>
                    {(selectedOwner !== "all" || showOnlyWithIssues || internalFilter !== "all") && (
                      <button
                        onClick={() => {
                          setSelectedOwner("all");
                          setShowOnlyWithIssues(false);
                          setInternalFilter("all");
                          setSearchQuery("");
                        }}
                        className="mt-4 inline-flex items-center px-4 py-2 rounded-lg border border-border text-accent font-medium text-sm hover:bg-bg-subtle transition-colors"
                      >
                        Clear All Filters
                      </button>
                    )}
                  </>
                )}
              </div>
            ) : (
              <div className="divide-y divide-border">
                    {paginatedOrgGroups.map((orgGroup) => {
                      const isOrgExpanded = expandedOrgs.has(orgGroup.org);
                      const totalPRsInOrg = orgGroup.forks.reduce((sum, f) => sum + f.prs.length, 0);
                      const totalReposInOrg = orgGroup.forks.length;

                      return (
                        <div key={orgGroup.org}>
                          {/* Org Header - Clickable Accordion */}
                          <div
                            className="flex items-center px-4 md:px-6 py-3 bg-blue-50 hover:bg-blue-100 cursor-pointer transition-colors min-h-[56px] border-b border-blue-100"
                            onClick={() => toggleOrgExpand(orgGroup.org)}
                          >
                            {/* Expand/Collapse Arrow */}
                            <div className="w-6 flex-shrink-0">
                              <svg
                                className={`h-5 w-5 md:h-4 md:w-4 text-blue-600 transition-transform duration-200 ${isOrgExpanded ? "rotate-90" : ""}`}
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                                strokeWidth={2}
                              >
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                              </svg>
                            </div>

                            {/* Org Name and Stats */}
                            <div className="flex-1 flex items-center gap-2 md:gap-3 ml-2 flex-wrap">
                              <a
                                href={`https://github.com/${orgGroup.org}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="text-base font-bold text-blue-900 hover:text-blue-700 hover:underline"
                              >
                                {orgGroup.org}
                              </a>
                              <span className="text-sm text-blue-700">
                                ({totalReposInOrg} repo{totalReposInOrg !== 1 ? "s" : ""}, {totalPRsInOrg} PR{totalPRsInOrg !== 1 ? "s" : ""})
                              </span>

                              {/* Monthly Metrics Badges */}
                              {orgGroup.metrics && (
                                <div className="flex items-center gap-2 ml-auto mr-2">
                                  <span className="text-xs text-blue-600 font-medium">Last 30 days:</span>
                                  <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full bg-blue-100 text-blue-800" title={`${orgGroup.metrics.monthly_prs} PRs in the last 30 days`}>
                                    <svg className="w-3 h-3 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                                    </svg>
                                    {formatMetricNumber(orgGroup.metrics.monthly_prs)} PRs
                                  </span>
                                  <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full bg-green-100 text-green-800" title={`${orgGroup.metrics.monthly_commits} commits in the last 30 days`}>
                                    <svg className="w-3 h-3 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                    {formatMetricNumber(orgGroup.metrics.monthly_commits)} commits
                                  </span>
                                  <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full bg-purple-100 text-purple-800" title={`${orgGroup.metrics.monthly_lines_changed} lines changed in the last 30 days`}>
                                    <svg className="w-3 h-3 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16m-7 6h7" />
                                    </svg>
                                    {formatMetricNumber(orgGroup.metrics.monthly_lines_changed)} lines
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Repos within this Org - Collapsible */}
                          {isOrgExpanded && orgGroup.forks.map((fork) => {
                            const checkboxState = getRepoCheckboxState(fork.repoName);
                            const isExpanded = expandedRepos.has(fork.repoName);
                            const pagePrs = fork.prs;

                            return (
                              <div key={fork.forkUrl} className="ml-4 border-l-2 border-blue-100">
                                {/* Repo Header - Clickable Accordion */}
                                <div
                                  className="flex items-center px-4 md:px-6 py-3 bg-gray-50 hover:bg-gray-100 cursor-pointer transition-colors min-h-[52px]"
                                  onClick={() => toggleRepoExpand(fork.repoName)}
                                >
                                  {/* Expand/Collapse Arrow */}
                                  <div className="w-6 flex-shrink-0">
                                    <svg
                                      className={`h-5 w-5 md:h-4 md:w-4 text-gray-500 transition-transform duration-200 ${isExpanded ? "rotate-90" : ""}`}
                                      fill="none"
                                      viewBox="0 0 24 24"
                                      stroke="currentColor"
                                      strokeWidth={2}
                                    >
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                                    </svg>
                                  </div>

                                  {/* Checkbox */}
                                  <div className="w-10 flex-shrink-0 flex justify-center">
                                    <input
                                      type="checkbox"
                                      checked={checkboxState === "checked"}
                                      ref={(el) => {
                                        if (el) el.indeterminate = checkboxState === "indeterminate";
                                      }}
                                      onChange={(e) => {
                                        e.stopPropagation();
                                        toggleRepoSelection(fork.repoName);
                                      }}
                                      onClick={(e) => e.stopPropagation()}
                                      className="h-5 w-5 md:h-4 md:w-4 rounded border-gray-300 text-primary focus:ring-primary focus:ring-offset-0 cursor-pointer"
                                    />
                            </div>

                            {/* Repo Name and PR Count */}
                            <div className="flex-1 flex items-center gap-2 md:gap-3 ml-2 flex-wrap">
                              <a
                                href={fork.forkUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="text-base font-semibold text-gray-900 hover:text-primary hover:underline"
                              >
                                {fork.repoName}
                              </a>
                              {fork.isInternal && (
                                <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full bg-purple-50 text-purple-700 border border-purple-200">
                                  Internal
                                </span>
                              )}
                              {/* Cache indicator */}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleRepoCache(fork.repoOwner, fork.repoName, fork.isCached ?? false);
                                }}
                                disabled={cachingRepos.has(`${fork.repoOwner}/${fork.repoName}`)}
                                className={`group relative inline-flex items-center justify-center w-7 h-7 text-xs font-medium rounded-full transition-colors ${
                                  cachingRepos.has(`${fork.repoOwner}/${fork.repoName}`)
                                    ? "bg-gray-100 text-gray-400 cursor-wait"
                                    : fork.isCached
                                    ? "bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100"
                                    : "bg-gray-100 text-gray-500 border border-gray-200 hover:bg-gray-200"
                                }`}
                              >
                                {cachingRepos.has(`${fork.repoOwner}/${fork.repoName}`) ? (
                                  <svg className="h-3.5 w-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                  </svg>
                                ) : fork.isCached ? (
                                  <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                                    <path d="M13 10V3L4 14h7v7l9-11h-7z" />
                                  </svg>
                                ) : (
                                  <svg className="h-4 w-4 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4l16 16" />
                                  </svg>
                                )}
                                {/* Delayed tooltip */}
                                <span className="pointer-events-none absolute -bottom-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-xs text-white opacity-0 transition-opacity delay-500 group-hover:opacity-100">
                                  {cachingRepos.has(`${fork.repoOwner}/${fork.repoName}`)
                                    ? "Processing..."
                                    : fork.isCached
                                    ? "Remove from cache"
                                    : "Cache this repo"}
                                </span>
                              </button>
                              <span className="text-sm text-gray-500">
                                ({pagePrs.length} PR{pagePrs.length !== 1 ? "s" : ""})
                              </span>
                            </div>
                          </div>

                          {/* PR List - Collapsible */}
                          {isExpanded && pagePrs.length > 0 && (
                            <div className="bg-white">
                              {/* PR Table Header - Desktop only */}
                              <div className="hidden md:flex items-center px-6 py-2 bg-gray-50/50 border-b border-gray-100 text-xs font-medium text-gray-500 uppercase tracking-wider">
                                <div className="w-6 flex-shrink-0"></div>
                                <div className="w-10 flex-shrink-0"></div>
                                <div className="flex-1 ml-2"></div>
                                <div className="w-[120px] text-center">Analysis</div>
                                <div className="w-[100px] text-center">Bugs</div>
                                <div className="w-[140px] text-center">Created</div>
                                <div className="w-[140px] text-center">Updated</div>
                                <div className="w-[100px] text-center">Owner</div>
                              </div>

                              {/* Mobile PR Cards */}
                              <div className="md:hidden p-3 space-y-3">
                                {pagePrs.map((pr) => (
                                  <PRCard
                                    key={`mobile-${fork.repoName}-${pr.prNumber}`}
                                    pr={pr}
                                    repoName={fork.repoName}
                                    isSelected={selection.prs.has(`${fork.repoName}:${pr.prNumber}`)}
                                    onToggleSelect={() => togglePrSelection(fork.repoName, pr.prNumber)}
                                    onAction={() => startAnalysisFromForks(pr.prUrl, pr.hasAnalysis ?? false, pr.prTitle)}
                                    owner={pr.createdBy}
                                  />
                                ))}
                              </div>

                              {/* PR Rows - Desktop */}
                              <div className="hidden md:block divide-y divide-gray-100">
                                {pagePrs.map((pr) => {
                                  // Bug count badge styling - softer pastel colors
                                  const getBugBadgeStyle = () => {
                                    if (!pr.hasAnalysis) return "bg-gray-100 text-gray-500";
                                    const bugs = pr.macroscopeBugs ?? 0;
                                    if (bugs === 0) return "bg-gray-100 text-gray-600";
                                    if (bugs === 1) return "bg-orange-50 text-orange-700 border border-orange-200";
                                    if (bugs === 2) return "bg-amber-50 text-amber-700 border border-amber-200";
                                    return "bg-red-50 text-red-700 border border-red-200";
                                  };

                                  return (
                                    <div
                                      key={`desktop-${fork.repoName}-${pr.prNumber}`}
                                      className="flex items-center px-6 py-4 hover:bg-gray-50/50 transition-colors"
                                    >
                                      {/* Empty space for arrow alignment */}
                                      <div className="w-6 flex-shrink-0"></div>

                                      {/* Checkbox */}
                                      <div className="w-10 flex-shrink-0 flex justify-center">
                                        <input
                                          type="checkbox"
                                          checked={selection.prs.has(`${fork.repoName}:${pr.prNumber}`)}
                                          onChange={() => togglePrSelection(fork.repoName, pr.prNumber)}
                                          className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary focus:ring-offset-0 cursor-pointer"
                                        />
                                      </div>

                                      {/* PR Title */}
                                      <div className="flex-1 min-w-0 ml-2">
                                        <a
                                          href={pr.prUrl}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="text-sm text-primary hover:underline font-medium"
                                        >
                                          #{pr.prNumber}
                                        </a>
                                        <span className="text-sm text-gray-700 ml-2">
                                          {pr.prTitle}
                                        </span>
                                      </div>

                                      {/* Action Button */}
                                      <div className="w-[120px] flex-shrink-0 flex justify-center">
                                        <button
                                          onClick={() => startAnalysisFromForks(pr.prUrl, pr.hasAnalysis, pr.prTitle)}
                                          className={`inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${
                                            pr.hasAnalysis
                                              ? "bg-green-50 text-green-700 hover:bg-green-100"
                                              : "bg-primary-light text-primary hover:bg-primary/10"
                                          }`}
                                        >
                                          {pr.hasAnalysis ? (
                                            <>
                                              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                              </svg>
                                              View
                                            </>
                                          ) : (
                                            <>
                                              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                              </svg>
                                              Run
                                            </>
                                          )}
                                        </button>
                                      </div>

                                      {/* Bug Count Badge */}
                                      <div className="w-[100px] flex-shrink-0 flex justify-center">
                                        <span className={`inline-flex items-center justify-center min-w-[28px] px-2 py-0.5 text-xs font-semibold rounded-full ${getBugBadgeStyle()}`}>
                                          {pr.hasAnalysis ? (pr.macroscopeBugs ?? 0) : "-"}
                                        </span>
                                      </div>

                                      {/* Created Date */}
                                      <div className="w-[140px] flex-shrink-0 text-sm text-gray-500 text-center">
                                        {formatDate(pr.createdAt)}
                                      </div>

                                      {/* Updated Date */}
                                      <div className="w-[140px] flex-shrink-0 text-sm text-gray-500 text-center">
                                        {pr.updatedAt ? formatDate(pr.updatedAt) : "-"}
                                      </div>

                                      {/* Owner */}
                                      <div className="w-[100px] flex-shrink-0 flex justify-center relative">
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setOwnerDropdownOpen(ownerDropdownOpen === pr.prUrl ? null : pr.prUrl);
                                          }}
                                          className="flex items-center justify-center cursor-pointer hover:ring-2 hover:ring-primary/30 rounded-full transition-all"
                                          title={pr.createdBy ? `@${pr.createdBy} - Click to change owner` : "Click to assign owner"}
                                        >
                                          {pr.createdBy ? (
                                            <Image
                                              src={`https://avatars.githubusercontent.com/${pr.createdBy}`}
                                              alt={pr.createdBy}
                                              width={24}
                                              height={24}
                                              className="rounded-full"
                                              unoptimized
                                            />
                                          ) : (
                                            <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center">
                                              <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                              </svg>
                                            </div>
                                          )}
                                        </button>

                                        {/* Owner Dropdown */}
                                        {ownerDropdownOpen === pr.prUrl && (
                                          <div
                                            ref={ownerDropdownRef}
                                            className="absolute top-full mt-1 right-0 w-48 bg-white border border-border rounded-lg shadow-lg z-30 max-h-60 overflow-y-auto"
                                          >
                                            <div className="p-2">
                                              <p className="text-xs text-text-muted px-2 py-1 font-medium">Assign Owner</p>
                                              {orgUsers.map((user) => (
                                                <button
                                                  key={user.login}
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleOwnerChange(pr.prUrl, user.login);
                                                  }}
                                                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-bg-subtle transition-colors ${
                                                    pr.createdBy === user.login ? "bg-primary/10" : ""
                                                  }`}
                                                >
                                                  <Image
                                                    src={user.avatar_url}
                                                    alt={user.login}
                                                    width={20}
                                                    height={20}
                                                    className="rounded-full"
                                                    unoptimized
                                                  />
                                                  <span className="text-sm text-accent truncate">@{user.login}</span>
                                                  {pr.createdBy === user.login && (
                                                    <svg className="w-4 h-4 text-primary ml-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                                    </svg>
                                                  )}
                                                </button>
                                              ))}
                                              {orgUsers.length === 0 && (
                                                <p className="text-sm text-text-muted px-2 py-2">Loading users...</p>
                                              )}
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}

                                  {/* Empty state for repos with no PRs */}
                                  {isExpanded && pagePrs.length === 0 && (
                                    <div className="px-6 py-8 bg-white text-center ml-4">
                                      <svg className="mx-auto h-8 w-8 text-gray-300 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                      </svg>
                                      <p className="text-sm text-gray-500">No review PRs in this repository</p>
                                      <p className="text-xs text-gray-400 mt-1">Create a PR to get started</p>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        );
                      })}
                  </div>
                )}

                {/* Pagination Controls */}
                {paginationData.totalPages > 1 && (
                  <div className="flex items-center justify-center gap-2 py-4 border-t border-border mt-4">
                    {/* Previous Button */}
                    <button
                      onClick={() => goToPage(currentPage - 1)}
                      disabled={currentPage <= 1}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium rounded-lg border border-border bg-white hover:bg-bg-subtle disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                      </svg>
                      Previous
                    </button>

                    {/* Page Numbers */}
                    <div className="flex items-center gap-1">
                      {(() => {
                        const pages: (number | string)[] = [];
                        const total = paginationData.totalPages;
                        const current = currentPage;

                        if (total <= 7) {
                          // Show all pages if 7 or fewer
                          for (let i = 1; i <= total; i++) pages.push(i);
                        } else {
                          // Always show first page
                          pages.push(1);

                          if (current > 3) {
                            pages.push("...");
                          }

                          // Show pages around current
                          for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) {
                            pages.push(i);
                          }

                          if (current < total - 2) {
                            pages.push("...");
                          }

                          // Always show last page
                          pages.push(total);
                        }

                        return pages.map((page, idx) =>
                          typeof page === "string" ? (
                            <span key={`ellipsis-${idx}`} className="px-2 text-text-muted">
                              ...
                            </span>
                          ) : (
                            <button
                              key={page}
                              onClick={() => goToPage(page)}
                              className={`min-w-[36px] h-9 px-3 text-sm font-medium rounded-lg transition-colors ${
                                page === currentPage
                                  ? "bg-primary text-white"
                                  : "border border-border bg-white hover:bg-bg-subtle"
                              }`}
                            >
                              {page}
                            </button>
                          )
                        );
                      })()}
                    </div>

                    {/* Next Button */}
                    <button
                      onClick={() => goToPage(currentPage + 1)}
                      disabled={currentPage >= paginationData.totalPages}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium rounded-lg border border-border bg-white hover:bg-bg-subtle disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      Next
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                  </div>
                )}

              </div>

              {/* Summary */}
              {forks.length > 0 && (
                <div className="mt-4 text-center">
                  <p className="text-sm text-text-muted">
                    {paginationData.totalRows > 0 ? (
                      <>
                        Page {paginationData.currentPage} of {paginationData.totalPages} ({paginationData.totalPRs} PR{paginationData.totalPRs !== 1 ? "s" : ""} total)
                        {selectedOwner !== "all" && ` - filtered by @${selectedOwner}`}
                      </>
                    ) : (
                      "No PRs match the current filters"
                    )}
                  </p>
                </div>
              )}
        </div>
      </main>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-lg max-w-lg w-full p-6">
            <h3 className="text-lg font-semibold text-accent mb-4">Confirm Delete</h3>

            <p className="text-sm text-text-secondary mb-4">
              Are you sure you want to delete the following? This action cannot be undone.
            </p>

            {/* Repos to delete */}
            {reposToDelete.length > 0 && (
              <div className="mb-4">
                <h4 className="text-sm font-medium text-accent mb-2">
                  Repositories ({reposToDelete.length})
                </h4>
                <div className="bg-bg-subtle rounded-lg border border-border p-3 max-h-32 overflow-y-auto">
                  <ul className="space-y-1">
                    {reposToDelete.map((repo) => (
                      <li key={repo} className="text-sm text-text-secondary flex items-center gap-2">
                        <svg className="h-4 w-4 text-error shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                        <span className="font-medium">{repo}</span>
                        <span className="text-text-muted text-xs">(and all its PRs)</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {/* PRs to delete */}
            {prsToDelete.length > 0 && (
              <div className="mb-4">
                <h4 className="text-sm font-medium text-accent mb-2">
                  Pull Requests ({prsToDelete.length})
                </h4>
                <div className="bg-bg-subtle rounded-lg border border-border p-3 max-h-32 overflow-y-auto">
                  <ul className="space-y-1">
                    {prsToDelete.map((pr) => {
                      const fork = forks.find(f => f.repoName === pr.repo);
                      const prData = fork?.prs.find(p => p.prNumber === pr.prNumber);
                      return (
                        <li key={`${pr.repo}-${pr.prNumber}`} className="text-sm text-text-secondary flex items-center gap-2">
                          <svg className="h-4 w-4 text-error shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                          <span>
                            <span className="font-medium">{pr.repo}</span>
                            <span className="text-text-muted"> / </span>
                            <span>#{pr.prNumber}</span>
                            {prData?.prTitle && (
                              <span className="text-text-muted"> - {prData.prTitle}</span>
                            )}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </div>
            )}

            <div className="flex gap-3 justify-end pt-2">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-4 py-2 text-sm font-medium text-text-secondary hover:text-accent transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                className="px-4 py-2 bg-error hover:bg-error/90 text-white text-sm font-medium rounded-lg transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Analysis Modal */}
      {/* Backdrop */}
      <div
        className={`fixed inset-0 bg-black/50 z-40 transition-opacity duration-200 ${
          showAnalysisModal ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onClick={handleCloseModalWithCheck}
      />
      {/* Modal Container */}
      <div
        className={`fixed inset-0 z-50 flex items-center justify-center p-0 md:p-4 transition-opacity duration-200 ${
          showAnalysisModal ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      >
        <div
          className={`bg-white shadow-lg flex flex-col transition-all duration-200 ease-out ${
            showAnalysisModal ? "scale-100 opacity-100" : "scale-95 opacity-0"
          } ${
            modalExpanded
              ? "w-full h-full md:w-[calc(100%-2rem)] md:h-[calc(100%-2rem)] max-w-none rounded-none md:rounded-xl"
              : "w-full h-full md:max-w-4xl md:h-[700px] md:rounded-xl rounded-none"
          }`}
          onClick={(e) => e.stopPropagation()}
        >
            {/* Modal Header */}
            <div className="flex items-center justify-between px-4 md:px-10 py-3 md:py-4 border-b border-border shrink-0">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-base md:text-lg font-semibold text-accent truncate">
                    {selectedPrTitle || "PR Analysis"}
                  </h2>
                  {/* PR Status Badge */}
                  {analysisResult?.originalPrState && (
                    <span className={`px-2 py-0.5 text-xs font-medium rounded-full shrink-0 ${
                      analysisResult.originalPrState === "merged"
                        ? "bg-green-100 text-green-700"
                        : analysisResult.originalPrState === "open"
                        ? "bg-blue-100 text-blue-700"
                        : "bg-gray-100 text-gray-600"
                    }`}>
                      {analysisResult.originalPrState === "merged" ? (
                        <>
                          Merged
                          {analysisResult.originalPrMergedAt && (() => {
                            const mergedDate = new Date(analysisResult.originalPrMergedAt);
                            const now = new Date();
                            const diffDays = Math.floor((now.getTime() - mergedDate.getTime()) / (1000 * 60 * 60 * 24));
                            if (diffDays === 0) return " today";
                            if (diffDays === 1) return " yesterday";
                            if (diffDays < 7) return ` ${diffDays}d ago`;
                            if (diffDays < 30) return ` ${Math.floor(diffDays / 7)}w ago`;
                            return "";
                          })()}
                        </>
                      ) : analysisResult.originalPrState === "open" ? (
                        "Open"
                      ) : (
                        "Closed"
                      )}
                    </span>
                  )}
                </div>
                {analysisForkedUrl && (
                  <a
                    href={analysisForkedUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs md:text-sm text-primary hover:underline truncate block"
                  >
                    {analysisForkedUrl}
                  </a>
                )}
              </div>
              <div className="flex items-center gap-1 md:gap-2 ml-2 md:ml-4">
                {/* Expand/Collapse Button - hidden on mobile */}
                <button
                  onClick={() => setModalExpanded(!modalExpanded)}
                  className="hidden md:flex p-2 min-h-[44px] min-w-[44px] items-center justify-center text-text-secondary hover:text-accent hover:bg-bg-subtle rounded-lg transition-colors"
                  title={modalExpanded ? "Collapse" : "Expand"}
                >
                  {modalExpanded ? (
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" />
                    </svg>
                  ) : (
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
                    </svg>
                  )}
                </button>
                {/* Close Button */}
                <button
                  onClick={handleCloseModalWithCheck}
                  className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center text-text-secondary hover:text-accent hover:bg-bg-subtle rounded-lg transition-colors"
                >
                  <svg className="h-6 w-6 md:h-5 md:w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Modal Tabs */}
            <div className="flex border-b border-border px-4 md:px-10 shrink-0">
              <button
                onClick={() => setModalTab("analysis")}
                className={`px-3 md:px-4 py-3 md:py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px min-h-[44px] ${
                  modalTab === "analysis"
                    ? "border-primary text-primary"
                    : "border-transparent text-text-secondary hover:text-accent"
                }`}
              >
                Analysis
              </button>
              {(generatedEmail || emailLoading) && (
                <button
                  onClick={() => setModalTab("email")}
                  className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px flex items-center gap-2 ${
                    modalTab === "email"
                      ? "border-primary text-primary"
                      : "border-transparent text-text-secondary hover:text-accent"
                  }`}
                >
                  Email
                  {emailLoading && (
                    <svg className="animate-spin h-3.5 w-3.5" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                  )}
                </button>
              )}
            </div>

            {/* Modal Content */}
            <div className="flex-1 overflow-y-auto px-10 py-6">
              {modalTab === "analysis" ? (
                <div className="space-y-6">
                  {/* Hidden Analysis Form - auto-submits when modal opens for existing analysis */}
                  <form id="analysis-form" onSubmit={handleAnalysis} className="hidden">
                    <input type="hidden" value={analysisForkedUrl} />
                  </form>

                  {/* Loading State - Full Skeleton Screen */}
                  {(analysisLoading || (expectingCachedResult && !analysisResult)) && (
                    <div className="space-y-6">
                      {/* Summary section skeleton */}
                      <div>
                        <div className="h-6 bg-gray-200 rounded w-32 mb-3 animate-pulse" />
                        <div className="space-y-2">
                          <div className="h-4 bg-gray-200 rounded w-full animate-pulse" />
                          <div className="h-4 bg-gray-200 rounded w-5/6 animate-pulse" />
                          <div className="h-4 bg-gray-200 rounded w-4/5 animate-pulse" />
                        </div>
                      </div>

                      {/* Bugs section skeleton */}
                      <div>
                        <div className="h-6 bg-gray-200 rounded w-48 mb-3 animate-pulse" />
                        <div className="space-y-4">
                          {[1, 2, 3].map(i => (
                            <div key={i} className="border border-gray-200 rounded-lg p-4">
                              <div className="flex items-center gap-2 mb-2">
                                <div className="h-5 w-16 bg-gray-200 rounded-full animate-pulse" />
                                <div className="h-5 w-48 bg-gray-200 rounded animate-pulse" />
                              </div>
                              <div className="space-y-2">
                                <div className="h-4 bg-gray-200 rounded w-full animate-pulse" />
                                <div className="h-4 bg-gray-200 rounded w-full animate-pulse" />
                                <div className="h-4 bg-gray-200 rounded w-2/3 animate-pulse" />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Recommendations section skeleton */}
                      <div>
                        <div className="h-6 bg-gray-200 rounded w-40 mb-3 animate-pulse" />
                        <div className="space-y-2">
                          <div className="h-4 bg-gray-200 rounded w-full animate-pulse" />
                          <div className="h-4 bg-gray-200 rounded w-full animate-pulse" />
                          <div className="h-4 bg-gray-200 rounded w-3/4 animate-pulse" />
                        </div>
                      </div>

                      {/* Subtle loading message at bottom */}
                      <div className="pt-4 border-t border-gray-200">
                        <div className="flex items-center justify-center gap-2 text-sm text-gray-500">
                          <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                          </svg>
                          <span>
                            {expectingCachedResult ? "Loading cached analysis..." : "Analyzing PR with Macroscope AI..."}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Prompt for Original PR URL */}
                  {showUrlPrompt && (
                    <div className="py-8 px-4">
                      <div className="max-w-md mx-auto">
                        <div className="text-center mb-6">
                          <svg className="mx-auto h-12 w-12 text-amber-500 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                          </svg>
                          <h3 className="text-lg font-medium text-accent mb-2">Original PR URL Required</h3>
                          <p className="text-sm text-text-secondary">
                            We couldn&apos;t determine the original PR URL automatically. Please enter it below to continue with the analysis.
                          </p>
                        </div>
                        <form onSubmit={handleOriginalUrlSubmit} className="space-y-4">
                          <div>
                            <label htmlFor="original-pr-url" className="block text-sm font-medium text-text-primary mb-1">
                              Original PR URL
                            </label>
                            <input
                              id="original-pr-url"
                              type="url"
                              value={analysisOriginalUrl}
                              onChange={(e) => setAnalysisOriginalUrl(e.target.value)}
                              placeholder="https://github.com/owner/repo/pull/123"
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary text-sm"
                              autoFocus
                            />
                            <p className="mt-1 text-xs text-text-muted">
                              Enter the URL of the original PR that was simulated
                            </p>
                          </div>
                          <div className="flex gap-3">
                            <button
                              type="button"
                              onClick={() => setShowUrlPrompt(false)}
                              className="flex-1 px-4 py-2 border border-gray-300 text-text-secondary hover:bg-gray-50 font-medium rounded-lg transition-colors"
                            >
                              Cancel
                            </button>
                            <button
                              type="submit"
                              disabled={!analysisOriginalUrl.trim()}
                              className="flex-1 px-4 py-2 bg-primary hover:bg-primary-hover disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
                            >
                              Continue Analysis
                            </button>
                          </div>
                        </form>
                      </div>
                    </div>
                  )}

                  {/* No Analysis Yet - Show Run Button */}
                  {!analysisLoading && !analysisResult && !expectingCachedResult && !showUrlPrompt && (
                    <div className="text-center py-12">
                      <svg className="mx-auto h-12 w-12 text-text-muted mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                      </svg>
                      <h3 className="text-lg font-medium text-accent mb-2">Ready to Analyze</h3>
                      <p className="text-sm text-text-secondary mb-6">
                        Click the button below to analyze this PR for bugs found by Macroscope.
                      </p>
                      <button
                        onClick={(e) => handleAnalysis(e as React.FormEvent)}
                        className="inline-flex items-center gap-2 px-6 py-3 bg-primary hover:bg-primary-hover text-white font-medium rounded-lg transition-colors"
                      >
                        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        Run Analysis
                      </button>
                    </div>
                  )}

                  {/* Analysis Results */}
                  {!analysisLoading && analysisResult && (
                    <div className="space-y-6">
                      {/* Cache indicator */}
                      {isViewingCached && (
                        <div className="flex items-center justify-between bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
                          <div className="flex items-center gap-2 text-blue-700">
                            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <span className="text-sm font-medium">Viewing cached analysis</span>
                          </div>
                          <button
                            onClick={(e) => handleAnalysis(e as React.FormEvent, true)}
                            className="text-sm text-blue-700 hover:text-blue-800 font-medium underline"
                          >
                            Regenerate
                          </button>
                        </div>
                      )}

                      {analysisResult.success && analysisResult.result ? (
                        /* Check if result has meaningful bugs using format-agnostic helper */
                        resultHasMeaningfulBugs(analysisResult.result) ? (
                          <>
                            {/* V2 Format Display */}
                            {isV2Result(analysisResult.result) ? (
                              <>
                                {/* Summary Header */}
                                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                                    <div className="flex items-center gap-2 text-amber-800">
                                      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                      </svg>
                                      <span className="font-semibold">
                                        {analysisResult.result.total_comments_processed} comments analyzed
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-3 text-sm">
                                      <span className="text-amber-700">
                                        {analysisResult.result.meaningful_bugs_count} meaningful bug{analysisResult.result.meaningful_bugs_count !== 1 ? "s" : ""}
                                      </span>
                                      {analysisResult.result.outreach_ready_count > 0 && (
                                        <span className="text-green-700">
                                          {analysisResult.result.outreach_ready_count} outreach ready
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                  {/* Recommendation */}
                                  {analysisResult.result.summary.recommendation && (
                                    <p className="mt-3 text-sm text-amber-800 border-t border-amber-200 pt-3">
                                      <span className="font-medium">Recommendation:</span> {analysisResult.result.summary.recommendation}
                                    </p>
                                  )}
                                </div>

                                {/* Comments List - Grouped by Category */}
                                <div className="space-y-4">
                                  {analysisResult.result.all_comments.map((comment, index) => {
                                    const v2Result = analysisResult.result as PRAnalysisResultV2;
                                    const isBestForOutreach = comment.index === v2Result.best_bug_for_outreach_index;
                                    const isSelected = comment.index === selectedBugIndex;
                                    const categoryColors: Record<CommentCategory, string> = {
                                      bug_critical: "bg-red-100 text-red-800 border-red-200",
                                      bug_high: "bg-orange-100 text-orange-800 border-orange-200",
                                      bug_medium: "bg-yellow-100 text-yellow-800 border-yellow-200",
                                      bug_low: "bg-blue-100 text-blue-800 border-blue-200",
                                      suggestion: "bg-purple-100 text-purple-800 border-purple-200",
                                      style: "bg-gray-100 text-gray-800 border-gray-200",
                                      nitpick: "bg-gray-100 text-gray-600 border-gray-200",
                                    };
                                    const categoryLabels: Record<CommentCategory, string> = {
                                      bug_critical: "Critical",
                                      bug_high: "High",
                                      bug_medium: "Medium",
                                      bug_low: "Low",
                                      suggestion: "Suggestion",
                                      style: "Style",
                                      nitpick: "Nitpick",
                                    };
                                    const categoryIcons: Record<CommentCategory, string> = {
                                      bug_critical: "🔴",
                                      bug_high: "🟠",
                                      bug_medium: "🟡",
                                      bug_low: "🔵",
                                      suggestion: "💡",
                                      style: "✨",
                                      nitpick: "📝",
                                    };

                                    return (
                                      <div
                                        key={index}
                                        onClick={comment.is_meaningful_bug ? () => setSelectedBugIndex(comment.index) : undefined}
                                        className={`border rounded-lg overflow-hidden transition-colors ${
                                          isSelected ? "border-primary ring-1 ring-primary/20" : "border-border"
                                        } ${comment.is_meaningful_bug ? "cursor-pointer hover:border-primary/50" : ""}`}
                                      >
                                        <div className="px-4 py-3 bg-bg-subtle border-b border-border flex items-center justify-between">
                                          <div className="flex items-center gap-2 flex-wrap">
                                            <span className={`px-2 py-0.5 text-xs font-medium rounded border ${categoryColors[comment.category]}`}>
                                              {categoryIcons[comment.category]} {categoryLabels[comment.category]}
                                            </span>
                                            {comment.is_meaningful_bug && (
                                              <span className="px-2 py-0.5 text-xs font-medium rounded bg-amber-100 text-amber-800 border border-amber-200">
                                                Bug
                                              </span>
                                            )}
                                            {comment.outreach_ready && (
                                              <span className="px-2 py-0.5 text-xs font-medium rounded bg-green-100 text-green-800 border border-green-200">
                                                Outreach Ready
                                              </span>
                                            )}
                                            {isBestForOutreach && (
                                              <span className="px-2 py-0.5 text-xs font-medium rounded bg-primary/10 text-primary border border-primary/20">
                                                Best for Outreach
                                              </span>
                                            )}
                                          </div>
                                          <button
                                            onClick={() => copyBugExplanation(comment.explanation, index)}
                                            className="text-xs text-text-secondary hover:text-accent flex items-center gap-1"
                                          >
                                            {copiedBugIndex === index ? (
                                              <>
                                                <svg className="h-4 w-4 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                                </svg>
                                                Copied!
                                              </>
                                            ) : (
                                              <>
                                                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                                </svg>
                                                Copy
                                              </>
                                            )}
                                          </button>
                                        </div>
                                        <div className="p-4">
                                          <h4 className="font-medium text-accent mb-2">{comment.title}</h4>
                                          <p className="text-sm text-text-secondary mb-3">{comment.explanation}</p>
                                          {comment.impact_scenario && (
                                            <p className="text-sm text-amber-700 bg-amber-50 p-2 rounded mb-3">
                                              <span className="font-medium">Impact:</span> {comment.impact_scenario}
                                            </p>
                                          )}
                                          {comment.code_snippet_image_url ? (
                                            <div className="mb-3">
                                              <p className="text-xs text-text-muted mb-1">Suggested fix:</p>
                                              <img
                                                src={comment.code_snippet_image_url}
                                                alt="Code suggestion"
                                                className="max-w-full rounded shadow-sm"
                                              />
                                            </div>
                                          ) : comment.code_suggestion && (
                                            <div className="mb-3">
                                              <p className="text-xs text-text-muted mb-1">Suggested fix:</p>
                                              <pre className="text-xs bg-gray-100 p-2 rounded overflow-x-auto">
                                                <code>{comment.code_suggestion}</code>
                                              </pre>
                                            </div>
                                          )}
                                          <div className="flex items-center gap-2 flex-wrap">
                                            <div className="text-xs text-text-muted font-mono bg-bg-subtle px-2 py-1 rounded">
                                              {comment.file_path}{comment.line_number ? `:${comment.line_number}` : ""}
                                            </div>
                                            {!comment.outreach_ready && comment.outreach_skip_reason && (
                                              <div className="text-xs text-gray-500 italic">
                                                Skip reason: {comment.outreach_skip_reason}
                                              </div>
                                            )}
                                          </div>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </>
                            ) : (
                              /* V1 Format Display (legacy) */
                              <>
                                {/* Summary */}
                                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                                  <div className="flex items-center gap-2 text-amber-800">
                                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                    </svg>
                                    <span className="font-semibold">
                                      Found {(analysisResult.result as MeaningfulBugsResult).total_macroscope_bugs_found} bug
                                      {(analysisResult.result as MeaningfulBugsResult).total_macroscope_bugs_found !== 1 ? "s" : ""}
                                    </span>
                                  </div>
                                </div>

                                {/* Bug List */}
                                <div className="space-y-4">
                                  {(analysisResult.result as MeaningfulBugsResult).bugs.map((bug, index) => (
                                    <div
                                      key={index}
                                      className={`border rounded-lg overflow-hidden ${
                                        bug.is_most_impactful ? "border-primary ring-1 ring-primary/20" : "border-border"
                                      }`}
                                    >
                                      <div className="px-4 py-3 bg-bg-subtle border-b border-border flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                          <span className={`px-2 py-0.5 text-xs font-medium rounded border ${getSeverityColor(bug.severity)}`}>
                                            {bug.severity}
                                          </span>
                                          {bug.is_most_impactful && (
                                            <span className="px-2 py-0.5 text-xs font-medium rounded bg-primary/10 text-primary border border-primary/20">
                                              Most Impactful
                                            </span>
                                          )}
                                        </div>
                                        <button
                                          onClick={() => copyBugExplanation(bug.explanation, index)}
                                          className="text-xs text-text-secondary hover:text-accent flex items-center gap-1"
                                        >
                                          {copiedBugIndex === index ? (
                                            <>
                                              <svg className="h-4 w-4 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                              </svg>
                                              Copied!
                                            </>
                                          ) : (
                                            <>
                                              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                              </svg>
                                              Copy
                                            </>
                                          )}
                                        </button>
                                      </div>
                                      <div className="p-4">
                                        <h4 className="font-medium text-accent mb-2">{bug.title}</h4>
                                        <p className="text-sm text-text-secondary mb-3">{bug.explanation}</p>
                                        <div className="text-xs text-text-muted font-mono bg-bg-subtle px-2 py-1 rounded inline-block">
                                          {bug.file_path}
                                        </div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </>
                            )}

                            {/* Generate Email Button - only show if no email exists */}
                            {!generatedEmail && (
                              <div className="border-t border-border pt-6">
                                <h3 className="text-sm font-medium text-accent mb-3">Generate Outreach Email</h3>
                                {/* Warning for closed PRs */}
                                {analysisResult?.originalPrState === "closed" && (
                                  <div className="mb-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                                    <div className="flex items-start gap-2">
                                      <svg className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                      </svg>
                                      <div className="text-sm text-amber-800">
                                        <p className="font-medium">This PR was closed without being merged</p>
                                        <p className="text-amber-700 mt-1">Outreach for abandoned PRs may not be relevant. Consider whether this is still a good outreach opportunity.</p>
                                      </div>
                                    </div>
                                  </div>
                                )}
                                <button
                                  onClick={handleGenerateEmail}
                                  disabled={emailLoading}
                                  className="inline-flex items-center gap-2 px-4 py-2.5 bg-primary hover:bg-primary-hover text-white font-medium rounded-lg transition-colors disabled:opacity-50"
                                >
                                  {emailLoading ? (
                                    <>
                                      <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                      </svg>
                                      Generating...
                                    </>
                                  ) : (
                                    <>
                                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                                      </svg>
                                      Generate Email
                                    </>
                                  )}
                                </button>
                                {emailError && (
                                  <p className="mt-2 text-sm text-error">{emailError}</p>
                                )}
                              </div>
                            )}
                          </>
                        ) : (
                          /* No Meaningful Bugs Found - but still show all comments */
                          <div className="space-y-6">
                            {/* Summary Banner */}
                            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                              <div className="flex items-center gap-3">
                                <svg className="h-6 w-6 text-green-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                <div>
                                  <h3 className="font-medium text-green-800">No Meaningful Bugs Found</h3>
                                  <p className="text-sm text-green-700 mt-1">
                                    {isV2Result(analysisResult.result)
                                      ? analysisResult.result.summary.recommendation
                                      : (analysisResult.result as NoMeaningfulBugsResult).reason}
                                  </p>
                                </div>
                              </div>
                              {isV2Result(analysisResult.result) && analysisResult.result.all_comments.length > 0 && (
                                <p className="text-xs text-green-600 mt-3 pt-3 border-t border-green-200">
                                  {analysisResult.result.total_comments_processed} comment{analysisResult.result.total_comments_processed !== 1 ? "s" : ""} analyzed below
                                </p>
                              )}
                            </div>

                            {/* All Comments List - even when no meaningful bugs */}
                            {isV2Result(analysisResult.result) && analysisResult.result.all_comments.length > 0 && (
                              <div className="space-y-4">
                                <h4 className="text-sm font-medium text-text-secondary">All Macroscope Comments</h4>
                                {analysisResult.result.all_comments.map((comment, index) => {
                                  const categoryColors: Record<CommentCategory, string> = {
                                    bug_critical: "bg-red-100 text-red-800 border-red-200",
                                    bug_high: "bg-orange-100 text-orange-800 border-orange-200",
                                    bug_medium: "bg-yellow-100 text-yellow-800 border-yellow-200",
                                    bug_low: "bg-amber-50 text-amber-700 border-amber-200",
                                    suggestion: "bg-blue-100 text-blue-700 border-blue-200",
                                    style: "bg-purple-100 text-purple-700 border-purple-200",
                                    nitpick: "bg-gray-100 text-gray-600 border-gray-200",
                                  };
                                  const categoryLabels: Record<CommentCategory, string> = {
                                    bug_critical: "Critical",
                                    bug_high: "High",
                                    bug_medium: "Medium",
                                    bug_low: "Low",
                                    suggestion: "Suggestion",
                                    style: "Style",
                                    nitpick: "Nitpick",
                                  };
                                  const categoryIcons: Record<CommentCategory, string> = {
                                    bug_critical: "🔴",
                                    bug_high: "🟠",
                                    bug_medium: "🟡",
                                    bug_low: "🔵",
                                    suggestion: "💡",
                                    style: "✨",
                                    nitpick: "📝",
                                  };

                                  // Muted card styling for non-outreach items
                                  const cardBorderClass = comment.is_meaningful_bug
                                    ? "border-amber-200"
                                    : "border-gray-200";
                                  const cardBgClass = comment.is_meaningful_bug
                                    ? "bg-amber-50/30"
                                    : "bg-gray-50/50";

                                  return (
                                    <div
                                      key={index}
                                      className={`border rounded-lg overflow-hidden ${cardBorderClass}`}
                                    >
                                      <div className={`px-4 py-3 ${cardBgClass} border-b ${cardBorderClass} flex items-center justify-between`}>
                                        <div className="flex items-center gap-2 flex-wrap">
                                          <span className={`px-2 py-0.5 text-xs font-medium rounded border ${categoryColors[comment.category]}`}>
                                            {categoryIcons[comment.category]} {categoryLabels[comment.category]}
                                          </span>
                                          {comment.is_meaningful_bug && (
                                            <span className="px-2 py-0.5 text-xs font-medium rounded bg-amber-100 text-amber-800 border border-amber-200">
                                              Bug
                                            </span>
                                          )}
                                        </div>
                                        <button
                                          onClick={() => copyBugExplanation(comment.explanation, index)}
                                          className="text-xs text-text-secondary hover:text-accent flex items-center gap-1"
                                        >
                                          {copiedBugIndex === index ? (
                                            <>
                                              <svg className="h-4 w-4 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                              </svg>
                                              Copied!
                                            </>
                                          ) : (
                                            <>
                                              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                              </svg>
                                              Copy
                                            </>
                                          )}
                                        </button>
                                      </div>
                                      <div className="p-4">
                                        <h4 className="font-medium text-accent mb-2">{comment.title}</h4>
                                        <p className="text-sm text-text-secondary mb-3">{comment.explanation}</p>
                                        {comment.impact_scenario && (
                                          <p className="text-sm text-amber-700 bg-amber-50 p-2 rounded mb-3">
                                            <span className="font-medium">Impact:</span> {comment.impact_scenario}
                                          </p>
                                        )}
                                        {comment.code_snippet_image_url ? (
                                          <div className="mb-3">
                                            <p className="text-xs text-text-muted mb-1">Suggested fix:</p>
                                            <img
                                              src={comment.code_snippet_image_url}
                                              alt="Code suggestion"
                                              className="max-w-full rounded shadow-sm"
                                            />
                                          </div>
                                        ) : comment.code_suggestion && (
                                          <div className="mb-3">
                                            <p className="text-xs text-text-muted mb-1">Suggested fix:</p>
                                            <pre className="text-xs bg-gray-100 p-2 rounded overflow-x-auto">
                                              <code>{comment.code_suggestion}</code>
                                            </pre>
                                          </div>
                                        )}
                                        <div className="flex flex-col gap-2">
                                          <div className="text-xs text-text-muted font-mono bg-bg-subtle px-2 py-1 rounded w-fit">
                                            {comment.file_path}{comment.line_number ? `:${comment.line_number}` : ""}
                                          </div>
                                          {comment.outreach_skip_reason && (
                                            <div className="text-xs text-gray-500 bg-gray-50 px-2 py-1.5 rounded border border-gray-100">
                                              <span className="font-medium">Not for outreach:</span> {comment.outreach_skip_reason}
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        )
                      ) : (
                        /* Error State */
                        <div className="rounded-lg border border-error/20 bg-error-light p-4">
                          <div className="flex items-center gap-2 text-error">
                            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <span className="font-medium">Analysis Failed</span>
                          </div>
                          <p className="mt-2 text-sm text-text-secondary">{analysisResult.error}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                /* Email Tab */
                <div className="space-y-4">
                  {emailLoading ? (
                    /* Email Skeleton */
                    <div className="space-y-4 animate-pulse">
                      <div className="flex items-center justify-between">
                        <div className="h-5 w-32 bg-gray-200 rounded" />
                        <div className="h-5 w-28 bg-gray-200 rounded" />
                      </div>
                      <div className="bg-bg-subtle border border-border rounded-lg p-4 space-y-3">
                        {/* Email content skeleton lines */}
                        <div className="h-4 w-24 bg-gray-200 rounded" />
                        <div className="h-4 w-full bg-gray-200 rounded" />
                        <div className="h-4 w-full bg-gray-200 rounded" />
                        <div className="h-4 w-3/4 bg-gray-200 rounded" />
                        <div className="h-4 w-0" /> {/* Spacer */}
                        <div className="h-4 w-full bg-gray-200 rounded" />
                        <div className="h-4 w-full bg-gray-200 rounded" />
                        <div className="h-4 w-5/6 bg-gray-200 rounded" />
                        <div className="h-4 w-full bg-gray-200 rounded" />
                        <div className="h-4 w-2/3 bg-gray-200 rounded" />
                        <div className="h-4 w-0" /> {/* Spacer */}
                        <div className="h-4 w-full bg-gray-200 rounded" />
                        <div className="h-4 w-4/5 bg-gray-200 rounded" />
                        <div className="h-4 w-0" /> {/* Spacer */}
                        <div className="h-4 w-20 bg-gray-200 rounded" />
                        <div className="h-4 w-32 bg-gray-200 rounded" />
                      </div>
                      {/* Loading indicator */}
                      <div className="flex items-center justify-center gap-2 text-text-secondary text-sm">
                        <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        <span>Generating email...</span>
                      </div>
                    </div>
                  ) : (
                    /* Email Sequence Content */
                    <>
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-sm font-medium text-accent">4-Email Outreach Sequence</h3>
                        <div className="flex items-center gap-3">
                          <button
                            onClick={handleGenerateEmail}
                            className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-accent font-medium"
                          >
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                            Regenerate
                          </button>
                          <button
                            onClick={copyEmail}
                            className="inline-flex items-center gap-1.5 text-sm text-primary hover:text-primary-hover font-medium"
                          >
                            {emailCopied ? (
                              <>
                                <svg className="h-4 w-4 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                </svg>
                                Copied!
                              </>
                            ) : (
                              <>
                                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                </svg>
                                Copy Selected
                              </>
                            )}
                          </button>
                        </div>
                      </div>

                      {/* Email Sequence Tabs */}
                      <div className="border-b border-border mb-4">
                        <div className="flex gap-1">
                          {([
                            { key: "email_1", label: "Email 1", desc: "Proof Point" },
                            { key: "email_2", label: "Email 2", desc: "Fix Offer" },
                            { key: "email_3", label: "Email 3", desc: "Broader Value" },
                            { key: "email_4", label: "Email 4", desc: "Breakup" },
                          ] as const).map(({ key, label, desc }) => (
                            <button
                              key={key}
                              onClick={() => setActiveEmailTab(key)}
                              className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
                                activeEmailTab === key
                                  ? "border-primary text-primary"
                                  : "border-transparent text-text-secondary hover:text-accent hover:border-gray-300"
                              }`}
                            >
                              <span>{label}</span>
                              <span className="hidden sm:inline text-xs ml-1 opacity-70">({desc})</span>
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Active Email Content - Editable */}
                      {editedEmail && (
                        <div className="bg-bg-subtle border border-border rounded-lg p-4 space-y-3">
                          <div className="flex items-start gap-2">
                            <label className="text-sm font-medium text-accent shrink-0 pt-2">Subject:</label>
                            <input
                              type="text"
                              value={editedEmail[activeEmailTab].subject}
                              onChange={(e) => handleEmailEdit("subject", e.target.value)}
                              className="flex-1 px-3 py-2 text-sm text-text-primary bg-white border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                            />
                          </div>
                          <div className="border-t border-border pt-3">
                            <label className="text-sm font-medium text-accent block mb-2">Body:</label>
                            <textarea
                              value={editedEmail[activeEmailTab].body}
                              onChange={(e) => handleEmailEdit("body", e.target.value)}
                              rows={12}
                              className="w-full px-3 py-2 text-sm text-text-secondary bg-white border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary resize-y font-sans"
                            />
                          </div>
                          {/* Save Button - only shown when there are unsaved changes */}
                          {hasUnsavedEmailChanges() && (
                            <div className="flex items-center justify-between pt-2 border-t border-border">
                              <span className="text-xs text-amber-600">You have unsaved changes</span>
                              <button
                                onClick={handleSaveEmail}
                                disabled={emailSaving}
                                className="px-4 py-2 text-sm font-medium bg-primary hover:bg-primary-hover text-white rounded-lg transition-colors disabled:opacity-50"
                              >
                                {emailSaving ? (
                                  <span className="flex items-center gap-2">
                                    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                    </svg>
                                    Saving...
                                  </span>
                                ) : (
                                  "Save Changes"
                                )}
                              </button>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Attio Integration Section */}
                      {editedEmail && (
                        <div className="mt-6 border-t border-border pt-6">
                          <h3 className="text-sm font-medium text-accent mb-3">Send to Attio</h3>
                          <p className="text-xs text-text-secondary mb-4">
                            Search for a company in Attio and send all 4 emails to their custom attributes.
                          </p>

                          {/* Search Input */}
                          <div className="flex gap-2 mb-3">
                            <input
                              type="text"
                              value={attioSearchQuery}
                              onChange={(e) => setAttioSearchQuery(e.target.value)}
                              onKeyDown={(e) => e.key === "Enter" && handleAttioSearch()}
                              placeholder="Search company name..."
                              className="flex-1 px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                            />
                            <button
                              onClick={handleAttioSearch}
                              disabled={attioSearchLoading || !attioSearchQuery.trim()}
                              className="px-4 py-2 text-sm font-medium bg-bg-subtle hover:bg-gray-100 border border-border rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {attioSearchLoading ? (
                                <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                </svg>
                              ) : (
                                "Search"
                              )}
                            </button>
                          </div>

                          {/* Search Results */}
                          {attioSearchResults.length > 0 && (
                            <div className="mb-3 border border-border rounded-lg divide-y divide-border max-h-48 overflow-y-auto">
                              {attioSearchResults.map((record) => (
                                <button
                                  key={record.id}
                                  onClick={() => setAttioSelectedRecord({ id: record.id, name: record.name })}
                                  className={`w-full px-3 py-2 text-left text-sm hover:bg-bg-subtle transition-colors ${
                                    attioSelectedRecord?.id === record.id ? "bg-primary/5 border-l-2 border-l-primary" : ""
                                  }`}
                                >
                                  <div className="font-medium text-text-primary">{record.name}</div>
                                  {record.domain && (
                                    <div className="text-xs text-text-secondary">{record.domain}</div>
                                  )}
                                </button>
                              ))}
                            </div>
                          )}

                          {/* Selected Record & Send Button */}
                          {attioSelectedRecord && (
                            <div className="flex items-center justify-between p-3 bg-primary/5 border border-primary/20 rounded-lg">
                              <div>
                                <div className="text-sm font-medium text-text-primary">
                                  Selected: {attioSelectedRecord.name}
                                </div>
                                <div className="text-xs text-text-secondary">
                                  Will send all 4 emails to company custom attributes
                                </div>
                              </div>
                              <button
                                onClick={handleAttioSend}
                                disabled={attioSending}
                                className="px-4 py-2 text-sm font-medium bg-primary hover:bg-primary-hover text-white rounded-lg transition-colors disabled:opacity-50"
                              >
                                {attioSending ? (
                                  <span className="flex items-center gap-2">
                                    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                    </svg>
                                    Sending...
                                  </span>
                                ) : attioSendSuccess ? (
                                  <span className="flex items-center gap-2">
                                    <svg className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                    </svg>
                                    Sent
                                  </span>
                                ) : (
                                  "Send to Attio"
                                )}
                              </button>
                            </div>
                          )}

                          {/* Error Message */}
                          {attioError && (
                            <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
                              <div className="flex items-start gap-2">
                                <svg className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                <div className="text-sm text-red-800">{attioError}</div>
                              </div>
                            </div>
                          )}

                          {/* Success Message */}
                          {attioSendSuccess && (
                            <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg">
                              <div className="flex items-start gap-2">
                                <svg className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                </svg>
                                <div className="text-sm text-green-800">
                                  Email sequence sent to Attio successfully
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      {/* End Analysis Modal */}

      {/* Unsaved Changes Prompt Modal */}
      {showUnsavedChangesPrompt && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-black/50"
            onClick={() => setShowUnsavedChangesPrompt(false)}
          />
          <div className="relative bg-white rounded-xl shadow-lg p-6 max-w-md w-full">
            <h3 className="text-lg font-semibold text-accent mb-2">Unsaved Changes</h3>
            <p className="text-sm text-text-secondary mb-6">
              You have unsaved changes to your email. Would you like to save them before closing?
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={handleDiscardChanges}
                className="px-4 py-2 text-sm font-medium text-text-secondary hover:text-accent hover:bg-bg-subtle rounded-lg transition-colors"
              >
                Discard
              </button>
              <button
                onClick={() => setShowUnsavedChangesPrompt(false)}
                className="px-4 py-2 text-sm font-medium text-text-secondary hover:text-accent hover:bg-bg-subtle rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveAndClose}
                disabled={emailSaving}
                className="px-4 py-2 text-sm font-medium bg-primary hover:bg-primary-hover text-white rounded-lg transition-colors disabled:opacity-50"
              >
                {emailSaving ? "Saving..." : "Save & Close"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create PR Modal */}
      {showCreatePRModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-2 md:p-4 z-50">
          <div
            className={`bg-white rounded-xl shadow-lg flex flex-col transition-all duration-200 ${
              createPRModalExpanded
                ? "w-full h-full md:w-[calc(100%-2rem)] md:h-[calc(100%-2rem)] max-w-none rounded-none md:rounded-xl"
                : "w-full max-w-4xl max-h-[95vh] md:max-h-[90vh]"
            }`}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between px-4 md:px-6 py-3 md:py-4 border-b border-border shrink-0">
              <h2 className="text-lg font-semibold text-accent">Create PR</h2>
              <div className="flex items-center gap-1 md:gap-2">
                {/* Expand/Collapse Button - hidden on mobile */}
                <button
                  onClick={() => setCreatePRModalExpanded(!createPRModalExpanded)}
                  className="hidden md:flex p-2 min-h-[44px] min-w-[44px] items-center justify-center text-text-secondary hover:text-accent hover:bg-bg-subtle rounded-lg transition-colors"
                  title={createPRModalExpanded ? "Collapse" : "Expand"}
                >
                  {createPRModalExpanded ? (
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" />
                    </svg>
                  ) : (
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
                    </svg>
                  )}
                </button>
                {/* Close Button */}
                <button
                  onClick={closeCreatePRModal}
                  className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center text-text-secondary hover:text-accent hover:bg-bg-subtle rounded-lg transition-colors"
                >
                  <svg className="h-6 w-6 md:h-5 md:w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Modal Tabs */}
            <div className="flex border-b border-border px-4 md:px-6 shrink-0">
              <button
                onClick={() => handleCreateModeChange("discover")}
                disabled={loading}
                className={`px-3 md:px-4 py-3 md:py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px min-h-[44px] ${
                  createMode === "discover"
                    ? "border-primary text-primary"
                    : "border-transparent text-text-secondary hover:text-accent"
                } disabled:opacity-50`}
              >
                Discover PRs
              </button>
              <button
                onClick={() => handleCreateModeChange("pr")}
                disabled={loading}
                className={`px-3 md:px-4 py-3 md:py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px min-h-[44px] ${
                  createMode === "pr"
                    ? "border-primary text-primary"
                    : "border-transparent text-text-secondary hover:text-accent"
                } disabled:opacity-50`}
              >
                Simulate PR
              </button>
              {/* Latest Commit tab hidden - functionality preserved for future use
              <button
                onClick={() => handleCreateModeChange("commit")}
                disabled={loading}
                className={`px-3 md:px-4 py-3 md:py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px min-h-[44px] ${
                  createMode === "commit"
                    ? "border-primary text-primary"
                    : "border-transparent text-text-secondary hover:text-accent"
                } disabled:opacity-50`}
              >
                Latest Commit
              </button>
              */}
            </div>

            {/* Modal Content - Fixed height for consistent sizing across tabs */}
            <div className="flex-1 overflow-y-auto p-6 min-h-[500px]">
              {createMode === "discover" ? (
                <DiscoverPRs
                  onSelectPR={(prUrl) => {
                    setPrUrl(prUrl);
                    handleCreateModeChange("pr");
                  }}
                  onSimulationComplete={() => {
                    closeCreatePRModal();
                    refreshFromGitHub();
                  }}
                />
              ) : (
              <form onSubmit={handleSubmit} className="space-y-6">
                {createMode === "pr" ? (
                  <>
                    <div>
                      <label htmlFor="prUrl" className="block text-sm font-medium text-accent mb-2">
                        Pull Request URL
                      </label>
                      <input
                        type="text"
                        id="prUrl"
                        value={prUrl}
                        onChange={(e) => {
                          setPrUrl(e.target.value);
                          if (formValidationError) setFormValidationError(null);
                        }}
                        placeholder="https://github.com/owner/repo/pull/123"
                        className={`w-full px-4 py-3 bg-white border rounded-lg text-black placeholder:text-text-muted focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors ${
                          formValidationError ? "border-red-300" : "border-border"
                        }`}
                        disabled={loading}
                      />
                      <p className="mt-2 text-sm text-text-muted">
                        Paste any GitHub PR URL to simulate it for review
                      </p>
                    </div>

                    <div className="flex items-start">
                      <input
                        type="checkbox"
                        id="cacheRepoModal"
                        checked={cacheRepo}
                        onChange={(e) => setCacheRepo(e.target.checked)}
                        className="h-4 w-4 mt-0.5 rounded border-border text-primary focus:ring-primary focus:ring-offset-0 cursor-pointer"
                        disabled={loading}
                      />
                      <label
                        htmlFor="cacheRepoModal"
                        className="ml-3 cursor-pointer select-none"
                      >
                        <span className="text-sm text-text-secondary">Cache this repository</span>
                        <p className="text-xs text-text-muted mt-0.5">
                          Enable for large repos or repos you&apos;ll simulate multiple PRs from. Speeds up future simulations.
                        </p>
                      </label>
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <label htmlFor="repoUrl" className="block text-sm font-medium text-accent mb-2">
                        GitHub Repository URL
                      </label>
                      <input
                        type="text"
                        id="repoUrl"
                        value={repoUrl}
                        onChange={(e) => {
                          setRepoUrl(e.target.value);
                          if (formValidationError) setFormValidationError(null);
                        }}
                        placeholder="https://github.com/owner/repo-name"
                        className={`w-full px-4 py-3 bg-white border rounded-lg text-black placeholder:text-text-muted focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors ${
                          formValidationError ? "border-red-300" : "border-border"
                        }`}
                        disabled={loading}
                      />
                      <p className="mt-2 text-sm text-text-muted">
                        Enter the original repository URL (we&apos;ll fork it for you)
                      </p>
                    </div>

                    <div className="flex items-center">
                      <input
                        type="checkbox"
                        id="specifyCommitModal"
                        checked={specifyCommit}
                        onChange={(e) => setSpecifyCommit(e.target.checked)}
                        className="h-4 w-4 rounded border-border text-primary focus:ring-primary focus:ring-offset-0 cursor-pointer"
                        disabled={loading}
                      />
                      <label
                        htmlFor="specifyCommitModal"
                        className="ml-3 text-sm text-text-secondary cursor-pointer select-none"
                      >
                        Specify commit (otherwise uses latest from main branch)
                      </label>
                    </div>

                    {specifyCommit && (
                      <div>
                        <label htmlFor="commitHashModal" className="block text-sm font-medium text-accent mb-2">
                          Commit Hash
                        </label>
                        <input
                          type="text"
                          id="commitHashModal"
                          value={commitHash}
                          onChange={(e) => {
                            setCommitHash(e.target.value);
                            if (formValidationError) setFormValidationError(null);
                          }}
                          placeholder="abc1234..."
                          className={`w-full px-4 py-3 bg-white border rounded-lg text-black placeholder:text-text-muted font-mono text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors ${
                            formValidationError ? "border-red-300" : "border-border"
                          }`}
                          disabled={loading}
                        />
                        <p className="mt-2 text-sm text-text-muted">
                          The specific commit you want to create as a PR
                        </p>
                      </div>
                    )}

                    <div className="flex items-start">
                      <input
                        type="checkbox"
                        id="cacheRepoCommitModal"
                        checked={cacheRepo}
                        onChange={(e) => setCacheRepo(e.target.checked)}
                        className="h-4 w-4 mt-0.5 rounded border-border text-primary focus:ring-primary focus:ring-offset-0 cursor-pointer"
                        disabled={loading}
                      />
                      <label
                        htmlFor="cacheRepoCommitModal"
                        className="ml-3 cursor-pointer select-none"
                      >
                        <span className="text-sm text-text-secondary">Cache this repository</span>
                        <p className="text-xs text-text-muted mt-0.5">
                          Enable for large repos or repos you&apos;ll simulate multiple PRs from. Speeds up future simulations.
                        </p>
                      </label>
                    </div>
                  </>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full max-w-xs mx-auto flex items-center justify-center py-2.5 px-4 bg-primary hover:bg-primary-hover text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? (
                    <>
                      <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      Creating PR...
                    </>
                  ) : (
                    "Create Pull Request"
                  )}
                </button>

                {formValidationError && (
                  <div className="mt-2 flex items-center justify-center gap-2 text-sm text-red-600">
                    <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                    {formValidationError}
                  </div>
                )}
              </form>
              )}

              {/* Status Messages */}
              {createMode !== "discover" && status.length > 0 && (
                <div className="mt-6">
                  <h3 className="text-sm font-medium text-accent mb-3">Status</h3>
                  <div ref={statusContainerRef} className="bg-bg-subtle border border-border rounded-lg p-4 max-h-48 overflow-y-auto">
                    <div className="space-y-2">
                      {status.map((msg, idx) => (
                        <div key={idx} className="flex items-start gap-3 text-sm">
                          <span className="text-text-muted font-mono text-xs shrink-0 pt-0.5">
                            {msg.timestamp}
                          </span>
                          {msg.step && msg.totalSteps && (
                            <span className="shrink-0 px-1.5 py-0.5 bg-primary/10 text-primary text-xs font-medium rounded">
                              {msg.step}/{msg.totalSteps}
                            </span>
                          )}
                          <span className={`${getStatusColor(msg.type)} leading-relaxed`}>
                            {msg.text}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Result */}
              {createMode !== "discover" && result && (
                <div className="mt-6">
                  {result.success ? (
                    <div className="rounded-xl border border-success/20 bg-success-light p-5">
                      <div className="flex items-center gap-2 mb-3">
                        <svg className="h-5 w-5 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <h3 className="text-base font-semibold text-accent">PR Created Successfully</h3>
                      </div>
                      <p className="text-sm text-text-secondary mb-3">View your pull request:</p>
                      <a href={result.prUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline font-medium break-all text-sm">
                        {result.prUrl}
                      </a>
                      {result.prUrl && (
                        <div className="mt-4 flex gap-3">
                          <a href={result.prUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary-hover text-white text-sm font-medium rounded-lg transition-colors">
                            <Image src="/GitHub_Invertocat_White.svg" alt="" width={16} height={16} className="h-4 w-4" unoptimized />
                            View in GitHub
                          </a>
                          <button
                            onClick={closeCreatePRModal}
                            className="px-4 py-2 text-sm font-medium text-text-secondary hover:text-accent transition-colors"
                          >
                            Close
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-error/20 bg-error-light p-5">
                      <div className="flex items-center gap-2 mb-2">
                        <svg className="h-5 w-5 text-error" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <h3 className="text-base font-semibold text-accent">Error</h3>
                      </div>
                      <p className="text-sm text-text-secondary">{result.error || result.message}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
