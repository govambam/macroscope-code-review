import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import Database from "better-sqlite3";
import fs from "fs";
import os from "os";

export const dynamic = "force-dynamic";

/**
 * Status endpoint for monitoring and debugging
 * Shows detailed system information
 * Only accessible to authenticated users
 */
export async function GET() {
  // Require authentication
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    let forkCount = 0;
    let prCount = 0;
    let analysisCount = 0;
    let dbSize = 0;
    let dbExists = false;

    // Get database stats
    try {
      dbExists = fs.existsSync(config.dbPath);
      if (dbExists) {
        dbSize = fs.statSync(config.dbPath).size;
        const db = new Database(config.dbPath, { readonly: true });
        try {
          forkCount = (db.prepare("SELECT COUNT(*) as count FROM forks").get() as { count: number })?.count || 0;
          prCount = (db.prepare("SELECT COUNT(*) as count FROM prs").get() as { count: number })?.count || 0;
          analysisCount = (db.prepare("SELECT COUNT(*) as count FROM pr_analyses").get() as { count: number })?.count || 0;
        } finally {
          db.close();
        }
      }
    } catch {
      // Database might not be initialized yet
    }

    // Get repos cache size
    const reposCacheSize = fs.existsSync(config.reposDir)
      ? getDirectorySize(config.reposDir)
      : 0;

    const status = {
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),

      // Environment
      environment: {
        isRailway: config.isRailway,
        isProduction: config.isProduction,
        nodeVersion: process.version,
        platform: os.platform(),
        arch: os.arch(),
      },

      // Paths
      paths: {
        dataDir: config.dataDir,
        dbPath: config.dbPath,
        reposDir: config.reposDir,
      },

      // Database stats
      database: {
        exists: dbExists,
        size: formatBytes(dbSize),
        sizeBytes: dbSize,
        forkCount,
        prCount,
        analysisCount,
      },

      // Filesystem
      filesystem: {
        dataDirExists: fs.existsSync(config.dataDir),
        reposDirExists: fs.existsSync(config.reposDir),
        reposCacheSize: formatBytes(reposCacheSize),
        reposCacheSizeBytes: reposCacheSize,
      },

      // Memory
      memory: {
        used: formatBytes(process.memoryUsage().heapUsed),
        total: formatBytes(process.memoryUsage().heapTotal),
        usedBytes: process.memoryUsage().heapUsed,
        totalBytes: process.memoryUsage().heapTotal,
      },

      // User
      user: {
        login: session.user?.login || session.user?.name || "unknown",
        name: session.user?.name || null,
      },
    };

    return NextResponse.json(status, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      {
        timestamp: new Date().toISOString(),
        error: message,
      },
      { status: 500 }
    );
  }
}

// Helper to get directory size recursively
function getDirectorySize(dir: string): number {
  let size = 0;
  try {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const filePath = `${dir}/${file}`;
      const stats = fs.statSync(filePath);
      if (stats.isDirectory()) {
        size += getDirectorySize(filePath);
      } else {
        size += stats.size;
      }
    }
  } catch {
    // Ignore errors (permission issues, etc.)
  }
  return size;
}

// Helper to format bytes
function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
