"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import Image from "next/image";
import Link from "next/link";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { UserMenu } from "@/components/UserMenu";
import { MobileMenu } from "@/components/MobileMenu";

// Fork types for autocomplete
interface ForkRecord {
  repoName: string;
  repoOwner: string;
  forkUrl: string;
}

interface Prompt {
  name: string;
  content: string;
  model: string | null;
  purpose: string | null;
  updatedAt: string;
}

interface PromptVersion {
  version_number: number;
  content: string;
  model: string | null;
  purpose: string | null;
  created_at: string;
  created_by: string | null;
}

interface CachedRepoInfo {
  id: number;
  repo_owner: string;
  repo_name: string;
  cached_at: string;
  notes: string | null;
}

interface CacheInfo {
  totalSizeBytes: number;
  totalSizeFormatted: string;
  reposOnDisk: string[];
  repoSizes: Record<string, { bytes: number; formatted: string }>;
  cachedReposList: CachedRepoInfo[];
  reposDir: string;
}

// Schema validation types
interface SchemaValidationResult {
  compatible: boolean;
  extracted_fields?: string[];
  missing_fields?: string[];
  type_mismatches?: Array<{ field: string; expected: string; found: string }>;
  renamed_fields?: Array<{ expected: string; found: string; confidence: string }>;
  warnings?: string[];
  summary?: string;
  error?: string;
}

interface PromptSchemaInfo {
  type: string;
  hasSchema: boolean;
  requiredFields: string[];
  allFieldPaths: string[];
  schemaTree: string;
  fullSchema: string;
  warning?: string;
}

export default function SettingsPage() {
  const queryClient = useQueryClient();

  // Fetch prompts with React Query
  const {
    data: promptsData,
    isLoading: loading,
    error: promptsError,
  } = useQuery({
    queryKey: ["prompts"],
    queryFn: async () => {
      const response = await fetch("/api/prompts");
      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || "Failed to load prompts");
      }
      return data.prompts as Prompt[];
    },
    staleTime: 30 * 60 * 1000, // 30 minutes - prompts rarely change
  });

  const prompts = promptsData || [];
  const error = promptsError ? (promptsError as Error).message : null;

  const [selectedPrompt, setSelectedPrompt] = useState<Prompt | null>(null);
  const [editedContent, setEditedContent] = useState("");
  const [editedModel, setEditedModel] = useState("");
  const [editedPurpose, setEditedPurpose] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<{ success: boolean; message: string } | null>(null);

  // Modal state for card-based prompt editing
  const [showPromptModal, setShowPromptModal] = useState(false);
  const [editingField, setEditingField] = useState<"model" | "content" | null>(null);
  const [fieldSaveResult, setFieldSaveResult] = useState<{ success: boolean; message: string } | null>(null);

  // Version history state
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState<PromptVersion | null>(null);
  const [reverting, setReverting] = useState(false);
  const [showRevertConfirm, setShowRevertConfirm] = useState<number | null>(null);

  // Tab state
  const [activeTab, setActiveTab] = useState<"prompts" | "caching">("prompts");

  // Cache management state
  const [newCacheRepo, setNewCacheRepo] = useState("");
  const [cacheNotes, setCacheNotes] = useState("");
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showCacheAutocomplete, setShowCacheAutocomplete] = useState(false);
  const [showAddCacheModal, setShowAddCacheModal] = useState(false);
  const cacheInputRef = useRef<HTMLDivElement>(null);
  const modalCacheInputRef = useRef<HTMLDivElement>(null);

  // Schema validation state
  const [validationResult, setValidationResult] = useState<SchemaValidationResult | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [showSchemaWarningModal, setShowSchemaWarningModal] = useState(false);
  const [showSchemaInfo, setShowSchemaInfo] = useState(false);
  const [schemaInfo, setSchemaInfo] = useState<PromptSchemaInfo | null>(null);
  const [pendingSaveAction, setPendingSaveAction] = useState<"desktop" | "mobile-model" | "mobile-content" | null>(null);

  // Simulation state
  const [isSimulating, setIsSimulating] = useState(false);
  const [simulationResult, setSimulationResult] = useState<{
    rawOutput: string;
    parsedOutput?: unknown;
    parseError?: string;
    executionTimeMs: number;
    model: string;
    inputTokensEstimate: number;
    testDataUsed: {
      prId: number;
      forkedPrUrl: string;
      originalPrUrl: string | null;
    };
    schemaValidation?: SchemaValidationResult; // Added: schema validation result
  } | null>(null);
  const [simulationError, setSimulationError] = useState<string | null>(null);
  const [showSimulationModal, setShowSimulationModal] = useState(false);
  // Track the exact content that was last tested (to know if user needs to retest after changes)
  const [testedContent, setTestedContent] = useState<string | null>(null);

  // Fetch forks for autocomplete
  const { data: forksData = [] } = useQuery<ForkRecord[]>({
    queryKey: ["forks-for-autocomplete"],
    queryFn: async () => {
      const response = await fetch("/api/forks?source=db");
      const data = await response.json();
      if (!data.success) return [];
      return data.forks || [];
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // Close autocomplete when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (cacheInputRef.current && !cacheInputRef.current.contains(event.target as Node) &&
          (!modalCacheInputRef.current || !modalCacheInputRef.current.contains(event.target as Node))) {
        setShowCacheAutocomplete(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Autocomplete suggestions for cache repo input
  const cacheSuggestions = useMemo(() => {
    if (!newCacheRepo.trim() || newCacheRepo.length < 2) return [];

    const lowerQuery = newCacheRepo.toLowerCase().trim();
    const suggestions: Array<{ repoOwner: string; repoName: string }> = [];
    const seen = new Set<string>();

    for (const fork of forksData) {
      const key = `${fork.repoOwner}/${fork.repoName}`;
      if (!seen.has(key) && key.toLowerCase().includes(lowerQuery)) {
        seen.add(key);
        suggestions.push({
          repoOwner: fork.repoOwner,
          repoName: fork.repoName,
        });
      }
    }

    return suggestions;
  }, [forksData, newCacheRepo]);

  // Fetch schema info when a prompt is selected
  useEffect(() => {
    if (selectedPrompt?.name) {
      fetch(`/api/prompts/schema-info?type=${encodeURIComponent(selectedPrompt.name)}`)
        .then((r) => r.json())
        .then((data) => setSchemaInfo(data))
        .catch(() => setSchemaInfo(null));
    } else {
      setSchemaInfo(null);
    }
  }, [selectedPrompt?.name]);

  // Validate prompt schema against expected output
  const validatePromptSchema = async (promptType: string, promptContent: string): Promise<SchemaValidationResult> => {
    setIsValidating(true);
    setValidationResult(null);

    try {
      const response = await fetch("/api/prompts/validate-schema", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          promptType,
          promptContent,
        }),
      });

      const result = await response.json();
      setValidationResult(result);
      return result;
    } catch (error) {
      const errorResult: SchemaValidationResult = {
        compatible: true,
        warnings: ["Validation unavailable - network error"],
        error: error instanceof Error ? error.message : "Unknown error",
      };
      setValidationResult(errorResult);
      return errorResult;
    } finally {
      setIsValidating(false);
    }
  };


  // Handle save with schema validation
  const handleValidatedSave = async (saveAction: "desktop" | "mobile-model" | "mobile-content") => {
    if (!selectedPrompt) return;

    // Only validate content changes, not model changes
    if (saveAction === "mobile-model") {
      // Model changes don't affect schema, save directly
      handleSaveField("model");
      return;
    }

    // Check if content has changed
    const contentToValidate = saveAction === "desktop" ? editedContent : editedContent;
    if (contentToValidate === selectedPrompt.content) {
      // No content changes, save directly
      if (saveAction === "desktop") {
        handleSave();
      } else {
        handleSaveField("content");
      }
      return;
    }

    // Check if user has already tested this exact content
    if (testedContent === editedContent && validationResult) {
      // User has tested this content, use cached validation result
      if (!validationResult.compatible) {
        setPendingSaveAction(saveAction);
        setShowSchemaWarningModal(true);
        return;
      }
      // Validation passed during testing, save directly
      if (saveAction === "desktop") {
        handleSave();
      } else {
        handleSaveField("content");
      }
      return;
    }

    // User hasn't tested this content - run validation first
    const result = await validatePromptSchema(selectedPrompt.name, contentToValidate);

    if (!result.compatible) {
      // Show warning modal
      setPendingSaveAction(saveAction);
      setShowSchemaWarningModal(true);
      return;
    }

    // Schema is compatible, save directly
    if (saveAction === "desktop") {
      handleSave();
    } else {
      handleSaveField("content");
    }
  };

  // Force save despite schema incompatibility
  const handleForceSave = () => {
    setShowSchemaWarningModal(false);

    if (pendingSaveAction === "desktop") {
      handleSave();
    } else if (pendingSaveAction === "mobile-content") {
      handleSaveField("content");
    }

    setPendingSaveAction(null);
  };

  // Cancel the save and go back to editing
  const handleCancelSave = () => {
    setShowSchemaWarningModal(false);
    setPendingSaveAction(null);
  };

  // Simulate prompt with test data (also runs schema validation)
  const handleSimulate = async () => {
    if (!selectedPrompt) return;

    setIsSimulating(true);
    setSimulationResult(null);
    setSimulationError(null);
    setValidationResult(null);

    try {
      // Run both simulation and schema validation in parallel
      const [simulateResponse, validationResponse] = await Promise.all([
        fetch("/api/prompts/simulate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            promptType: selectedPrompt.name,
            promptContent: editedContent,
            model: editedModel || undefined,
          }),
        }),
        fetch("/api/prompts/validate-schema", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            promptType: selectedPrompt.name,
            promptContent: editedContent,
          }),
        }),
      ]);

      const [simulateData, validationData] = await Promise.all([
        simulateResponse.json(),
        validationResponse.json(),
      ]);

      if (!simulateData.success) {
        setSimulationError(simulateData.error || "Simulation failed");
        return;
      }

      // Store validation result
      setValidationResult(validationData);

      // Include validation in simulation result
      setSimulationResult({
        ...simulateData.result,
        schemaValidation: validationData,
      });

      // Mark this content as tested
      setTestedContent(editedContent);

      setShowSimulationModal(true);
    } catch (error) {
      setSimulationError(error instanceof Error ? error.message : "Unknown error");
    } finally {
      setIsSimulating(false);
    }
  };

  // Fetch cache info
  const {
    data: cacheData,
    isLoading: cacheLoading,
    error: cacheError,
  } = useQuery({
    queryKey: ["cache-info"],
    queryFn: async () => {
      const response = await fetch("/api/cache");
      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || "Failed to load cache info");
      }
      return data.cache as CacheInfo;
    },
    staleTime: 30 * 1000, // 30 seconds
  });

  // Add repo to cache list mutation
  const addCacheRepoMutation = useMutation({
    mutationFn: async ({ repoOwner, repoName, notes }: { repoOwner: string; repoName: string; notes?: string }) => {
      const response = await fetch("/api/cache", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoOwner, repoName, notes }),
      });
      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || "Failed to add repo to cache list");
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cache-info"] });
      setNewCacheRepo("");
      setCacheNotes("");
      setShowAddCacheModal(false);
    },
  });

  // Remove repo from cache list mutation
  const removeCacheRepoMutation = useMutation({
    mutationFn: async ({ repoOwner, repoName, deleteFromDisk }: { repoOwner: string; repoName: string; deleteFromDisk?: boolean }) => {
      const response = await fetch("/api/cache", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoOwner, repoName, deleteFromDisk }),
      });
      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || "Failed to remove repo from cache");
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cache-info"] });
    },
  });

  // Clear all cache mutation
  const clearCacheMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/cache/clear", {
        method: "POST",
      });
      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || "Failed to clear cache");
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cache-info"] });
      setShowClearConfirm(false);
    },
  });

  const handleAddCacheRepo = () => {
    const parts = newCacheRepo.trim().split("/");
    if (parts.length !== 2) {
      alert("Please enter in format: owner/repo");
      return;
    }
    const [repoOwner, repoName] = parts;
    addCacheRepoMutation.mutate({ repoOwner, repoName, notes: cacheNotes || undefined });
  };

  // Fetch versions with React Query (only when version history is shown)
  const {
    data: versions = [],
    isLoading: loadingVersions,
  } = useQuery({
    queryKey: ["prompt-versions", selectedPrompt?.name],
    queryFn: async () => {
      if (!selectedPrompt?.name) return [];
      const response = await fetch(`/api/prompts/versions?name=${encodeURIComponent(selectedPrompt.name)}`);
      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || "Failed to load versions");
      }
      return data.versions as PromptVersion[];
    },
    enabled: showVersionHistory && !!selectedPrompt?.name,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // Desktop: select prompt for inline editing
  const selectPrompt = (prompt: Prompt) => {
    setSelectedPrompt(prompt);
    setEditedContent(prompt.content);
    setEditedModel(prompt.model || "");
    setEditedPurpose(prompt.purpose || "");
    setSaveResult(null);
    setSelectedVersion(null);
    setShowVersionHistory(false);
  };

  // Mobile: open prompt in modal
  const openPromptModal = (prompt: Prompt) => {
    setSelectedPrompt(prompt);
    setEditedContent(prompt.content);
    setEditedModel(prompt.model || "");
    setEditedPurpose(prompt.purpose || "");
    setSaveResult(null);
    setFieldSaveResult(null);
    setSelectedVersion(null);
    setShowVersionHistory(false);
    setEditingField(null);
    setShowPromptModal(true);
  };

  const closePromptModal = () => {
    setShowPromptModal(false);
    setEditingField(null);
    setFieldSaveResult(null);
  };

  // Desktop: save all fields at once
  const handleSave = async () => {
    if (!selectedPrompt) return;

    const currentName = selectedPrompt.name;

    try {
      setSaving(true);
      setSaveResult(null);

      const response = await fetch("/api/prompts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: currentName,
          content: editedContent,
          model: editedModel || null,
          purpose: editedPurpose || null,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setSaveResult({ success: true, message: "Prompt saved successfully" });

        // Invalidate queries to refresh data
        await queryClient.invalidateQueries({ queryKey: ["prompts"] });
        await queryClient.invalidateQueries({ queryKey: ["prompt-versions", currentName] });

        // Update selected prompt with new content
        setSelectedPrompt({
          ...selectedPrompt,
          content: editedContent,
          model: editedModel || null,
          purpose: editedPurpose || null,
        });

        // Auto-hide success message after 3 seconds
        setTimeout(() => setSaveResult(null), 3000);
      } else {
        setSaveResult({ success: false, message: data.error || "Failed to save prompt" });
      }
    } catch (err) {
      setSaveResult({
        success: false,
        message: err instanceof Error ? err.message : "Failed to save prompt",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveField = async (field: "model" | "content") => {
    if (!selectedPrompt) return;

    const currentName = selectedPrompt.name;

    try {
      setSaving(true);
      setFieldSaveResult(null);

      const response = await fetch("/api/prompts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: currentName,
          content: field === "content" ? editedContent : selectedPrompt.content,
          model: field === "model" ? (editedModel || null) : selectedPrompt.model,
          purpose: selectedPrompt.purpose,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setFieldSaveResult({ success: true, message: `${field === "model" ? "Model" : "Content"} saved successfully` });

        // Invalidate queries to refresh data
        await queryClient.invalidateQueries({ queryKey: ["prompts"] });
        await queryClient.invalidateQueries({ queryKey: ["prompt-versions", currentName] });

        // Update selected prompt with new content
        setSelectedPrompt({
          ...selectedPrompt,
          content: field === "content" ? editedContent : selectedPrompt.content,
          model: field === "model" ? (editedModel || null) : selectedPrompt.model,
        });

        // Close the edit mode
        setEditingField(null);

        // Auto-hide success message after 3 seconds
        setTimeout(() => setFieldSaveResult(null), 3000);
      } else {
        setFieldSaveResult({ success: false, message: data.error || "Failed to save" });
      }
    } catch (err) {
      setFieldSaveResult({
        success: false,
        message: err instanceof Error ? err.message : "Failed to save",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleRevert = async (versionNumber: number) => {
    if (!selectedPrompt) return;

    const promptName = selectedPrompt.name;

    try {
      setReverting(true);
      const response = await fetch("/api/prompts/versions/revert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: promptName, versionNumber }),
      });

      const data = await response.json();

      if (data.success) {
        // Invalidate queries to refresh data
        await queryClient.invalidateQueries({ queryKey: ["prompts"] });
        await queryClient.invalidateQueries({ queryKey: ["prompt-versions", promptName] });

        // Get the reverted version's content to update the editor
        const revertedVersion = versions.find(v => v.version_number === versionNumber);
        if (revertedVersion) {
          setEditedContent(revertedVersion.content);
          setEditedModel(revertedVersion.model || "");
          setEditedPurpose(revertedVersion.purpose || "");
          setSelectedPrompt({
            ...selectedPrompt,
            content: revertedVersion.content,
            model: revertedVersion.model,
            purpose: revertedVersion.purpose,
          });
        }

        // Clear selected version preview
        setSelectedVersion(null);

        setSaveResult({ success: true, message: `Reverted to version ${versionNumber}` });
        setTimeout(() => setSaveResult(null), 3000);
      } else {
        setSaveResult({ success: false, message: data.error || "Failed to revert" });
      }
    } catch (err) {
      setSaveResult({
        success: false,
        message: err instanceof Error ? err.message : "Failed to revert",
      });
    } finally {
      setReverting(false);
      setShowRevertConfirm(null);
    }
  };

  const toggleVersionHistory = () => {
    setShowVersionHistory(!showVersionHistory);
    setSelectedVersion(null);
  };

  const hasModelChanges = selectedPrompt && (editedModel || null) !== selectedPrompt.model;
  const hasContentChanges = selectedPrompt && editedContent !== selectedPrompt.content;
  const hasChanges = selectedPrompt && (
    editedContent !== selectedPrompt.content ||
    (editedModel || null) !== selectedPrompt.model ||
    (editedPurpose || null) !== selectedPrompt.purpose
  );

  // Auto-select first prompt on desktop when prompts load
  useEffect(() => {
    if (prompts.length > 0 && !selectedPrompt && !showPromptModal) {
      selectPrompt(prompts[0]);
    }
  }, [prompts, selectedPrompt, showPromptModal]);

  const truncateText = (text: string, maxLength: number) => {
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength).trim() + "...";
  };

  const formatPromptName = (name: string) => {
    return name
      .split("-")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
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

  const formatRelativeTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "just now";
    if (diffMins < 60) return `${diffMins} minute${diffMins === 1 ? "" : "s"} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
    return formatDate(dateString);
  };

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
            <Link
              href="/"
              className="w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-lg text-text-secondary hover:bg-bg-subtle hover:text-accent transition-colors"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              PR Reviews
            </Link>
            <div className="w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-lg bg-primary/10 text-primary">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Settings
            </div>
          </div>
        </nav>
        <UserMenu />
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 bg-bg-subtle min-h-screen md:h-screen overflow-y-auto pt-14 md:pt-0">
        {/* Header Section - sticky on desktop only */}
        <div className="md:sticky md:top-0 z-10 bg-bg-subtle px-4 md:px-8 pt-4 md:pt-8 pb-0 border-b border-border md:shadow-sm">
          <h1 className="text-xl md:text-2xl font-semibold text-accent tracking-tight">Settings</h1>
          <p className="mt-1 md:mt-2 text-sm md:text-base text-text-secondary">Configure prompts and application settings</p>

          {/* Tabs */}
          <div className="flex gap-4 md:gap-6 mt-4 md:mt-6">
            <button
              onClick={() => setActiveTab("prompts")}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors min-h-[44px] ${
                activeTab === "prompts"
                  ? "border-primary text-primary"
                  : "border-transparent text-text-secondary hover:text-accent hover:border-border"
              }`}
            >
              Prompts
            </button>
            <button
              onClick={() => setActiveTab("caching")}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors min-h-[44px] ${
                activeTab === "caching"
                  ? "border-primary text-primary"
                  : "border-transparent text-text-secondary hover:text-accent hover:border-border"
              }`}
            >
              Caching
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="px-4 md:px-8 py-4 md:py-6">
          {/* Prompts Section */}
          {activeTab === "prompts" && (
          <>
            {/* Mobile: Card-based layout */}
            <div className="md:hidden">
              <div className="mb-4">
                <p className="text-sm text-text-secondary">
                  View and edit the prompts used for PR analysis and email generation
                </p>
              </div>

              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <svg className="animate-spin h-8 w-8 text-primary" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                </div>
              ) : error ? (
                <div className="rounded-lg bg-error-light border border-error/20 p-4 text-sm text-error">
                  {error}
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4">
                  {prompts.map((prompt) => (
                    <button
                      key={prompt.name}
                      onClick={() => openPromptModal(prompt)}
                      className="bg-white border border-border rounded-xl p-4 text-left hover:border-primary hover:shadow-md transition-all group"
                    >
                      <div className="flex items-start justify-between mb-3">
                        <h3 className="text-base font-semibold text-accent group-hover:text-primary transition-colors">
                          {formatPromptName(prompt.name)}
                        </h3>
                        <svg className="h-5 w-5 text-text-muted group-hover:text-primary transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                        </svg>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 mb-3">
                        {prompt.model && (
                          <span className="inline-flex items-center px-2 py-1 rounded-md bg-primary/10 text-primary text-xs font-medium">
                            {prompt.model}
                          </span>
                        )}
                        <span className="text-xs text-text-muted">
                          Updated {formatRelativeTime(prompt.updatedAt)}
                        </span>
                      </div>

                      <p className="text-sm text-text-secondary line-clamp-3">
                        {truncateText(prompt.content, 150)}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Desktop: Original sidebar + editor layout */}
            <div className="hidden md:block">
              <div className="bg-white border border-border rounded-xl shadow-sm overflow-hidden">
                <div className="px-6 py-4 border-b border-border">
                  <h2 className="text-lg font-semibold text-accent">Prompts</h2>
                  <p className="text-sm text-text-secondary mt-1">
                    View and edit the prompts used for PR analysis and email generation
                  </p>
                </div>

                {loading ? (
                  <div className="flex items-center justify-center py-12">
                    <svg className="animate-spin h-8 w-8 text-primary" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                  </div>
                ) : error ? (
                  <div className="p-6">
                    <div className="rounded-lg bg-error-light border border-error/20 p-4 text-sm text-error">
                      {error}
                    </div>
                  </div>
                ) : (
                  <div className="flex">
                    {/* Prompt List */}
                    <div className="w-64 border-r border-border">
                      <div className="p-2">
                        {prompts.map((prompt) => (
                          <button
                            key={prompt.name}
                            onClick={() => selectPrompt(prompt)}
                            className={`w-full text-left px-4 py-3 rounded-lg transition-colors ${
                              selectedPrompt?.name === prompt.name
                                ? "bg-primary/10 text-primary"
                                : "text-text-secondary hover:bg-bg-subtle hover:text-accent"
                            }`}
                          >
                            <div className="font-medium text-sm">{formatPromptName(prompt.name)}</div>
                            {prompt.purpose && (
                              <div className="text-xs text-text-muted mt-1 line-clamp-2">
                                {prompt.purpose}
                              </div>
                            )}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Prompt Editor */}
                    <div className="flex-1 p-6">
                      {selectedPrompt ? (
                        <div className="space-y-6">
                          {/* Header */}
                          <div className="flex items-start justify-between">
                            <div>
                              <h3 className="text-lg font-semibold text-accent">
                                {formatPromptName(selectedPrompt.name)}
                              </h3>
                              <p className="text-sm text-text-muted mt-1">
                                Last updated: {formatDate(selectedPrompt.updatedAt)}
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              {/* Test Prompt Button */}
                              <button
                                onClick={handleSimulate}
                                disabled={isSimulating}
                                className="inline-flex items-center gap-2 px-4 py-2 border border-blue-300 hover:bg-blue-50 text-blue-700 font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                {isSimulating ? (
                                  <>
                                    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                    </svg>
                                    Testing...
                                  </>
                                ) : (
                                  <>
                                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                    Test Prompt
                                  </>
                                )}
                              </button>

                              {/* Save Button */}
                              <button
                                onClick={() => handleValidatedSave("desktop")}
                                disabled={saving || isSimulating || isValidating || !hasChanges}
                                className="inline-flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary-hover text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                {saving ? (
                                  <>
                                    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                    </svg>
                                    Saving...
                                  </>
                                ) : (
                                  <>
                                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                    </svg>
                                    Save Changes
                                  </>
                                )}
                              </button>
                            </div>
                          </div>

                          {/* Save Result */}
                          {saveResult && (
                            <div
                              className={`rounded-lg border p-3 text-sm ${
                                saveResult.success
                                  ? "bg-success-light border-success/20 text-success"
                                  : "bg-error-light border-error/20 text-error"
                              }`}
                            >
                              {saveResult.message}
                            </div>
                          )}

                          {/* Simulation Error */}
                          {simulationError && (
                            <div className="rounded-lg border border-error/20 bg-error-light p-3 text-sm text-error">
                              <div className="flex items-center gap-2">
                                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                <span className="font-medium">Simulation Error</span>
                              </div>
                              <p className="mt-1">{simulationError}</p>
                            </div>
                          )}

                          {/* Metadata Fields */}
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <label className="block text-sm font-medium text-accent mb-2">
                                Model
                              </label>
                              <input
                                type="text"
                                value={editedModel}
                                onChange={(e) => setEditedModel(e.target.value)}
                                placeholder="e.g., claude-sonnet-4-20250514"
                                className="w-full px-3 py-2 bg-white border border-border rounded-lg text-sm text-black placeholder:text-text-muted focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors"
                              />
                            </div>
                            <div>
                              <label className="block text-sm font-medium text-accent mb-2">
                                Purpose
                              </label>
                              <input
                                type="text"
                                value={editedPurpose}
                                onChange={(e) => setEditedPurpose(e.target.value)}
                                placeholder="Brief description of what this prompt does"
                                className="w-full px-3 py-2 bg-white border border-border rounded-lg text-sm text-black placeholder:text-text-muted focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors"
                              />
                            </div>
                          </div>

                          {/* Content Editor */}
                          <div>
                            <label className="block text-sm font-medium text-accent mb-2">
                              Prompt Content
                            </label>
                            <textarea
                              value={editedContent}
                              onChange={(e) => setEditedContent(e.target.value)}
                              rows={20}
                              className="w-full px-4 py-3 bg-white border border-border rounded-lg text-sm text-black font-mono placeholder:text-text-muted focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors resize-y"
                              placeholder="Enter prompt content..."
                            />
                            <p className="text-xs text-text-muted mt-2">
                              Use {"{VARIABLE_NAME}"} syntax for variables that will be interpolated at runtime.
                            </p>
                          </div>

                          {/* Expected Schema Info Section */}
                          {schemaInfo && schemaInfo.hasSchema && (
                            <div className="border-t border-border pt-6">
                              <button
                                onClick={() => setShowSchemaInfo(!showSchemaInfo)}
                                className="flex items-center gap-2 text-sm font-medium text-text-secondary hover:text-accent transition-colors"
                              >
                                <svg
                                  className={`h-4 w-4 transition-transform ${showSchemaInfo ? "rotate-90" : ""}`}
                                  fill="none"
                                  viewBox="0 0 24 24"
                                  stroke="currentColor"
                                  strokeWidth={2}
                                >
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                                </svg>
                                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                </svg>
                                Required Output Schema
                                <span className="text-xs text-yellow-600 bg-yellow-50 px-2 py-0.5 rounded">
                                  {schemaInfo.requiredFields.length} required fields
                                </span>
                              </button>

                              {showSchemaInfo && (
                                <div className="mt-4 space-y-4">
                                  <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                                    <p className="text-sm text-yellow-700 mb-2">
                                      <strong>Warning:</strong> The application code expects this prompt to return JSON matching
                                      the schema below. Removing or renaming these fields will break the application.
                                    </p>
                                  </div>

                                  {/* Required Fields List */}
                                  <div>
                                    <h4 className="text-sm font-medium text-accent mb-2">Top-Level Required Fields:</h4>
                                    <div className="flex flex-wrap gap-2">
                                      {schemaInfo.requiredFields.map((field) => (
                                        <span
                                          key={field}
                                          className="px-2 py-1 bg-gray-100 text-gray-700 rounded font-mono text-xs"
                                        >
                                          {field}
                                        </span>
                                      ))}
                                    </div>
                                  </div>

                                  {/* Schema Tree */}
                                  <div>
                                    <h4 className="text-sm font-medium text-accent mb-2">Full Schema Structure:</h4>
                                    <pre className="p-3 bg-gray-50 rounded-lg text-xs font-mono overflow-x-auto border border-gray-200 whitespace-pre-wrap">
                                      {schemaInfo.schemaTree}
                                    </pre>
                                  </div>

                                  {/* All Field Paths */}
                                  <div>
                                    <h4 className="text-sm font-medium text-accent mb-2">All Field Paths:</h4>
                                    <div className="p-3 bg-gray-50 rounded-lg text-xs font-mono overflow-x-auto border border-gray-200">
                                      {schemaInfo.allFieldPaths.join(", ")}
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}

                          {/* Schema Info Warning for prompts without schema */}
                          {schemaInfo && !schemaInfo.hasSchema && (
                            <div className="border-t border-border pt-6">
                              <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg">
                                <p className="text-sm text-gray-600">
                                  <strong>Note:</strong> No output schema is defined for this prompt type.
                                  The application will not validate the output format.
                                </p>
                              </div>
                            </div>
                          )}

                          {/* Version History Section */}
                          <div className="border-t border-border pt-6">
                            <button
                              onClick={toggleVersionHistory}
                              className="flex items-center gap-2 text-sm font-medium text-text-secondary hover:text-accent transition-colors"
                            >
                              <svg
                                className={`h-4 w-4 transition-transform ${showVersionHistory ? "rotate-90" : ""}`}
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                                strokeWidth={2}
                              >
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                              </svg>
                              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              Version History
                              {versions.length > 0 && (
                                <span className="text-xs text-text-muted">({versions.length} versions)</span>
                              )}
                            </button>

                            {showVersionHistory && (
                              <div className="mt-4 space-y-4">
                                {loadingVersions ? (
                                  <div className="flex items-center justify-center py-8">
                                    <svg className="animate-spin h-6 w-6 text-primary" fill="none" viewBox="0 0 24 24">
                                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                    </svg>
                                  </div>
                                ) : versions.length === 0 ? (
                                  <p className="text-sm text-text-muted py-4">No version history yet. Save changes to create the first version.</p>
                                ) : (
                                  <>
                                    {/* Version List */}
                                    <div className="border border-border rounded-lg divide-y divide-border max-h-64 overflow-y-auto">
                                      {versions.map((version) => (
                                        <div
                                          key={version.version_number}
                                          className={`flex items-center justify-between px-4 py-3 ${
                                            selectedVersion?.version_number === version.version_number
                                              ? "bg-primary/5"
                                              : "hover:bg-bg-subtle"
                                          }`}
                                        >
                                          <div className="flex items-center gap-3">
                                            <span className="text-sm font-medium text-accent">
                                              Version {version.version_number}
                                            </span>
                                            <span className="text-xs text-text-muted">
                                              {formatRelativeTime(version.created_at)}
                                              {version.created_by && ` by @${version.created_by}`}
                                            </span>
                                          </div>
                                          <div className="flex items-center gap-2">
                                            <button
                                              onClick={() => setSelectedVersion(
                                                selectedVersion?.version_number === version.version_number
                                                  ? null
                                                  : version
                                              )}
                                              className="text-xs text-primary hover:text-primary-hover font-medium"
                                            >
                                              {selectedVersion?.version_number === version.version_number ? "Hide" : "View"}
                                            </button>
                                            {showRevertConfirm === version.version_number ? (
                                              <div className="flex items-center gap-1">
                                                <button
                                                  onClick={() => handleRevert(version.version_number)}
                                                  disabled={reverting}
                                                  className="text-xs text-error hover:text-error/80 font-medium"
                                                >
                                                  {reverting ? "Reverting..." : "Confirm"}
                                                </button>
                                                <button
                                                  onClick={() => setShowRevertConfirm(null)}
                                                  className="text-xs text-text-muted hover:text-text-secondary font-medium"
                                                >
                                                  Cancel
                                                </button>
                                              </div>
                                            ) : (
                                              <button
                                                onClick={() => setShowRevertConfirm(version.version_number)}
                                                className="text-xs text-text-secondary hover:text-accent font-medium"
                                              >
                                                Revert
                                              </button>
                                            )}
                                          </div>
                                        </div>
                                      ))}
                                    </div>

                                    {/* Version Preview */}
                                    {selectedVersion && (
                                      <div className="border border-border rounded-lg p-4 bg-bg-subtle">
                                        <div className="flex items-center justify-between mb-3">
                                          <h4 className="text-sm font-medium text-accent">
                                            Version {selectedVersion.version_number} Preview
                                          </h4>
                                          <span className="text-xs text-text-muted">
                                            {formatDate(selectedVersion.created_at)}
                                          </span>
                                        </div>
                                        {selectedVersion.model && (
                                          <p className="text-xs text-text-muted mb-1">
                                            <span className="font-medium">Model:</span> {selectedVersion.model}
                                          </p>
                                        )}
                                        {selectedVersion.purpose && (
                                          <p className="text-xs text-text-muted mb-1">
                                            <span className="font-medium">Purpose:</span> {selectedVersion.purpose}
                                          </p>
                                        )}
                                        {selectedVersion.created_by && (
                                          <p className="text-xs text-text-muted mb-3">
                                            <span className="font-medium">Created by:</span> @{selectedVersion.created_by}
                                          </p>
                                        )}
                                        <textarea
                                          value={selectedVersion.content}
                                          readOnly
                                          rows={20}
                                          className="w-full px-4 py-3 bg-white border border-border rounded-lg text-sm text-black font-mono resize-none"
                                        />
                                      </div>
                                    )}
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center justify-center h-64 text-text-muted">
                          Select a prompt to view and edit
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Prompt Detail Modal - Mobile only */}
            {showPromptModal && selectedPrompt && (
              <>
                {/* Backdrop */}
                <div
                  className="fixed inset-0 bg-black/50 z-50 md:hidden"
                  onClick={closePromptModal}
                />

                {/* Modal */}
                <div className="fixed inset-2 bg-white rounded-xl z-50 flex flex-col overflow-hidden shadow-2xl md:hidden">
                  {/* Modal Header */}
                  <div className="flex items-center justify-between px-4 md:px-6 py-4 border-b border-border bg-bg-subtle">
                    <div>
                      <h2 className="text-lg font-semibold text-accent">
                        {formatPromptName(selectedPrompt.name)}
                      </h2>
                      <p className="text-sm text-text-muted">
                        Last updated: {formatDate(selectedPrompt.updatedAt)}
                      </p>
                    </div>
                    <button
                      onClick={closePromptModal}
                      className="p-2 -mr-2 text-text-muted hover:text-accent transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
                    >
                      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>

                  {/* Modal Content */}
                  <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
                    {/* Save Result */}
                    {fieldSaveResult && (
                      <div
                        className={`rounded-lg border p-3 text-sm ${
                          fieldSaveResult.success
                            ? "bg-success-light border-success/20 text-success"
                            : "bg-error-light border-error/20 text-error"
                        }`}
                      >
                        {fieldSaveResult.message}
                      </div>
                    )}

                    {/* Model Section */}
                    <div className="bg-bg-subtle rounded-lg p-4">
                      <div className="flex items-center justify-between mb-3">
                        <label className="text-sm font-medium text-accent">Model</label>
                        {editingField === "model" ? (
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleValidatedSave("mobile-model")}
                              disabled={saving || !hasModelChanges}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary hover:bg-primary-hover text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {saving ? (
                                <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                </svg>
                              ) : (
                                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                </svg>
                              )}
                              Save
                            </button>
                            <button
                              onClick={() => {
                                setEditingField(null);
                                setEditedModel(selectedPrompt.model || "");
                              }}
                              className="px-3 py-1.5 text-text-secondary hover:text-accent text-sm font-medium rounded-lg transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setEditingField("model")}
                            className="text-sm text-primary hover:text-primary-hover font-medium"
                          >
                            Edit
                          </button>
                        )}
                      </div>
                      {editingField === "model" ? (
                        <input
                          type="text"
                          value={editedModel}
                          onChange={(e) => setEditedModel(e.target.value)}
                          placeholder="e.g., claude-sonnet-4-20250514"
                          className="w-full px-3 py-2 bg-white border border-border rounded-lg text-sm text-black placeholder:text-text-muted focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors"
                          autoFocus
                        />
                      ) : (
                        <div className="px-3 py-2 bg-white border border-border rounded-lg text-sm text-black">
                          {selectedPrompt.model || <span className="text-text-muted">No model specified</span>}
                        </div>
                      )}
                    </div>

                    {/* Purpose Section (read-only display) */}
                    {selectedPrompt.purpose && (
                      <div className="bg-bg-subtle rounded-lg p-4">
                        <label className="text-sm font-medium text-accent block mb-3">Purpose</label>
                        <p className="text-sm text-text-secondary">{selectedPrompt.purpose}</p>
                      </div>
                    )}

                    {/* Content Section */}
                    <div className="bg-bg-subtle rounded-lg p-4">
                      <div className="flex items-center justify-between mb-3">
                        <label className="text-sm font-medium text-accent">Prompt Content</label>
                        {editingField === "content" ? (
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleValidatedSave("mobile-content")}
                              disabled={saving || isValidating || !hasContentChanges}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary hover:bg-primary-hover text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {saving || isValidating ? (
                                <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                </svg>
                              ) : (
                                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                </svg>
                              )}
                              {isValidating ? "Validating..." : "Save"}
                            </button>
                            <button
                              onClick={() => {
                                setEditingField(null);
                                setEditedContent(selectedPrompt.content);
                              }}
                              className="px-3 py-1.5 text-text-secondary hover:text-accent text-sm font-medium rounded-lg transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setEditingField("content")}
                            className="text-sm text-primary hover:text-primary-hover font-medium"
                          >
                            Edit
                          </button>
                        )}
                      </div>
                      {editingField === "content" ? (
                        <>
                          <textarea
                            value={editedContent}
                            onChange={(e) => setEditedContent(e.target.value)}
                            rows={15}
                            className="w-full px-4 py-3 bg-white border border-border rounded-lg text-sm text-black font-mono placeholder:text-text-muted focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors resize-y"
                            placeholder="Enter prompt content..."
                            autoFocus
                          />
                          <p className="text-xs text-text-muted mt-2">
                            Use {"{VARIABLE_NAME}"} syntax for variables that will be interpolated at runtime.
                          </p>
                        </>
                      ) : (
                        <div className="px-4 py-3 bg-white border border-border rounded-lg text-sm text-black font-mono whitespace-pre-wrap max-h-[400px] overflow-y-auto">
                          {selectedPrompt.content}
                        </div>
                      )}
                    </div>

                    {/* Version History Section */}
                    <div className="border-t border-border pt-6">
                      <button
                        onClick={toggleVersionHistory}
                        className="flex items-center gap-2 text-sm font-medium text-text-secondary hover:text-accent transition-colors"
                      >
                        <svg
                          className={`h-4 w-4 transition-transform ${showVersionHistory ? "rotate-90" : ""}`}
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2}
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                        </svg>
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        Version History
                        {versions.length > 0 && (
                          <span className="text-xs text-text-muted">({versions.length} versions)</span>
                        )}
                      </button>

                      {showVersionHistory && (
                        <div className="mt-4 space-y-4">
                          {loadingVersions ? (
                            <div className="flex items-center justify-center py-8">
                              <svg className="animate-spin h-6 w-6 text-primary" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                              </svg>
                            </div>
                          ) : versions.length === 0 ? (
                            <p className="text-sm text-text-muted py-4">No version history yet. Save changes to create the first version.</p>
                          ) : (
                            <>
                              {/* Version List */}
                              <div className="border border-border rounded-lg divide-y divide-border max-h-64 overflow-y-auto">
                                {versions.map((version) => (
                                  <div
                                    key={version.version_number}
                                    className={`flex flex-col md:flex-row md:items-center justify-between px-4 py-3 gap-2 ${
                                      selectedVersion?.version_number === version.version_number
                                        ? "bg-primary/5"
                                        : "hover:bg-bg-subtle"
                                    }`}
                                  >
                                    <div className="flex items-center gap-3">
                                      <span className="text-sm font-medium text-accent">
                                        Version {version.version_number}
                                      </span>
                                      <span className="text-xs text-text-muted">
                                        {formatRelativeTime(version.created_at)}
                                        {version.created_by && ` by @${version.created_by}`}
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <button
                                        onClick={() => setSelectedVersion(
                                          selectedVersion?.version_number === version.version_number
                                            ? null
                                            : version
                                        )}
                                        className="text-xs text-primary hover:text-primary-hover font-medium"
                                      >
                                        {selectedVersion?.version_number === version.version_number ? "Hide" : "View"}
                                      </button>
                                      {showRevertConfirm === version.version_number ? (
                                        <div className="flex items-center gap-1">
                                          <button
                                            onClick={() => handleRevert(version.version_number)}
                                            disabled={reverting}
                                            className="text-xs text-error hover:text-error/80 font-medium"
                                          >
                                            {reverting ? "Reverting..." : "Confirm"}
                                          </button>
                                          <button
                                            onClick={() => setShowRevertConfirm(null)}
                                            className="text-xs text-text-muted hover:text-text-secondary font-medium"
                                          >
                                            Cancel
                                          </button>
                                        </div>
                                      ) : (
                                        <button
                                          onClick={() => setShowRevertConfirm(version.version_number)}
                                          className="text-xs text-text-secondary hover:text-accent font-medium"
                                        >
                                          Revert
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>

                              {/* Version Preview */}
                              {selectedVersion && (
                                <div className="border border-border rounded-lg p-4 bg-white">
                                  <div className="flex items-center justify-between mb-3">
                                    <h4 className="text-sm font-medium text-accent">
                                      Version {selectedVersion.version_number} Preview
                                    </h4>
                                    <span className="text-xs text-text-muted">
                                      {formatDate(selectedVersion.created_at)}
                                    </span>
                                  </div>
                                  {selectedVersion.model && (
                                    <p className="text-xs text-text-muted mb-1">
                                      <span className="font-medium">Model:</span> {selectedVersion.model}
                                    </p>
                                  )}
                                  {selectedVersion.purpose && (
                                    <p className="text-xs text-text-muted mb-1">
                                      <span className="font-medium">Purpose:</span> {selectedVersion.purpose}
                                    </p>
                                  )}
                                  {selectedVersion.created_by && (
                                    <p className="text-xs text-text-muted mb-3">
                                      <span className="font-medium">Created by:</span> @{selectedVersion.created_by}
                                    </p>
                                  )}
                                  <div className="px-4 py-3 bg-bg-subtle border border-border rounded-lg text-sm text-black font-mono whitespace-pre-wrap max-h-[300px] overflow-y-auto">
                                    {selectedVersion.content}
                                  </div>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </>
            )}
          </>
          )}

          {/* Cache Management Section */}
          {activeTab === "caching" && (
          <div className="bg-white border border-border rounded-xl shadow-sm">
            <div className="px-4 md:px-6 py-4 border-b border-border">
              <h2 className="text-lg font-semibold text-accent">Repository Cache</h2>
              <p className="text-sm text-text-secondary mt-1">
                Manage cached repositories to speed up PR simulation.
              </p>
            </div>

            {cacheLoading ? (
              <div className="flex items-center justify-center py-12">
                <svg className="animate-spin h-8 w-8 text-primary" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              </div>
            ) : cacheError ? (
              <div className="p-4 md:p-6">
                <div className="rounded-lg bg-error-light border border-error/20 p-4 text-sm text-error">
                  {(cacheError as Error).message}
                </div>
              </div>
            ) : cacheData ? (
              <div className="p-4 md:p-6 space-y-6">
                {/* Cache Stats */}
                <div className="flex flex-wrap items-center gap-4 md:gap-6 pb-4 border-b border-border">
                  <div className="flex items-center gap-2">
                    <svg className="h-5 w-5 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
                    </svg>
                    <span className="text-sm text-text-secondary">Total Size:</span>
                    <span className="text-sm font-semibold text-accent">{cacheData.totalSizeFormatted}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <svg className="h-5 w-5 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                    </svg>
                    <span className="text-sm text-text-secondary">Repos on Disk:</span>
                    <span className="text-sm font-semibold text-accent">{cacheData.reposOnDisk.length}</span>
                  </div>
                  {cacheData.reposOnDisk.length > 0 && (
                    <div className="w-full md:w-auto md:ml-auto">
                      {showClearConfirm ? (
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-text-muted hidden md:inline">Clear all?</span>
                          <button
                            onClick={() => clearCacheMutation.mutate()}
                            disabled={clearCacheMutation.isPending}
                            className="px-3 py-1.5 min-h-[44px] md:min-h-0 bg-error hover:bg-error/90 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
                          >
                            {clearCacheMutation.isPending ? "Clearing..." : "Confirm"}
                          </button>
                          <button
                            onClick={() => setShowClearConfirm(false)}
                            className="px-3 py-1.5 min-h-[44px] md:min-h-0 bg-bg-subtle hover:bg-border text-text-secondary text-sm font-medium rounded-lg transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setShowClearConfirm(true)}
                          className="px-3 py-1.5 min-h-[44px] md:min-h-0 bg-error/10 hover:bg-error/20 text-error text-sm font-medium rounded-lg transition-colors"
                        >
                          Clear All Cache
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Mobile Add Button */}
                <button
                  onClick={() => setShowAddCacheModal(true)}
                  className="md:hidden w-full inline-flex items-center justify-center gap-2 px-4 py-3 min-h-[44px] bg-primary hover:bg-primary-hover text-white text-sm font-medium rounded-lg transition-colors"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                  Add Repository
                </button>

                {/* Add Repo to Cache List - Desktop only */}
                <div className="hidden md:block">
                  <label className="block text-sm font-medium text-accent mb-2">
                    Add Repository to Cache List
                  </label>
                  <div className="flex gap-3">
                    <div className="flex-1 relative" ref={cacheInputRef}>
                      <input
                        type="text"
                        value={newCacheRepo}
                        onChange={(e) => {
                          setNewCacheRepo(e.target.value);
                          setShowCacheAutocomplete(true);
                        }}
                        onFocus={() => setShowCacheAutocomplete(true)}
                        placeholder="owner/repo (e.g., supabase/supabase)"
                        className="w-full px-3 py-2 bg-white border border-border rounded-lg text-sm text-black placeholder:text-text-muted focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors"
                      />

                      {/* Autocomplete Dropdown */}
                      {showCacheAutocomplete && cacheSuggestions.length > 0 && (
                        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-border rounded-lg shadow-lg z-30 max-h-[200px] overflow-y-auto">
                          {cacheSuggestions.slice(0, 20).map((suggestion, index) => (
                            <button
                              key={`${suggestion.repoOwner}/${suggestion.repoName}-${index}`}
                              onClick={() => {
                                setNewCacheRepo(`${suggestion.repoOwner}/${suggestion.repoName}`);
                                setShowCacheAutocomplete(false);
                              }}
                              className="w-full px-3 py-2 text-left hover:bg-bg-subtle transition-colors flex items-center gap-2 border-b border-border last:border-b-0"
                            >
                              <svg className="h-4 w-4 text-text-muted flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                              </svg>
                              <span className="text-sm text-accent truncate">{suggestion.repoOwner}/{suggestion.repoName}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <input
                      type="text"
                      value={cacheNotes}
                      onChange={(e) => setCacheNotes(e.target.value)}
                      placeholder="Notes (optional)"
                      className="w-48 px-3 py-2 bg-white border border-border rounded-lg text-sm text-black placeholder:text-text-muted focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors"
                    />
                    <button
                      onClick={handleAddCacheRepo}
                      disabled={!newCacheRepo.trim() || addCacheRepoMutation.isPending}
                      className="px-4 py-2 bg-primary hover:bg-primary-hover text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {addCacheRepoMutation.isPending ? "Adding..." : "Add"}
                    </button>
                  </div>
                  <p className="text-xs text-text-muted mt-2">
                    Repos in this list will be cached on disk for faster PR simulation. Strategic target accounts should be added here.
                  </p>
                </div>

                {/* Cached Repos List */}
                {cacheData.cachedReposList.length > 0 && (
                  <div>
                    <h3 className="text-sm font-medium text-accent mb-3">Repos in Cache List</h3>
                    <div className="border border-border rounded-lg divide-y divide-border">
                      {cacheData.cachedReposList.map((repo) => {
                        const repoKey = `${repo.repo_owner}/${repo.repo_name}`;
                        const isOnDisk = cacheData.reposOnDisk.includes(repoKey);
                        const diskSize = cacheData.repoSizes[repoKey];

                        return (
                          <div
                            key={repo.id}
                            className="flex items-center justify-between px-4 py-3 hover:bg-bg-subtle"
                          >
                            <div className="flex items-center gap-3">
                              <svg className="h-5 w-5 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                              </svg>
                              <div>
                                <div className="text-sm font-medium text-accent">{repoKey}</div>
                                <div className="flex items-center gap-2 text-xs text-text-muted">
                                  {repo.notes && <span>{repo.notes}</span>}
                                  {isOnDisk ? (
                                    <span className="inline-flex items-center gap-1 text-success">
                                      <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
                                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                      </svg>
                                      Cached ({diskSize?.formatted || "?"})
                                    </span>
                                  ) : (
                                    <span className="text-text-muted">Not cached yet</span>
                                  )}
                                </div>
                              </div>
                            </div>
                            <button
                              onClick={() => removeCacheRepoMutation.mutate({
                                repoOwner: repo.repo_owner,
                                repoName: repo.repo_name,
                                deleteFromDisk: isOnDisk,
                              })}
                              disabled={removeCacheRepoMutation.isPending}
                              className="text-xs text-error hover:text-error/80 font-medium"
                            >
                              Remove
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Repos on Disk but not in List */}
                {cacheData.reposOnDisk.filter(
                  (ownerRepo) => !cacheData.cachedReposList.some((cr) => `${cr.repo_owner}/${cr.repo_name}` === ownerRepo)
                ).length > 0 && (
                  <div>
                    <h3 className="text-sm font-medium text-accent mb-3">
                      Cached on Disk (not in list)
                    </h3>
                    <p className="text-xs text-text-muted mb-3">
                      These repos are on disk but not in the cache list. They will not be updated on future simulations.
                    </p>
                    <div className="border border-border rounded-lg divide-y divide-border">
                      {cacheData.reposOnDisk
                        .filter((ownerRepo) => !cacheData.cachedReposList.some((cr) => `${cr.repo_owner}/${cr.repo_name}` === ownerRepo))
                        .map((ownerRepo) => {
                          const diskSize = cacheData.repoSizes[ownerRepo];
                          const [owner, repoName] = ownerRepo.split("/");
                          return (
                            <div
                              key={ownerRepo}
                              className="flex items-center justify-between px-4 py-3 hover:bg-bg-subtle"
                            >
                              <div className="flex items-center gap-3">
                                <svg className="h-5 w-5 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                                </svg>
                                <div>
                                  <div className="text-sm font-medium text-accent">{ownerRepo}</div>
                                  <div className="text-xs text-text-muted">
                                    {diskSize?.formatted || "Unknown size"}
                                  </div>
                                </div>
                              </div>
                              <button
                                onClick={() => removeCacheRepoMutation.mutate({
                                  repoOwner: owner,
                                  repoName: repoName,
                                  deleteFromDisk: true,
                                })}
                                disabled={removeCacheRepoMutation.isPending}
                                className="text-xs text-error hover:text-error/80 font-medium"
                              >
                                Delete from Disk
                              </button>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                )}
              </div>
            ) : null}
          </div>
          )}

          {/* Add Cache Repo Modal - Mobile */}
          {showAddCacheModal && (
            <>
              {/* Backdrop */}
              <div
                className="fixed inset-0 bg-black/50 z-50"
                onClick={() => {
                  setShowAddCacheModal(false);
                  setNewCacheRepo("");
                  setCacheNotes("");
                  setShowCacheAutocomplete(false);
                }}
              />

              {/* Modal */}
              <div className="fixed inset-x-4 top-1/2 -translate-y-1/2 bg-white rounded-xl z-50 shadow-2xl max-h-[80vh] overflow-hidden flex flex-col">
                {/* Modal Header */}
                <div className="flex items-center justify-between px-4 py-4 border-b border-border">
                  <h3 className="text-lg font-semibold text-accent">Add Repository</h3>
                  <button
                    onClick={() => {
                      setShowAddCacheModal(false);
                      setNewCacheRepo("");
                      setCacheNotes("");
                      setShowCacheAutocomplete(false);
                    }}
                    className="p-2 -mr-2 text-text-muted hover:text-accent transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
                  >
                    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                {/* Modal Content */}
                <div className="p-4 space-y-4 overflow-y-auto">
                  {/* Repo Input */}
                  <div>
                    <label className="block text-sm font-medium text-accent mb-2">
                      Repository
                    </label>
                    <div className="relative" ref={modalCacheInputRef}>
                      <input
                        type="text"
                        value={newCacheRepo}
                        onChange={(e) => {
                          setNewCacheRepo(e.target.value);
                          setShowCacheAutocomplete(true);
                        }}
                        onFocus={() => setShowCacheAutocomplete(true)}
                        placeholder="owner/repo (e.g., supabase/supabase)"
                        className="w-full px-3 py-3 min-h-[44px] bg-white border border-border rounded-lg text-sm text-black placeholder:text-text-muted focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors"
                        autoFocus
                      />

                      {/* Autocomplete Dropdown */}
                      {showCacheAutocomplete && cacheSuggestions.length > 0 && (
                        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-border rounded-lg shadow-lg z-30 max-h-[200px] overflow-y-auto">
                          {cacheSuggestions.slice(0, 10).map((suggestion, index) => (
                            <button
                              key={`modal-${suggestion.repoOwner}/${suggestion.repoName}-${index}`}
                              onClick={() => {
                                setNewCacheRepo(`${suggestion.repoOwner}/${suggestion.repoName}`);
                                setShowCacheAutocomplete(false);
                              }}
                              className="w-full px-3 py-3 min-h-[44px] text-left hover:bg-bg-subtle transition-colors flex items-center gap-2 border-b border-border last:border-b-0"
                            >
                              <svg className="h-4 w-4 text-text-muted flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                              </svg>
                              <span className="text-sm text-accent truncate">{suggestion.repoOwner}/{suggestion.repoName}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Notes Input */}
                  <div>
                    <label className="block text-sm font-medium text-accent mb-2">
                      Notes <span className="text-text-muted font-normal">(optional)</span>
                    </label>
                    <input
                      type="text"
                      value={cacheNotes}
                      onChange={(e) => setCacheNotes(e.target.value)}
                      placeholder="e.g., Strategic account - Series B"
                      className="w-full px-3 py-3 min-h-[44px] bg-white border border-border rounded-lg text-sm text-black placeholder:text-text-muted focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors"
                    />
                  </div>

                  <p className="text-xs text-text-muted">
                    Repos in this list will be cached on disk for faster PR simulation.
                  </p>
                </div>

                {/* Modal Footer */}
                <div className="px-4 py-4 border-t border-border flex gap-3">
                  <button
                    onClick={() => {
                      setShowAddCacheModal(false);
                      setNewCacheRepo("");
                      setCacheNotes("");
                      setShowCacheAutocomplete(false);
                    }}
                    className="flex-1 px-4 py-3 min-h-[44px] bg-bg-subtle hover:bg-border text-text-secondary text-sm font-medium rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleAddCacheRepo}
                    disabled={!newCacheRepo.trim() || addCacheRepoMutation.isPending}
                    className="flex-1 px-4 py-3 min-h-[44px] bg-primary hover:bg-primary-hover text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {addCacheRepoMutation.isPending ? "Adding..." : "Add Repository"}
                  </button>
                </div>
              </div>
            </>
          )}

          {/* Schema Compatibility Warning Modal */}
          {showSchemaWarningModal && validationResult && (
            <>
              {/* Backdrop */}
              <div
                className="fixed inset-0 bg-black/50 z-50"
                onClick={handleCancelSave}
              />

              {/* Modal */}
              <div className="fixed inset-4 md:inset-auto md:top-1/2 md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:max-w-lg md:w-full bg-white rounded-xl z-50 flex flex-col overflow-hidden shadow-2xl max-h-[90vh]">
                {/* Modal Header */}
                <div className="px-6 py-4 border-b border-border bg-yellow-50">
                  <h2 className="text-lg font-semibold text-yellow-700 flex items-center gap-2">
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    Schema Compatibility Warning
                  </h2>
                </div>

                {/* Modal Content */}
                <div className="flex-1 overflow-y-auto p-6 space-y-4">
                  <p className="text-gray-600">
                    This prompt change may break the application. The code expects specific
                    fields that appear to be missing or changed.
                  </p>

                  {/* Missing Fields */}
                  {validationResult.missing_fields && validationResult.missing_fields.length > 0 && (
                    <div>
                      <h4 className="font-medium text-red-600 mb-1">Missing Required Fields:</h4>
                      <ul className="list-disc list-inside text-sm">
                        {validationResult.missing_fields.map((field) => (
                          <li key={field} className="text-red-600 font-mono">{field}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Type Mismatches */}
                  {validationResult.type_mismatches && validationResult.type_mismatches.length > 0 && (
                    <div>
                      <h4 className="font-medium text-orange-600 mb-1">Type Mismatches:</h4>
                      <ul className="list-disc list-inside text-sm">
                        {validationResult.type_mismatches.map((m) => (
                          <li key={m.field} className="text-orange-600">
                            <span className="font-mono">{m.field}</span>: expected {m.expected}, found {m.found}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Renamed Fields */}
                  {validationResult.renamed_fields && validationResult.renamed_fields.length > 0 && (
                    <div>
                      <h4 className="font-medium text-yellow-600 mb-1">Possibly Renamed Fields:</h4>
                      <ul className="list-disc list-inside text-sm">
                        {validationResult.renamed_fields.map((r) => (
                          <li key={r.expected} className="text-yellow-600">
                            &quot;<span className="font-mono">{r.expected}</span>&quot; -&gt; &quot;<span className="font-mono">{r.found}</span>&quot; ({r.confidence} confidence)
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Summary */}
                  {validationResult.summary && (
                    <p className="text-sm text-gray-700 italic">{validationResult.summary}</p>
                  )}

                  {/* Help Text */}
                  <div className="p-3 bg-gray-50 rounded text-sm text-gray-600">
                    <strong>To fix this:</strong> Either update your prompt to include the
                    required fields, or update the application code to handle the new schema.
                  </div>
                </div>

                {/* Modal Footer */}
                <div className="px-6 py-4 border-t border-border bg-bg-subtle flex flex-col sm:flex-row gap-3 sm:justify-end">
                  <button
                    onClick={handleCancelSave}
                    className="px-4 py-2 min-h-[44px] border border-gray-300 hover:bg-gray-50 text-gray-700 font-medium rounded-lg transition-colors"
                  >
                    Go Back & Edit
                  </button>
                  <button
                    onClick={handleForceSave}
                    className="px-4 py-2 min-h-[44px] bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg transition-colors"
                  >
                    Save Anyway (Dangerous)
                  </button>
                </div>
              </div>
            </>
          )}

          {/* Simulation Results Modal */}
          {showSimulationModal && simulationResult && (
            <>
              {/* Backdrop */}
              <div
                className="fixed inset-0 bg-black/50 z-50"
                onClick={() => setShowSimulationModal(false)}
              />

              {/* Modal */}
              <div className="fixed inset-4 md:inset-auto md:top-1/2 md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:max-w-4xl md:w-full bg-white rounded-xl z-50 flex flex-col overflow-hidden shadow-2xl max-h-[90vh]">
                {/* Modal Header */}
                <div className="px-6 py-4 border-b border-border bg-blue-50">
                  <div className="flex items-center justify-between">
                    <h2 className="text-lg font-semibold text-blue-700 flex items-center gap-2">
                      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      Simulation Results
                    </h2>
                    <button
                      onClick={() => setShowSimulationModal(false)}
                      className="p-2 hover:bg-blue-100 rounded-lg transition-colors"
                    >
                      <svg className="h-5 w-5 text-blue-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>

                {/* Modal Content */}
                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                  {/* Execution Info */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="bg-gray-50 rounded-lg p-3">
                      <div className="text-xs text-gray-500 mb-1">Model</div>
                      <div className="font-medium text-sm truncate" title={simulationResult.model}>
                        {simulationResult.model}
                      </div>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-3">
                      <div className="text-xs text-gray-500 mb-1">Execution Time</div>
                      <div className="font-medium text-sm">
                        {(simulationResult.executionTimeMs / 1000).toFixed(2)}s
                      </div>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-3">
                      <div className="text-xs text-gray-500 mb-1">Est. Input Tokens</div>
                      <div className="font-medium text-sm">
                        ~{simulationResult.inputTokensEstimate.toLocaleString()}
                      </div>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-3">
                      <div className="text-xs text-gray-500 mb-1">Test PR ID</div>
                      <div className="font-medium text-sm">
                        #{simulationResult.testDataUsed.prId}
                      </div>
                    </div>
                  </div>

                  {/* Test Data Info */}
                  <div className="text-sm text-gray-600">
                    <span className="font-medium">Test data from:</span>{" "}
                    <a
                      href={simulationResult.testDataUsed.forkedPrUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline"
                    >
                      {simulationResult.testDataUsed.forkedPrUrl}
                    </a>
                  </div>

                  {/* Schema Validation Result */}
                  {simulationResult.schemaValidation && (
                    <div
                      className={`rounded-lg border p-4 ${
                        simulationResult.schemaValidation.compatible
                          ? "bg-green-50 border-green-200"
                          : "bg-yellow-50 border-yellow-200"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        {simulationResult.schemaValidation.compatible ? (
                          <svg className="h-5 w-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        ) : (
                          <svg className="h-5 w-5 text-yellow-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                          </svg>
                        )}
                        <span className={`font-medium ${simulationResult.schemaValidation.compatible ? "text-green-700" : "text-yellow-700"}`}>
                          {simulationResult.schemaValidation.compatible ? "Schema Compatible" : "Schema Changes Detected"}
                        </span>
                      </div>
                      {simulationResult.schemaValidation.summary && (
                        <p className={`mt-2 text-sm ${simulationResult.schemaValidation.compatible ? "text-green-600" : "text-yellow-600"}`}>
                          {simulationResult.schemaValidation.summary}
                        </p>
                      )}
                      {simulationResult.schemaValidation.missing_fields && simulationResult.schemaValidation.missing_fields.length > 0 && (
                        <div className="mt-2">
                          <span className="text-sm font-medium text-red-600">Missing fields: </span>
                          <span className="text-sm text-red-600 font-mono">
                            {simulationResult.schemaValidation.missing_fields.join(", ")}
                          </span>
                        </div>
                      )}
                      {simulationResult.schemaValidation.warnings && simulationResult.schemaValidation.warnings.length > 0 && (
                        <ul className="mt-2 text-xs list-disc list-inside text-yellow-600">
                          {simulationResult.schemaValidation.warnings.map((w: string, i: number) => (
                            <li key={i}>{w}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}

                  {/* Parse Error Warning */}
                  {simulationResult.parseError && (
                    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                      <div className="flex items-center gap-2 text-yellow-700">
                        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                        <span className="font-medium">JSON Parse Error</span>
                      </div>
                      <p className="mt-2 text-sm text-yellow-600">{simulationResult.parseError}</p>
                    </div>
                  )}

                  {/* Output */}
                  <div>
                    <h3 className="text-sm font-medium text-gray-700 mb-2">
                      {simulationResult.parsedOutput ? "Parsed JSON Output" : "Raw Output"}
                    </h3>
                    <pre className="bg-gray-900 text-gray-100 rounded-lg p-4 overflow-x-auto text-xs font-mono whitespace-pre-wrap max-h-[400px] overflow-y-auto">
                      {simulationResult.rawOutput}
                    </pre>
                  </div>
                </div>

                {/* Modal Footer */}
                <div className="px-6 py-4 border-t border-border bg-bg-subtle flex justify-end">
                  <button
                    onClick={() => setShowSimulationModal(false)}
                    className="px-4 py-2 min-h-[44px] bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
                  >
                    Close
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
