import { getSettings } from "@/lib/services/database";

// Cache for API keys to avoid repeated database calls
let cachedKeys: Record<string, string> | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 60 * 1000; // 1 minute cache TTL

/**
 * Configuration keys stored in the database.
 */
const CONFIG_KEYS = [
  "github_token",
  "anthropic_api_key",
  "turso_database_url",
  "turso_auth_token",
  "upstash_redis_url",
  "upstash_redis_token",
];

/**
 * Clears the API key cache. Call this when settings are updated.
 */
export function clearApiKeyCache(): void {
  cachedKeys = null;
  cacheTimestamp = 0;
}

/**
 * Get all API keys from database settings, falling back to environment variables.
 * Results are cached for 1 minute.
 */
async function getAllKeys(): Promise<Record<string, string>> {
  const now = Date.now();

  // Return cached keys if still valid
  if (cachedKeys && now - cacheTimestamp < CACHE_TTL) {
    return cachedKeys;
  }

  try {
    const dbSettings = await getSettings(CONFIG_KEYS);
    cachedKeys = dbSettings;
    cacheTimestamp = now;
    return dbSettings;
  } catch (error) {
    console.error("Failed to fetch API keys from database:", error);
    // Return empty object to fall back to env vars
    return {};
  }
}

/**
 * Get the GitHub token from database settings or environment variable.
 */
export async function getGitHubToken(): Promise<string | undefined> {
  const dbKeys = await getAllKeys();
  return dbKeys.github_token || process.env.GITHUB_TOKEN;
}

/**
 * Get the Anthropic API key from database settings or environment variable.
 */
export async function getAnthropicApiKey(): Promise<string | undefined> {
  const dbKeys = await getAllKeys();
  return dbKeys.anthropic_api_key || process.env.ANTHROPIC_API_KEY;
}

/**
 * Get the Upstash Redis URL from database settings or environment variable.
 */
export async function getUpstashRedisUrl(): Promise<string | undefined> {
  const dbKeys = await getAllKeys();
  return dbKeys.upstash_redis_url || process.env.UPSTASH_REDIS_REST_URL;
}

/**
 * Get the Upstash Redis token from database settings or environment variable.
 */
export async function getUpstashRedisToken(): Promise<string | undefined> {
  const dbKeys = await getAllKeys();
  return dbKeys.upstash_redis_token || process.env.UPSTASH_REDIS_REST_TOKEN;
}

/**
 * Check if required API keys are configured.
 */
export async function checkRequiredKeys(): Promise<{
  github: boolean;
  anthropic: boolean;
  redis: boolean;
}> {
  const [github, anthropic, redisUrl, redisToken] = await Promise.all([
    getGitHubToken(),
    getAnthropicApiKey(),
    getUpstashRedisUrl(),
    getUpstashRedisToken(),
  ]);

  return {
    github: !!github,
    anthropic: !!anthropic,
    redis: !!redisUrl && !!redisToken,
  };
}
