import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import Database from "better-sqlite3";
import fs from "fs";

export const dynamic = "force-dynamic";

interface HealthChecks {
  database: boolean;
  filesystem: boolean;
  envVars: boolean;
}

interface HealthResponse {
  timestamp: string;
  status: "healthy" | "unhealthy" | "error";
  environment: string;
  mode: string;
  checks: HealthChecks;
  errors: string[];
}

/**
 * Health check endpoint for Railway
 * Returns 200 OK if app is healthy, 503 if issues detected
 */
export async function GET() {
  const checks: HealthResponse = {
    timestamp: new Date().toISOString(),
    status: "healthy",
    environment: config.isRailway ? "railway" : "local",
    mode: config.isProduction ? "production" : "development",
    checks: {
      database: false,
      filesystem: false,
      envVars: false,
    },
    errors: [],
  };

  try {
    // Check 1: Database connectivity
    try {
      const db = new Database(config.dbPath, { readonly: true });
      db.prepare("SELECT 1").get();
      db.close();
      checks.checks.database = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      checks.errors.push(`Database: ${message}`);
    }

    // Check 2: Filesystem access (data directory)
    try {
      if (fs.existsSync(config.dataDir)) {
        fs.accessSync(config.dataDir, fs.constants.W_OK | fs.constants.R_OK);
        checks.checks.filesystem = true;
      } else {
        checks.errors.push("Data directory does not exist");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      checks.errors.push(`Filesystem: ${message}`);
    }

    // Check 3: Required environment variables
    const requiredVars = [
      "GITHUB_CLIENT_ID",
      "GITHUB_CLIENT_SECRET",
      "NEXTAUTH_SECRET",
      "ANTHROPIC_API_KEY",
    ];
    const missingVars = requiredVars.filter((v) => !process.env[v]);

    if (missingVars.length === 0) {
      checks.checks.envVars = true;
    } else {
      checks.errors.push(`Missing env vars: ${missingVars.join(", ")}`);
    }

    // Determine overall health
    const allChecksPass = Object.values(checks.checks).every((v) => v === true);
    checks.status = allChecksPass ? "healthy" : "unhealthy";

    // Return appropriate status code
    if (allChecksPass) {
      return NextResponse.json(checks, { status: 200 });
    } else {
      return NextResponse.json(checks, { status: 503 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      {
        timestamp: new Date().toISOString(),
        status: "error",
        error: message,
      },
      { status: 503 }
    );
  }
}
