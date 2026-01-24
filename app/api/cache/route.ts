import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { config } from "@/lib/config";
import {
  getCachedRepos,
  addCachedRepo,
  removeCachedRepo,
  isRepoCached,
} from "@/lib/services/database";
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
 * Get list of repos currently cached on disk.
 * Returns array of "owner/repo" strings.
 */
function getCachedReposOnDisk(): string[] {
  const reposDir = config.reposDir;
  if (!fs.existsSync(reposDir)) {
    return [];
  }

  const repos: string[] = [];

  // Repos are stored as reposDir/owner/repo
  let ownerDirs;
  try {
    ownerDirs = fs.readdirSync(reposDir, { withFileTypes: true });
  } catch {
    return [];
  }

  for (const ownerDir of ownerDirs) {
    if (ownerDir.isDirectory()) {
      const ownerPath = path.join(reposDir, ownerDir.name);
      let repoDirs;
      try {
        repoDirs = fs.readdirSync(ownerPath, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const repoDir of repoDirs) {
        if (repoDir.isDirectory()) {
          repos.push(`${ownerDir.name}/${repoDir.name}`);
        }
      }
    }
  }

  return repos;
}

/**
 * GET /api/cache
 * Returns cache statistics and cached repos list.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const reposDir = config.reposDir;
    const cachedRepos = getCachedRepos();
    const reposOnDisk = getCachedReposOnDisk();
    const totalSizeBytes = getDirectorySize(reposDir);

    // Get size of each repo on disk (keyed by owner/repo)
    const repoSizes: Record<string, { bytes: number; formatted: string }> = {};
    for (const ownerRepo of reposOnDisk) {
      const repoPath = path.join(reposDir, ownerRepo);
      const size = getDirectorySize(repoPath);
      repoSizes[ownerRepo] = {
        bytes: size,
        formatted: formatBytes(size),
      };
    }

    return NextResponse.json({
      success: true,
      cache: {
        totalSizeBytes,
        totalSizeFormatted: formatBytes(totalSizeBytes),
        reposOnDisk,
        repoSizes,
        cachedReposList: cachedRepos,
        reposDir,
      },
    });
  } catch (error) {
    console.error("Error getting cache info:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

interface AddCacheRequest {
  repoOwner: string;
  repoName: string;
  notes?: string;
}

/**
 * POST /api/cache
 * Add a repo to the cache list (mark it for caching).
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as AddCacheRequest;
    const { repoOwner, repoName, notes } = body;

    if (!repoOwner || !repoName) {
      return NextResponse.json(
        { error: "repoOwner and repoName are required" },
        { status: 400 }
      );
    }

    const id = addCachedRepo(repoOwner, repoName, notes || null);

    return NextResponse.json({
      success: true,
      message: `Added ${repoOwner}/${repoName} to cache list`,
      id,
    });
  } catch (error) {
    console.error("Error adding to cache list:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

interface RemoveCacheRequest {
  repoOwner: string;
  repoName: string;
  deleteFromDisk?: boolean;
}

/**
 * DELETE /api/cache
 * Remove a repo from the cache list and optionally delete from disk.
 */
export async function DELETE(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as RemoveCacheRequest;
    const { repoOwner, repoName, deleteFromDisk } = body;

    if (!repoOwner || !repoName) {
      return NextResponse.json(
        { error: "repoOwner and repoName are required" },
        { status: 400 }
      );
    }

    // Remove from cache list
    const removed = removeCachedRepo(repoOwner, repoName);

    // Optionally delete from disk
    let deletedFromDisk = false;
    if (deleteFromDisk) {
      // Repos are stored as reposDir/owner/repo
      const repoPath = path.resolve(config.reposDir, repoOwner, repoName);
      // Validate path stays within reposDir to prevent path traversal
      if (!repoPath.startsWith(path.resolve(config.reposDir) + path.sep)) {
        return NextResponse.json({ error: "Invalid repository name" }, { status: 400 });
      }
      if (fs.existsSync(repoPath)) {
        fs.rmSync(repoPath, { recursive: true, force: true });
        deletedFromDisk = true;
      }
    }

    return NextResponse.json({
      success: true,
      message: `Removed ${repoOwner}/${repoName} from cache list`,
      removedFromList: removed,
      deletedFromDisk,
    });
  } catch (error) {
    console.error("Error removing from cache:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
