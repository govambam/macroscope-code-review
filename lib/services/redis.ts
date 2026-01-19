import { Redis } from "@upstash/redis";

let redis: Redis | null = null;

function getRedis(): Redis | null {
  if (redis) return redis;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    // Redis is optional - return null if not configured
    return null;
  }

  redis = new Redis({ url, token });
  return redis;
}

// Cache key prefixes
const CACHE_KEYS = {
  forks: (owner: string) => `forks:${owner}`,
  analysis: (prUrl: string) => `analysis:${encodeURIComponent(prUrl)}`,
  prBugs: (repoName: string, prNumber: number) => `bugs:${repoName}:${prNumber}`,
};

// Default TTLs in seconds
const TTL = {
  forks: 5 * 60, // 5 minutes
  analysis: 30 * 60, // 30 minutes
  prBugs: 10 * 60, // 10 minutes
};

/**
 * Get cached forks for a user
 */
export async function getCachedForks<T>(owner: string): Promise<T | null> {
  const client = getRedis();
  if (!client) return null;

  try {
    const data = await client.get<T>(CACHE_KEYS.forks(owner));
    return data;
  } catch (error) {
    console.error("Redis getCachedForks error:", error);
    return null;
  }
}

/**
 * Cache forks for a user
 */
export async function setCachedForks<T>(owner: string, forks: T): Promise<void> {
  const client = getRedis();
  if (!client) return;

  try {
    await client.set(CACHE_KEYS.forks(owner), forks, { ex: TTL.forks });
  } catch (error) {
    console.error("Redis setCachedForks error:", error);
  }
}

/**
 * Invalidate forks cache for a user
 */
export async function invalidateForksCache(owner: string): Promise<void> {
  const client = getRedis();
  if (!client) return;

  try {
    await client.del(CACHE_KEYS.forks(owner));
  } catch (error) {
    console.error("Redis invalidateForksCache error:", error);
  }
}

/**
 * Get cached analysis for a PR URL
 */
export async function getCachedAnalysis<T>(prUrl: string): Promise<T | null> {
  const client = getRedis();
  if (!client) return null;

  try {
    const data = await client.get<T>(CACHE_KEYS.analysis(prUrl));
    return data;
  } catch (error) {
    console.error("Redis getCachedAnalysis error:", error);
    return null;
  }
}

/**
 * Cache analysis for a PR URL
 */
export async function setCachedAnalysis<T>(prUrl: string, analysis: T): Promise<void> {
  const client = getRedis();
  if (!client) return;

  try {
    await client.set(CACHE_KEYS.analysis(prUrl), analysis, { ex: TTL.analysis });
  } catch (error) {
    console.error("Redis setCachedAnalysis error:", error);
  }
}

/**
 * Invalidate analysis cache for a PR URL
 */
export async function invalidateAnalysisCache(prUrl: string): Promise<void> {
  const client = getRedis();
  if (!client) return;

  try {
    await client.del(CACHE_KEYS.analysis(prUrl));
  } catch (error) {
    console.error("Redis invalidateAnalysisCache error:", error);
  }
}

/**
 * Get cached bug count for a PR
 */
export async function getCachedPRBugs(repoName: string, prNumber: number): Promise<number | null> {
  const client = getRedis();
  if (!client) return null;

  try {
    const data = await client.get<number>(CACHE_KEYS.prBugs(repoName, prNumber));
    return data;
  } catch (error) {
    console.error("Redis getCachedPRBugs error:", error);
    return null;
  }
}

/**
 * Cache bug count for a PR
 */
export async function setCachedPRBugs(repoName: string, prNumber: number, bugCount: number): Promise<void> {
  const client = getRedis();
  if (!client) return;

  try {
    await client.set(CACHE_KEYS.prBugs(repoName, prNumber), bugCount, { ex: TTL.prBugs });
  } catch (error) {
    console.error("Redis setCachedPRBugs error:", error);
  }
}

/**
 * Check if Redis is configured and available
 */
export function isRedisConfigured(): boolean {
  return !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}
