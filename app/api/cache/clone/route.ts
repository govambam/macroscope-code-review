import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { config } from "@/lib/config";
import { addCachedRepo, isRepoCached } from "@/lib/services/database";
import fs from "fs";
import path from "path";
import simpleGit from "simple-git";

// Mutex locks for repo cloning (prevents concurrent clones of same repo)
const repoLocks = new Map<string, Promise<void>>();

// Global semaphore to limit total concurrent clone operations across all repos
const MAX_CONCURRENT_CLONES = 3;
let activeClones = 0;
const cloneQueue: Array<() => void> = [];

async function acquireGlobalCloneSemaphore(): Promise<() => void> {
  if (activeClones < MAX_CONCURRENT_CLONES) {
    activeClones++;
    return () => {
      activeClones--;
      // Wake up next waiting clone if any
      const next = cloneQueue.shift();
      if (next) next();
    };
  }

  // Wait in queue for a slot
  await new Promise<void>((resolve) => {
    cloneQueue.push(resolve);
  });

  activeClones++;
  return () => {
    activeClones--;
    const next = cloneQueue.shift();
    if (next) next();
  };
}

async function acquireRepoLock(owner: string, repo: string): Promise<() => void> {
  const key = `${owner}/${repo}`;

  // Wait for any existing lock
  while (repoLocks.has(key)) {
    await repoLocks.get(key);
  }

  // Create new lock
  let releaseLock: () => void;
  const lockPromise = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });
  repoLocks.set(key, lockPromise);

  return () => {
    repoLocks.delete(key);
    releaseLock!();
  };
}

function getRepoCachePath(owner: string, repo: string): string {
  return path.join(config.reposDir, owner, repo);
}

function isRepoClonedLocally(owner: string, repo: string): boolean {
  const repoPath = getRepoCachePath(owner, repo);
  return fs.existsSync(path.join(repoPath, ".git"));
}

interface CloneCacheRequest {
  repoOwner: string;
  repoName: string;
}

/**
 * POST /api/cache/clone
 * Clone a repo into the cache. If already cached, updates it.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as CloneCacheRequest;
    const { repoOwner, repoName } = body;

    if (!repoOwner || !repoName || typeof repoOwner !== "string" || typeof repoName !== "string") {
      return NextResponse.json(
        { error: "repoOwner and repoName are required and must be strings" },
        { status: 400 }
      );
    }

    // Validate inputs don't contain path traversal characters
    if (
      repoOwner.includes("/") ||
      repoOwner.includes("\\") ||
      repoOwner === "." ||
      repoOwner === ".." ||
      repoName.includes("/") ||
      repoName.includes("\\") ||
      repoName === "." ||
      repoName === ".."
    ) {
      return NextResponse.json({ error: "Invalid repository name" }, { status: 400 });
    }

    const githubToken = config.githubToken;
    if (!githubToken) {
      return NextResponse.json(
        { error: "GitHub token not configured" },
        { status: 500 }
      );
    }

    const repoPath = getRepoCachePath(repoOwner, repoName);
    const cloneUrl = `https://x-access-token:${githubToken}@github.com/${repoOwner}/${repoName}.git`;

    // Acquire lock to prevent race conditions
    const releaseLock = await acquireRepoLock(repoOwner, repoName);

    // Acquire global semaphore to limit concurrent clones across all repos
    const releaseGlobalSemaphore = await acquireGlobalCloneSemaphore();

    try {
      // Add to cache list in database
      addCachedRepo(repoOwner, repoName, null);

      if (isRepoClonedLocally(repoOwner, repoName)) {
        // Repo already exists - update it
        console.log(`[CACHE CLONE] Updating existing cache for ${repoOwner}/${repoName}`);
        const git = simpleGit(repoPath);
        // Update remote URL in case token was rotated
        await git.remote(["set-url", "origin", cloneUrl]);
        await git.fetch(["--all", "--tags", "--prune"]);

        return NextResponse.json({
          success: true,
          message: `Updated cache for ${repoOwner}/${repoName}`,
          action: "updated",
        });
      } else {
        // Clone the repo
        console.log(`[CACHE CLONE] Cloning ${repoOwner}/${repoName} to cache`);

        // Ensure owner directory exists
        const ownerDir = path.join(config.reposDir, repoOwner);
        if (!fs.existsSync(ownerDir)) {
          fs.mkdirSync(ownerDir, { recursive: true });
        }

        // Clean up any leftover directory from failed previous clone
        if (fs.existsSync(repoPath)) {
          fs.rmSync(repoPath, { recursive: true, force: true });
        }

        const git = simpleGit();
        try {
          await git.clone(cloneUrl, repoPath, ["--no-single-branch"]);
        } catch (error) {
          // Clean up partial clone on failure
          if (fs.existsSync(repoPath)) {
            fs.rmSync(repoPath, { recursive: true, force: true });
          }
          throw error;
        }

        return NextResponse.json({
          success: true,
          message: `Cloned ${repoOwner}/${repoName} to cache`,
          action: "cloned",
        });
      }
    } finally {
      releaseGlobalSemaphore();
      releaseLock();
    }
  } catch (error) {
    console.error("Error cloning to cache:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
