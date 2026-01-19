import { NextRequest, NextResponse } from "next/server";
import { getSettings, setSettings } from "@/lib/services/database";
import { clearApiKeyCache } from "@/lib/config/api-keys";

// Keys for API configuration stored in database
const CONFIG_KEYS = [
  "github_token",
  "anthropic_api_key",
  "turso_database_url",
  "turso_auth_token",
  "upstash_redis_url",
  "upstash_redis_token",
];

interface ApiConfig {
  githubToken?: string;
  anthropicApiKey?: string;
  tursoDatabaseUrl?: string;
  tursoAuthToken?: string;
  upstashRedisUrl?: string;
  upstashRedisToken?: string;
}

interface GetConfigResponse {
  success: boolean;
  config?: ApiConfig;
  hasEnvVars?: Record<string, boolean>;
  error?: string;
}

interface UpdateConfigRequest {
  config: ApiConfig;
}

interface UpdateConfigResponse {
  success: boolean;
  error?: string;
}

// Map from database key to camelCase key
function dbKeyToCamel(key: string): keyof ApiConfig {
  const map: Record<string, keyof ApiConfig> = {
    github_token: "githubToken",
    anthropic_api_key: "anthropicApiKey",
    turso_database_url: "tursoDatabaseUrl",
    turso_auth_token: "tursoAuthToken",
    upstash_redis_url: "upstashRedisUrl",
    upstash_redis_token: "upstashRedisToken",
  };
  return map[key] || (key as keyof ApiConfig);
}

// Map from camelCase key to database key
function camelToDbKey(key: keyof ApiConfig): string {
  const map: Record<keyof ApiConfig, string> = {
    githubToken: "github_token",
    anthropicApiKey: "anthropic_api_key",
    tursoDatabaseUrl: "turso_database_url",
    tursoAuthToken: "turso_auth_token",
    upstashRedisUrl: "upstash_redis_url",
    upstashRedisToken: "upstash_redis_token",
  };
  return map[key] || key;
}

// Check which env vars are set
function checkEnvVars(): Record<string, boolean> {
  return {
    githubToken: !!process.env.GITHUB_TOKEN,
    anthropicApiKey: !!process.env.ANTHROPIC_API_KEY,
    tursoDatabaseUrl: !!process.env.TURSO_DATABASE_URL,
    tursoAuthToken: !!process.env.TURSO_AUTH_TOKEN,
    upstashRedisUrl: !!process.env.UPSTASH_REDIS_REST_URL,
    upstashRedisToken: !!process.env.UPSTASH_REDIS_REST_TOKEN,
  };
}

/**
 * GET /api/settings/config
 * Returns API configuration (from database, falling back to env vars).
 * Values are masked for security.
 */
export async function GET(): Promise<NextResponse<GetConfigResponse>> {
  try {
    // Get settings from database
    const dbSettings = await getSettings(CONFIG_KEYS);

    // Build config object, falling back to env vars
    const config: ApiConfig = {};
    const hasEnvVars = checkEnvVars();

    // GitHub Token
    const githubToken = dbSettings.github_token || process.env.GITHUB_TOKEN;
    if (githubToken) {
      config.githubToken = maskValue(githubToken);
    }

    // Anthropic API Key
    const anthropicKey = dbSettings.anthropic_api_key || process.env.ANTHROPIC_API_KEY;
    if (anthropicKey) {
      config.anthropicApiKey = maskValue(anthropicKey);
    }

    // Turso Database URL
    const tursoUrl = dbSettings.turso_database_url || process.env.TURSO_DATABASE_URL;
    if (tursoUrl) {
      config.tursoDatabaseUrl = tursoUrl; // URLs don't need masking
    }

    // Turso Auth Token
    const tursoToken = dbSettings.turso_auth_token || process.env.TURSO_AUTH_TOKEN;
    if (tursoToken) {
      config.tursoAuthToken = maskValue(tursoToken);
    }

    // Upstash Redis URL
    const redisUrl = dbSettings.upstash_redis_url || process.env.UPSTASH_REDIS_REST_URL;
    if (redisUrl) {
      config.upstashRedisUrl = redisUrl; // URLs don't need masking
    }

    // Upstash Redis Token
    const redisToken = dbSettings.upstash_redis_token || process.env.UPSTASH_REDIS_REST_TOKEN;
    if (redisToken) {
      config.upstashRedisToken = maskValue(redisToken);
    }

    return NextResponse.json({ success: true, config, hasEnvVars });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Failed to get config:", errorMessage);
    return NextResponse.json(
      { success: false, error: `Failed to get config: ${errorMessage}` },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/settings/config
 * Updates API configuration.
 */
export async function PUT(request: NextRequest): Promise<NextResponse<UpdateConfigResponse>> {
  try {
    const body: UpdateConfigRequest = await request.json();
    const { config } = body;

    if (!config) {
      return NextResponse.json(
        { success: false, error: "Config is required" },
        { status: 400 }
      );
    }

    // Convert to database format, only including non-empty values
    // Skip values that look masked (contain asterisks)
    const dbSettings: Record<string, string> = {};

    for (const [key, value] of Object.entries(config)) {
      if (value && typeof value === "string" && !value.includes("*")) {
        const dbKey = camelToDbKey(key as keyof ApiConfig);
        dbSettings[dbKey] = value;
      }
    }

    if (Object.keys(dbSettings).length > 0) {
      await setSettings(dbSettings);
      // Clear the cached API keys so they're re-fetched with new values
      clearApiKeyCache();
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Failed to update config:", errorMessage);
    return NextResponse.json(
      { success: false, error: `Failed to update config: ${errorMessage}` },
      { status: 500 }
    );
  }
}

/**
 * Mask a sensitive value, showing only the first 4 and last 4 characters.
 */
function maskValue(value: string): string {
  if (value.length <= 8) {
    return "*".repeat(value.length);
  }
  return value.substring(0, 4) + "*".repeat(value.length - 8) + value.substring(value.length - 4);
}
