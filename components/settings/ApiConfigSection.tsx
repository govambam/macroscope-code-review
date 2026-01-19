"use client";

import { useState, useEffect } from "react";
import { useApiConfig, useUpdateConfig, useValidateGitHub, ApiConfig } from "@/lib/hooks/use-settings";

interface TokenFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  helpText?: string;
  helpLink?: { text: string; url: string };
  isPassword?: boolean;
  hasEnvVar?: boolean;
  testButton?: {
    onClick: () => void;
    isLoading: boolean;
    status: "success" | "error" | "idle";
    message?: string;
  };
}

function TokenField({
  label,
  value,
  onChange,
  placeholder,
  helpText,
  helpLink,
  isPassword = true,
  hasEnvVar,
  testButton,
}: TokenFieldProps) {
  const [showPassword, setShowPassword] = useState(false);

  return (
    <div>
      <label className="block text-sm font-medium text-accent mb-2">
        {label}
        {hasEnvVar && (
          <span className="ml-2 text-xs font-normal text-text-muted">(set via env var)</span>
        )}
      </label>
      <div className="flex gap-2">
        <div className="flex-1 relative">
          <input
            type={isPassword && !showPassword ? "password" : "text"}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            className="w-full px-4 py-2.5 bg-white border border-border rounded-lg text-black placeholder:text-text-muted focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors pr-10"
          />
          {isPassword && (
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-accent"
            >
              {showPassword ? (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
              )}
            </button>
          )}
        </div>
        {testButton && (
          <button
            type="button"
            onClick={testButton.onClick}
            disabled={testButton.isLoading || !value}
            className="px-3 py-2 text-sm font-medium border border-border rounded-lg hover:bg-bg-subtle transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
          >
            {testButton.isLoading ? (
              <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            ) : (
              "Test Connection"
            )}
          </button>
        )}
      </div>
      {testButton && testButton.status !== "idle" && (
        <div
          className={`mt-2 text-sm flex items-center gap-1 ${
            testButton.status === "success" ? "text-success" : "text-error"
          }`}
        >
          {testButton.status === "success" ? (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          )}
          {testButton.message}
        </div>
      )}
      {helpText && (
        <p className="mt-1 text-xs text-text-muted">
          {helpText}
          {helpLink && (
            <>
              {" "}
              <a
                href={helpLink.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                {helpLink.text}
              </a>
            </>
          )}
        </p>
      )}
    </div>
  );
}

export function ApiConfigSection() {
  const { data, isLoading: configLoading } = useApiConfig();
  const updateConfigMutation = useUpdateConfig();
  const validateGitHubMutation = useValidateGitHub();

  const [config, setConfig] = useState<ApiConfig>({});
  const [hasChanges, setHasChanges] = useState(false);
  const [notification, setNotification] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [githubStatus, setGithubStatus] = useState<{
    status: "success" | "error" | "idle";
    message?: string;
  }>({ status: "idle" });

  // Initialize form from fetched data
  useEffect(() => {
    if (data?.config) {
      setConfig(data.config);
      setHasChanges(false);
    }
  }, [data]);

  const updateField = (field: keyof ApiConfig, value: string) => {
    setConfig((prev) => ({ ...prev, [field]: value }));
    setHasChanges(true);
    // Reset GitHub status if token changes
    if (field === "githubToken") {
      setGithubStatus({ status: "idle" });
    }
  };

  const handleTestGitHub = async () => {
    if (!config.githubToken) return;

    setGithubStatus({ status: "idle" });
    try {
      const result = await validateGitHubMutation.mutateAsync(config.githubToken);
      setGithubStatus({ status: "success", message: `Connected as @${result.username}` });
    } catch (error) {
      setGithubStatus({
        status: "error",
        message: error instanceof Error ? error.message : "Invalid token",
      });
    }
  };

  const handleSave = async () => {
    setNotification(null);
    try {
      await updateConfigMutation.mutateAsync(config);
      setNotification({ type: "success", message: "API configuration saved successfully" });
      setHasChanges(false);
    } catch (error) {
      setNotification({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to save configuration",
      });
    }
  };

  if (configLoading) {
    return (
      <div className="bg-white border border-border rounded-xl shadow-sm p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-bg-subtle rounded w-1/4"></div>
          <div className="h-10 bg-bg-subtle rounded"></div>
          <div className="h-10 bg-bg-subtle rounded"></div>
        </div>
      </div>
    );
  }

  const hasEnvVars = data?.hasEnvVars || {};

  return (
    <div className="bg-white border border-border rounded-xl shadow-sm p-6">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-accent flex items-center gap-2">
          <span>API Configuration</span>
        </h2>
        <p className="mt-1 text-sm text-text-secondary">
          Configure API tokens and credentials
        </p>
        <p className="mt-2 text-xs text-text-muted flex items-center gap-1">
          <svg className="w-4 h-4 text-warning" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          Keep your tokens secure. Never share them or include them in screenshots.
        </p>
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

      <div className="space-y-6">
        <TokenField
          label="GitHub Token"
          value={config.githubToken || ""}
          onChange={(v) => updateField("githubToken", v)}
          placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
          helpText="Your personal GitHub access token for creating PRs."
          helpLink={{
            text: "How to generate a GitHub token",
            url: "https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens",
          }}
          hasEnvVar={hasEnvVars.githubToken}
          testButton={{
            onClick: handleTestGitHub,
            isLoading: validateGitHubMutation.isPending,
            status: githubStatus.status,
            message: githubStatus.message,
          }}
        />

        <TokenField
          label="Anthropic API Key"
          value={config.anthropicApiKey || ""}
          onChange={(v) => updateField("anthropicApiKey", v)}
          placeholder="sk-ant-xxxxxxxxxxxxxxxxxxxx"
          helpText="API key for Claude Opus and Sonnet"
          hasEnvVar={hasEnvVars.anthropicApiKey}
        />

        <div className="border-t border-border pt-6">
          <h3 className="text-sm font-medium text-text-secondary mb-4">Database Configuration</h3>
          <div className="space-y-4">
            <TokenField
              label="Turso Database URL"
              value={config.tursoDatabaseUrl || ""}
              onChange={(v) => updateField("tursoDatabaseUrl", v)}
              placeholder="libsql://your-database.turso.io"
              helpText="Database connection URL"
              isPassword={false}
              hasEnvVar={hasEnvVars.tursoDatabaseUrl}
            />

            <TokenField
              label="Turso Auth Token"
              value={config.tursoAuthToken || ""}
              onChange={(v) => updateField("tursoAuthToken", v)}
              placeholder="eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9..."
              hasEnvVar={hasEnvVars.tursoAuthToken}
            />
          </div>
        </div>

        <div className="border-t border-border pt-6">
          <h3 className="text-sm font-medium text-text-secondary mb-4">Cache Configuration</h3>
          <div className="space-y-4">
            <TokenField
              label="Upstash Redis REST URL"
              value={config.upstashRedisUrl || ""}
              onChange={(v) => updateField("upstashRedisUrl", v)}
              placeholder="https://xxxx.upstash.io"
              isPassword={false}
              hasEnvVar={hasEnvVars.upstashRedisUrl}
            />

            <TokenField
              label="Upstash Redis REST Token"
              value={config.upstashRedisToken || ""}
              onChange={(v) => updateField("upstashRedisToken", v)}
              placeholder="AXxxxxxxxxxxxxxxxxxxxxxx"
              hasEnvVar={hasEnvVars.upstashRedisToken}
            />
          </div>
        </div>
      </div>

      <div className="mt-8 pt-6 border-t border-border">
        <button
          onClick={handleSave}
          disabled={!hasChanges || updateConfigMutation.isPending}
          className="w-full sm:w-auto px-6 py-2.5 bg-primary hover:bg-primary-hover text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {updateConfigMutation.isPending && (
            <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          )}
          Save API Configuration
        </button>
      </div>
    </div>
  );
}
