/**
 * Environment configuration
 * Works both locally and on Railway
 */

import path from "path";

const isRailway = process.env.RAILWAY_ENVIRONMENT !== undefined;
const isProduction = process.env.NODE_ENV === "production";
const isDevelopment = !isProduction;

// Determine data directory
// - Railway: Use /data (persistent volume mount point)
// - Local: Use ./data relative to project root
const defaultDataDir = isRailway ? "/data" : path.join(process.cwd(), "data");

export const config = {
  // Environment detection
  isRailway,
  isProduction,
  isDevelopment,

  // App URLs
  appUrl: process.env.NEXTAUTH_URL || "http://localhost:3000",

  // Data paths
  dataDir: process.env.DATA_DIR || defaultDataDir,
  get dbPath() {
    return process.env.DB_PATH || path.join(this.dataDir, "pr-creator.db");
  },
  get reposDir() {
    return process.env.REPOS_DIR || path.join(this.dataDir, "repos");
  },

  // API keys
  githubToken: process.env.GITHUB_BOT_TOKEN || process.env.GITHUB_TOKEN,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,

  // Auth
  githubClientId: process.env.GITHUB_CLIENT_ID,
  githubClientSecret: process.env.GITHUB_CLIENT_SECRET,
  nextAuthSecret: process.env.NEXTAUTH_SECRET,

  // Railway-specific
  railwayEnvironment: process.env.RAILWAY_ENVIRONMENT, // 'production' or 'staging'
  railwayProjectId: process.env.RAILWAY_PROJECT_ID,
  railwayServiceId: process.env.RAILWAY_SERVICE_ID,
};

// Validate required environment variables
export function validateConfig(): { valid: boolean; missing: string[] } {
  const required = [
    "GITHUB_CLIENT_ID",
    "GITHUB_CLIENT_SECRET",
    "NEXTAUTH_SECRET",
    "ANTHROPIC_API_KEY",
  ];

  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    console.error("Missing required environment variables:", missing.join(", "));
    if (isProduction) {
      throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
    }
  } else {
    console.log("Environment configuration validated");
  }

  return { valid: missing.length === 0, missing };
}

// Log configuration on startup (without secrets)
export function logConfig(): void {
  console.log("Environment Configuration:");
  console.log("  Environment:", isRailway ? "Railway" : "Local");
  console.log("  Mode:", isProduction ? "Production" : "Development");
  console.log("  Data directory:", config.dataDir);
  console.log("  Database path:", config.dbPath);
  console.log("  Repos directory:", config.reposDir);
  console.log("  App URL:", config.appUrl);
  if (isRailway) {
    console.log("  Railway Environment:", config.railwayEnvironment);
  }
}
