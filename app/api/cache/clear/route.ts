import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { config } from "@/lib/config";
import fs from "fs";
import path from "path";

/**
 * Calculate directory size recursively.
 */
function getDirectorySize(dirPath: string): number {
  if (!fs.existsSync(dirPath)) {
    return 0;
  }

  let totalSize = 0;
  let items;
  try {
    items = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    // Skip directories we can't read
    return 0;
  }

  for (const item of items) {
    const itemPath = path.join(dirPath, item.name);
    if (item.isDirectory()) {
      totalSize += getDirectorySize(itemPath);
    } else if (item.isFile()) {
      try {
        const stats = fs.statSync(itemPath);
        totalSize += stats.size;
      } catch {
        // Skip files we can't read
      }
    }
  }

  return totalSize;
}

/**
 * Format bytes to human-readable string.
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * POST /api/cache/clear
 * Clears all cached repos from disk.
 */
export async function POST(): Promise<NextResponse> {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const reposDir = config.reposDir;

    if (!fs.existsSync(reposDir)) {
      return NextResponse.json({
        success: true,
        message: "Cache directory does not exist, nothing to clear",
        deletedRepos: 0,
        freedBytes: 0,
        freedFormatted: "0 B",
      });
    }

    // Get size before clearing
    const sizeBeforeBytes = getDirectorySize(reposDir);

    // Get list of repos to delete
    const items = fs.readdirSync(reposDir, { withFileTypes: true });
    const reposToDelete = items.filter((item) => item.isDirectory()).map((item) => item.name);

    // Delete each repo directory
    let deletedCount = 0;
    for (const repo of reposToDelete) {
      const repoPath = path.join(reposDir, repo);
      try {
        fs.rmSync(repoPath, { recursive: true, force: true });
        deletedCount++;
        console.log(`Deleted cached repo: ${repo}`);
      } catch (error) {
        console.error(`Failed to delete ${repo}:`, error);
      }
    }

    // Get size after clearing
    const sizeAfterBytes = getDirectorySize(reposDir);
    const freedBytes = sizeBeforeBytes - sizeAfterBytes;

    return NextResponse.json({
      success: true,
      message: `Cleared ${deletedCount} cached repos`,
      deletedRepos: deletedCount,
      deletedRepoNames: reposToDelete,
      freedBytes,
      freedFormatted: formatBytes(freedBytes),
      previousSizeFormatted: formatBytes(sizeBeforeBytes),
    });
  } catch (error) {
    console.error("Error clearing cache:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
