import { NextRequest } from "next/server";
import simpleGit, { SimpleGit } from "simple-git";
import { Octokit } from "@octokit/rest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { config, GITHUB_ORG, GITHUB_BOT_NAME, GITHUB_BOT_EMAIL } from "@/lib/config";
import { saveFork, savePR, getFork, getPR, isRepoCached as shouldCacheRepo, addCachedRepo } from "@/lib/services/database";

// Cache directory for reference repositories (speeds up cloning)
// Uses config for environment-aware paths (local vs Railway)
const REPOS_CACHE_DIR = config.reposDir;

// Ensure cache directory exists
if (!fs.existsSync(REPOS_CACHE_DIR)) {
  fs.mkdirSync(REPOS_CACHE_DIR, { recursive: true });
}

// In-memory mutex map to prevent race conditions when cloning/updating repos
// Key: "owner/repo", Value: Promise that resolves when the lock is released
const repoLocks = new Map<string, Promise<void>>();

/**
 * Acquire a lock for the given repository. Returns a release function.
 * Only one request can hold the lock for a given owner/repo at a time.
 */
async function acquireRepoLock(owner: string, repo: string): Promise<() => void> {
  const key = `${owner}/${repo}`;
  
  // Wait for any existing lock to be released
  while (repoLocks.has(key)) {
    await repoLocks.get(key);
  }
  
  // Create a new lock with a resolver we can call to release it
  let releaseLock: () => void;
  const lockPromise = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });
  
  repoLocks.set(key, lockPromise);
  
  // Return a release function that removes the lock from the map and resolves the promise
  return () => {
    repoLocks.delete(key);
    releaseLock!();
  };
}

// Response type for the API
interface ApiResponse {
  success: boolean;
  prUrl?: string;
  message: string;
  commitHash?: string;
  forkUrl?: string;
  error?: string;
  commitCount?: number;
  originalPrNumber?: number;
  prTitle?: string;
}

// Commit info from PR
interface PrCommitInfo {
  sha: string;
  message: string;
  isMergeCommit: boolean;
}

// Status message types
type StatusType = "info" | "success" | "error" | "progress";

interface StatusMessage {
  type: StatusType;
  step?: number;
  totalSteps?: number;
  message: string;
}

// Parse GitHub repo URL to extract owner and repo name
function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
  const match = url.match(/^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/?$/);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

// Parse GitHub PR URL to extract owner, repo, and PR number
function parsePrUrl(url: string): { owner: string; repo: string; prNumber: number } | null {
  const match = url.match(/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/);
  if (!match) return null;
  return { owner: match[1], repo: match[2], prNumber: parseInt(match[3], 10) };
}

// Generate a short hash for branch naming
function getShortHash(hash: string): string {
  return hash.substring(0, 7);
}

// Clean up temporary directory
async function cleanup(tmpDir: string): Promise<void> {
  try {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  } catch {
    // Silently ignore cleanup errors
  }
}

/**
 * Get the path where a reference repo should be cached
 */
function getRepoCachePath(owner: string, repo: string): string {
  // Prevent path traversal attacks
  if (owner.includes('..') || owner.includes('/') || owner.includes('\\') ||
      repo.includes('..') || repo.includes('/') || repo.includes('\\')) {
    throw new Error('Invalid owner or repo name');
  }
  return path.join(REPOS_CACHE_DIR, owner, repo);
}

/**
 * Check if a reference repo exists on disk in the cache directory
 */
function isRepoClonedLocally(owner: string, repo: string): boolean {
  const repoPath = getRepoCachePath(owner, repo);
  return fs.existsSync(path.join(repoPath, ".git"));
}

/**
 * Progress callback for git operations
 */
type ProgressCallback = (stage: string, progress: number, total: number) => void;

/**
 * Ensure reference repo exists and is up-to-date in the cache.
 * This is used to speed up subsequent clones via --reference.
 * Uses a mutex lock to prevent race conditions when multiple requests
 * try to clone/update the same repository simultaneously.
 *
 * Returns true if caching was performed, false if caching was skipped.
 */
async function ensureReferenceRepo(
  owner: string,
  repo: string,
  githubToken: string,
  onProgress?: ProgressCallback
): Promise<boolean> {
  // Check if this repo should be cached (selective caching)
  // Use the original repo owner/name for the cache check, not the fork owner
  if (!shouldCacheRepo(owner, repo)) {
    console.log(`[GIT CACHE] Skip: ${owner}/${repo} not in cache list`);
    return false;
  }

  const repoPath = getRepoCachePath(owner, repo);
  const cloneUrl = `https://x-access-token:${githubToken}@github.com/${owner}/${repo}.git`;

  // Acquire lock to prevent race conditions
  const releaseLock = await acquireRepoLock(owner, repo);

  try {
    if (isRepoClonedLocally(owner, repo)) {
      // Reference repo exists - update it
      console.log(`[GIT CACHE] Hit: Updating reference repo ${owner}/${repo}`);
      const git = simpleGit(repoPath);
      await git.fetch(["--all", "--tags", "--prune"]);
    } else {
      // Reference repo doesn't exist - clone it
      console.log(`[GIT CACHE] Miss: Cloning reference repo ${owner}/${repo}`);

      // Ensure owner directory exists
      const ownerDir = path.join(REPOS_CACHE_DIR, owner);
      if (!fs.existsSync(ownerDir)) {
        fs.mkdirSync(ownerDir, { recursive: true });
      }

      // Clone the repo with progress reporting
      const git = simpleGit({ progress: (data) => {
        if (onProgress && data.total > 0) {
          onProgress(data.stage, data.processed, data.total);
        }
      }});
      try {
        await git.clone(cloneUrl, repoPath, ["--no-single-branch", "--progress"]);
      } catch (error) {
        // Clean up partial clone on failure
        if (fs.existsSync(repoPath)) {
          fs.rmSync(repoPath, { recursive: true, force: true });
        }
        throw error;
      }
    }
    return true;
  } finally {
    // Always release the lock, even if an error occurred
    releaseLock();
  }
}

/**
 * Clone repo to an isolated temp directory for working.
 * Uses --reference to the cached repo for faster cloning if available.
 * Each request gets its own temp directory (Bug 2 fix: no race conditions).
 */
async function cloneToWorkDir(
  owner: string,
  repo: string,
  githubToken: string,
  onProgress?: ProgressCallback
): Promise<string> {
  const cloneUrl = `https://x-access-token:${githubToken}@github.com/${owner}/${repo}.git`;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "macroscope-"));

  try {
    const git = simpleGit({ progress: (data) => {
      if (onProgress && data.total > 0) {
        onProgress(data.stage, data.processed, data.total);
      }
    }});

    // Check if we have a reference repo for faster cloning
    if (isRepoClonedLocally(owner, repo)) {
      const refPath = getRepoCachePath(owner, repo);
      console.log(`[GIT CACHE] Fast clone using reference repo`);
      await git.clone(cloneUrl, tmpDir, ["--no-single-branch", "--reference", refPath, "--progress"]);
    } else {
      // No reference repo, do regular clone
      console.log(`[GIT CACHE] Regular clone (no reference repo available)`);
      await git.clone(cloneUrl, tmpDir, ["--no-single-branch", "--progress"]);
    }

    return tmpDir;
  } catch (error) {
    // Clean up temp dir on failure
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    throw error;
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  // Create a streaming response using SSE
  const encoder = new TextEncoder();
  let tmpDir: string | null = null;
  let streamClosed = false;

  const stream = new ReadableStream({
    async start(controller) {
      // Helper to send status updates
      const sendStatus = (status: StatusMessage) => {
        if (streamClosed) return;
        const data = JSON.stringify({
          eventType: "status",
          statusType: status.type,
          step: status.step,
          totalSteps: status.totalSteps,
          message: status.message,
        });
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      };

      // Helper to send the final result
      const sendResult = (result: ApiResponse) => {
        if (streamClosed) return;
        const data = JSON.stringify({ eventType: "result", ...result });
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        streamClosed = true;
        controller.close();
      };

      // Helper to send error and close
      const sendError = (message: string, error: string, status?: number) => {
        if (streamClosed) return;
        sendStatus({ type: "error", message: error });
        sendResult({ success: false, message, error });
      };

      try {
        // Get session for createdBy tracking
        const session = await getServerSession(authOptions);

        // Step 1: Validate configuration
        sendStatus({ type: "info", step: 1, totalSteps: 10, message: "Checking GitHub configuration..." });

        const githubToken = config.githubToken;
        if (!githubToken) {
          sendError("GitHub token not configured", "GITHUB_BOT_TOKEN environment variable is not set");
          return;
        }

        // Parse request body
        const body = await request.json();
        const { repoUrl, commitHash: specifiedCommitHash, prUrl: inputPrUrl, cacheRepo } = body;

        // Initialize Octokit with bot token
        const octokit = new Octokit({ auth: githubToken });

        // Use organization as fork destination (not personal account)
        const forkOwner = GITHUB_ORG;
        sendStatus({ type: "info", step: 1, totalSteps: 10, message: `Using organization: ${forkOwner}` });
        sendStatus({ type: "success", message: `Fork destination: ${forkOwner}` });

        // Determine which mode we're in
        if (inputPrUrl) {
          // ========================================
          // PR URL MODE - Recreate an existing PR
          // ========================================

          // Step 2: Parse and fetch PR
          sendStatus({ type: "info", step: 2, totalSteps: 10, message: "Parsing PR URL..." });

          const parsedPr = parsePrUrl(inputPrUrl);
          if (!parsedPr) {
            sendError("Invalid PR URL format", "Expected format: https://github.com/owner/repo/pull/123");
            return;
          }

          const { owner: upstreamOwner, repo: repoName, prNumber } = parsedPr;
          sendStatus({ type: "info", step: 2, totalSteps: 10, message: `Fetching PR #${prNumber} from ${upstreamOwner}/${repoName}...` });

          let prData;
          try {
            const { data } = await octokit.pulls.get({
              owner: upstreamOwner,
              repo: repoName,
              pull_number: prNumber,
            });
            prData = data;
          } catch (prError) {
            const errorMessage = prError instanceof Error ? prError.message : String(prError);
            if (errorMessage.includes("Not Found")) {
              sendError("PR not found", `Pull request #${prNumber} does not exist or is not accessible in ${upstreamOwner}/${repoName}`);
              return;
            }
            throw prError;
          }

          const prTitle = prData.title;
          const prAuthor = prData.user?.login || "unknown";
          const prState = prData.state;
          const prMerged = prData.merged;
          const mergeCommitSha = prData.merge_commit_sha;

          sendStatus({ type: "success", message: `Found PR: "${prTitle}" by @${prAuthor}` });
          sendStatus({ type: "info", message: `Status: ${prState}${prMerged ? " (merged)" : " (open)"}` });

          // STRATEGY SELECTION:
          // We prefer "direct head" strategies over cherry-picking because they:
          // 1. Preserve the exact state of the PR (including any rebases/fixups)
          // 2. Don't fail due to merge conflicts
          // 3. Work regardless of the PR's commit history complexity
          //
          // Strategy priority:
          // 1. MERGED PRs: Use merge commit parents (exact state at merge time)
          // 2. OPEN PRs: Fetch PR head ref directly (exact current state)
          // 3. FALLBACK: Cherry-pick commits (only if direct fetch fails)

          let useDirectStrategy = false;
          let directBaseCommit: string | null = null;
          let directHeadCommit: string | null = null;
          let strategyName: string = "cherry-pick";

          if (prMerged && mergeCommitSha) {
            // MERGED PR: Use merge commit parent strategy
            sendStatus({ type: "info", step: 3, totalSteps: 10, message: "PR is merged, checking merge type..." });

            try {
              const { data: mergeCommitData } = await octokit.repos.getCommit({
                owner: upstreamOwner,
                repo: repoName,
                ref: mergeCommitSha,
              });

              if (mergeCommitData.parents && mergeCommitData.parents.length >= 2) {
                // Standard merge commit - Parent 0 = base branch, Parent 1 = PR head
                directBaseCommit = mergeCommitData.parents[0].sha;
                directHeadCommit = mergeCommitData.parents[1].sha;
                useDirectStrategy = true;
                strategyName = "merge-commit";
                sendStatus({ type: "success", message: `Standard merge: base=${getShortHash(directBaseCommit)}, head=${getShortHash(directHeadCommit)}` });
              } else if (mergeCommitData.parents && mergeCommitData.parents.length === 1) {
                // Squash or rebase merge - single parent, the commit itself contains all changes
                directBaseCommit = mergeCommitData.parents[0].sha;
                directHeadCommit = mergeCommitSha;
                useDirectStrategy = true;
                strategyName = "squash-merge";
                sendStatus({ type: "success", message: `Squash/rebase merge: base=${getShortHash(directBaseCommit)}, head=${getShortHash(directHeadCommit)}` });
              } else {
                sendStatus({ type: "info", message: "Merge commit has no parents, will try PR head fetch" });
              }
            } catch (mergeErr) {
              sendStatus({ type: "info", message: "Could not fetch merge commit, will try PR head fetch" });
            }
          }

          // For OPEN PRs (or if merged strategy failed), try fetching PR head directly
          // This uses GitHub's special refs: pull/{number}/head
          if (!useDirectStrategy) {
            sendStatus({ type: "info", step: 3, totalSteps: 10, message: "Preparing to fetch PR head directly..." });

            // We'll use the PR's head SHA and base SHA from the API
            // The head SHA is the current tip of the PR branch
            const prHeadSha = prData.head.sha;
            const prBaseSha = prData.base.sha;

            if (prHeadSha && prBaseSha) {
              directBaseCommit = prBaseSha;
              directHeadCommit = prHeadSha;
              useDirectStrategy = true;
              strategyName = "pr-head-fetch";
              sendStatus({ type: "success", message: `Will fetch PR head directly: base=${getShortHash(directBaseCommit)}, head=${getShortHash(directHeadCommit)}` });
            } else {
              sendStatus({ type: "info", message: "Could not determine PR head/base, falling back to cherry-pick" });
            }
          }

          // Step 3: Fetch PR commits (needed for cherry-pick strategy or for commit count info)
          sendStatus({ type: "info", step: 3, totalSteps: 10, message: "Fetching commits from PR..." });

          const { data: prCommitsList } = await octokit.pulls.listCommits({
            owner: upstreamOwner,
            repo: repoName,
            pull_number: prNumber,
            per_page: 100,
          });

          const prCommits: PrCommitInfo[] = prCommitsList.map(c => ({
            sha: c.sha,
            message: c.commit.message.split("\n")[0],
            isMergeCommit: (c.parents?.length || 0) > 1,
          }));

          sendStatus({ type: "success", message: `Found ${prCommits.length} commit(s) in PR` });

          // Filter out merge commits from the list
          const mergeCommitCount = prCommits.filter(c => c.isMergeCommit).length;
          const commitsToApply = prCommits.filter(c => !c.isMergeCommit);
          const regularCommitCount = commitsToApply.length;

          // Variables for cherry-pick fallback (only used if direct strategies fail)
          let cherryPickBaseCommit: string = "";

          if (!useDirectStrategy) {
            // FALLBACK: Determine the true base commit for cherry-pick strategy
            sendStatus({ type: "info", step: 4, totalSteps: 10, message: "Finding original base commit for cherry-pick fallback..." });

            if (prCommitsList.length > 0) {
              const firstPrCommitSha = prCommitsList[0].sha;
              try {
                const { data: firstCommitData } = await octokit.repos.getCommit({
                  owner: upstreamOwner,
                  repo: repoName,
                  ref: firstPrCommitSha,
                });

                if (firstCommitData.parents && firstCommitData.parents.length > 0) {
                  cherryPickBaseCommit = firstCommitData.parents[0].sha;
                  sendStatus({ type: "success", message: `Using true PR base commit (${getShortHash(cherryPickBaseCommit)})` });
                } else {
                  cherryPickBaseCommit = prData.base.sha;
                  sendStatus({ type: "info", message: `Using PR base ref (${getShortHash(cherryPickBaseCommit)})` });
                }
              } catch {
                cherryPickBaseCommit = prData.base.sha;
                sendStatus({ type: "info", message: `Using PR base ref (${getShortHash(cherryPickBaseCommit)})` });
              }
            } else {
              cherryPickBaseCommit = prData.base.sha;
              sendStatus({ type: "info", message: `Using PR base ref (${getShortHash(cherryPickBaseCommit)})` });
            }

            if (mergeCommitCount > 0) {
              sendStatus({ type: "info", message: `${mergeCommitCount} merge commit(s) will be skipped, ${regularCommitCount} commit(s) to apply` });
            }

            if (regularCommitCount === 0) {
              sendError("No commits to apply", "All commits in this PR are merge commits. Nothing to recreate.");
              return;
            }
          } else {
            sendStatus({ type: "info", step: 4, totalSteps: 10, message: `Using ${strategyName} strategy (no cherry-pick needed)` });
          }

          // Step 5: Check fork exists (DB-first, then GitHub API fallback)
          sendStatus({ type: "info", step: 5, totalSteps: 10, message: "Checking for existing fork..." });

          let forkUrl: string;

          // Check database first
          const dbFork = getFork(forkOwner, repoName);
          if (dbFork) {
            console.log(`[CACHE HIT] Fork ${forkOwner}/${repoName} found in database`);
            forkUrl = dbFork.fork_url;
            sendStatus({ type: "success", message: "Fork found (from database)" });
          } else {
            // Database miss - check GitHub API
            console.log(`[CACHE MISS] Fork ${forkOwner}/${repoName} not in database, checking GitHub`);
            try {
              await octokit.repos.get({
                owner: forkOwner,
                repo: repoName,
              });
              forkUrl = `https://github.com/${forkOwner}/${repoName}`;
              console.log(`[CACHE SAVE] Saving fork ${forkOwner}/${repoName} to database`);
              saveFork(forkOwner, repoName, forkUrl);
              sendStatus({ type: "success", message: "Fork found on GitHub" });
            } catch {
              // Fork does not exist - require manual creation
              console.log(`[FORK REQUIRED] Fork ${forkOwner}/${repoName} does not exist`);
              sendError(
                "Fork required",
                `No fork found for ${upstreamOwner}/${repoName} in ${forkOwner}. Please create a fork manually at https://github.com/${upstreamOwner}/${repoName}/fork and select "${forkOwner}" as the owner, then try again.`
              );
              return;
            }
          }

          // Step 6: Skip (fork settings are now managed manually)
          sendStatus({ type: "info", step: 6, totalSteps: 10, message: "Fork verified, continuing..." });
          sendStatus({ type: "success", message: "Fork configuration verified" });

          // Check for existing PR (DB-first, then GitHub API fallback)
          const branchName = `review-pr-${prNumber}`;

          // Check database first for existing PR
          const existingDbFork = dbFork || getFork(forkOwner, repoName);
          if (existingDbFork) {
            const existingDbPR = getPR(existingDbFork.id, prNumber);
            if (existingDbPR && existingDbPR.state === "open") {
              console.log(`[CACHE HIT] Existing PR #${prNumber} found in database`);
              sendStatus({ type: "success", message: "Found existing PR for this review (from database)" });
              sendResult({
                success: true,
                message: `A PR already exists for PR #${prNumber}`,
                prUrl: existingDbPR.forked_pr_url,
                forkUrl,
                commitCount: regularCommitCount,
                originalPrNumber: prNumber,
                prTitle: existingDbPR.pr_title ?? undefined,
              });
              return;
            }
          }

          // Database miss - check GitHub API
          console.log(`[CACHE MISS] No existing open PR for review-pr-${prNumber} in database, checking GitHub`);
          try {
            const { data: existingPRs } = await octokit.pulls.list({
              owner: forkOwner,
              repo: repoName,
              state: "open",
              head: `${forkOwner}:${branchName}`,
            });

            if (existingPRs.length > 0) {
              sendStatus({ type: "success", message: "Found existing PR for this review" });
              sendResult({
                success: true,
                message: `A PR already exists for PR #${prNumber}`,
                prUrl: existingPRs[0].html_url,
                forkUrl,
                commitCount: regularCommitCount,
                originalPrNumber: prNumber,
                prTitle: existingPRs[0].title,
              });
              return;
            }
          } catch {
            // Continue
          }

          // Step 7: Clone repository (using cache for speed if available)
          // If user requested caching, add to cache list before cloning
          if (cacheRepo) {
            addCachedRepo(forkOwner, repoName, `Upstream: ${upstreamOwner}/${repoName}`);
            sendStatus({ type: "info", step: 7, totalSteps: 10, message: `Added ${forkOwner}/${repoName} to cache list` });
          }

          const wasClonedLocally = isRepoClonedLocally(forkOwner, repoName);
          const willCache = cacheRepo || shouldCacheRepo(forkOwner, repoName);

          if (wasClonedLocally) {
            sendStatus({ type: "info", step: 7, totalSteps: 10, message: "Preparing repository (using cache)..." });
          } else if (willCache) {
            sendStatus({ type: "info", step: 7, totalSteps: 10, message: "Cloning and caching repository (this may take several minutes for large repos)..." });
          } else {
            sendStatus({ type: "info", step: 7, totalSteps: 10, message: "Cloning repository..." });
          }

          // Track last progress update to avoid flooding
          let lastProgressUpdate = 0;
          const progressCallback = (stage: string, processed: number, total: number) => {
            const now = Date.now();
            // Only send updates every 2 seconds to avoid flooding
            if (now - lastProgressUpdate > 2000) {
              const percent = Math.round((processed / total) * 100);
              const stageLabel = stage === 'receiving' ? 'Receiving objects' :
                                stage === 'resolving' ? 'Resolving deltas' :
                                stage === 'counting' ? 'Counting objects' :
                                stage === 'compressing' ? 'Compressing objects' : stage;
              sendStatus({ type: "info", step: 7, totalSteps: 10, message: `${stageLabel}: ${percent}% (${processed}/${total})` });
              lastProgressUpdate = now;
            }
          };

          // Ensure reference repo is up-to-date if this repo is in the cache list
          const didCache = await ensureReferenceRepo(forkOwner, repoName, githubToken, progressCallback);

          // Clone to isolated working directory (no race conditions)
          tmpDir = await cloneToWorkDir(forkOwner, repoName, githubToken, progressCallback);

          const usedCache = wasClonedLocally || didCache;
          sendStatus({ type: "success", message: usedCache ? "Repository ready (fast clone from cache)" : "Repository cloned successfully" });

          const repoGit = simpleGit(tmpDir);
          await repoGit.addConfig("user.email", GITHUB_BOT_EMAIL);
          await repoGit.addConfig("user.name", GITHUB_BOT_NAME);

          // Add upstream remote and fetch
          sendStatus({ type: "info", step: 7, totalSteps: 10, message: "Fetching commits from upstream repository..." });

          const upstreamCloneUrl = `https://github.com/${upstreamOwner}/${repoName}.git`;
          // Add upstream remote (fresh clone, so no need for set-url fallback)
          await repoGit.addRemote("upstream", upstreamCloneUrl);
          await repoGit.fetch(["upstream", "--no-tags"]);

          // Fetch commits needed for the selected strategy
          if (useDirectStrategy && directBaseCommit && directHeadCommit) {
            // For direct strategy, fetch the base and head commits
            sendStatus({ type: "info", message: `Fetching commits for ${strategyName} strategy...` });

            // For PR head fetch strategy, also fetch the PR ref
            if (strategyName === "pr-head-fetch") {
              try {
                // Fetch the PR's head ref directly from upstream
                await repoGit.fetch(["upstream", `pull/${prNumber}/head:temp-pr-head`]);
                sendStatus({ type: "success", message: `Fetched PR #${prNumber} head ref` });
              } catch (prFetchErr) {
                sendStatus({ type: "info", message: `Could not fetch PR ref, trying commit SHA directly...` });
              }
            }

            // Fetch the specific commits
            for (const sha of [directBaseCommit, directHeadCommit]) {
              try {
                await repoGit.fetch(["upstream", sha]);
              } catch {
                // Ignore - commit might already be available
              }
            }
            sendStatus({ type: "success", message: "Commits fetched" });
          } else {
            // For cherry-pick fallback, fetch all needed commits
            sendStatus({ type: "info", message: "Fetching specific commits needed for cherry-pick..." });
            const commitsToFetch = [cherryPickBaseCommit, ...commitsToApply.map(c => c.sha)];
            for (const sha of commitsToFetch) {
              try {
                await repoGit.fetch(["upstream", sha]);
              } catch {
                // Ignore
              }
            }
            sendStatus({ type: "success", message: "All commits fetched" });
          }

          // Step 8: Create base branch and review branch
          const baseBranchName = `base-for-pr-${prNumber}`;

          if (useDirectStrategy && directBaseCommit && directHeadCommit) {
            // DIRECT STRATEGY: Use base and head commits directly (no cherry-pick needed)
            sendStatus({ type: "info", step: 8, totalSteps: 10, message: `Creating branches using ${strategyName} strategy...` });

            // Create base branch at the base commit
            try {
              await repoGit.checkout(["-b", baseBranchName, directBaseCommit]);
              sendStatus({ type: "success", message: `Base branch created at ${getShortHash(directBaseCommit)}` });
            } catch {
              try {
                await repoGit.checkout([baseBranchName]);
                await repoGit.reset(["--hard", directBaseCommit]);
                sendStatus({ type: "success", message: `Base branch reset to ${getShortHash(directBaseCommit)}` });
              } catch {
                await cleanup(tmpDir);
                sendError("Failed to create base branch", `Could not create branch at base ${getShortHash(directBaseCommit)}`);
                return;
              }
            }

            // Create review branch at the head commit (PR's final state)
            try {
              await repoGit.checkout(["-b", branchName, directHeadCommit]);
              sendStatus({ type: "success", message: `Review branch created at ${getShortHash(directHeadCommit)} (PR's current state)` });
            } catch {
              try {
                await repoGit.checkout([branchName]);
                await repoGit.reset(["--hard", directHeadCommit]);
                sendStatus({ type: "success", message: `Review branch reset to ${getShortHash(directHeadCommit)}` });
              } catch {
                await cleanup(tmpDir);
                sendError("Failed to create review branch", `Could not create branch at PR head ${getShortHash(directHeadCommit)}`);
                return;
              }
            }

            // Step 9: No cherry-pick needed for direct strategies
            sendStatus({ type: "info", step: 9, totalSteps: 10, message: `Branches created from ${strategyName} (no cherry-pick needed)` });
            sendStatus({ type: "success", message: `PR state preserved exactly` });

          } else {
            // CHERRY-PICK FALLBACK: For when direct strategies fail
            sendStatus({ type: "info", step: 8, totalSteps: 10, message: `Creating branches from base commit ${getShortHash(cherryPickBaseCommit)}...` });

            // First create the base branch at the base commit
            try {
              await repoGit.checkout(["-b", baseBranchName, cherryPickBaseCommit]);
              sendStatus({ type: "success", message: `Base branch created at ${getShortHash(cherryPickBaseCommit)}` });
            } catch {
              try {
                await repoGit.checkout([baseBranchName]);
                await repoGit.reset(["--hard", cherryPickBaseCommit]);
                sendStatus({ type: "success", message: `Base branch reset to ${getShortHash(cherryPickBaseCommit)}` });
              } catch {
                await cleanup(tmpDir);
                sendError("Failed to create base branch", `Could not create branch at base commit ${getShortHash(cherryPickBaseCommit)}`);
                return;
              }
            }

            // Now create the review branch from the same base
            try {
              await repoGit.checkout(["-b", branchName, cherryPickBaseCommit]);
              sendStatus({ type: "success", message: `Review branch created from commit ${getShortHash(cherryPickBaseCommit)}` });
            } catch {
              try {
                await repoGit.checkout([branchName]);
                await repoGit.reset(["--hard", cherryPickBaseCommit]);
                sendStatus({ type: "success", message: `Review branch reset to commit ${getShortHash(cherryPickBaseCommit)}` });
              } catch {
                await cleanup(tmpDir);
                sendError("Failed to create review branch", `Could not create branch from base commit ${getShortHash(cherryPickBaseCommit)}`);
                return;
              }
            }

            // Step 9: Cherry-pick commits
            sendStatus({ type: "info", step: 9, totalSteps: 10, message: `Cherry-picking ${commitsToApply.length} commit(s)...` });

            for (let i = 0; i < commitsToApply.length; i++) {
              const commit = commitsToApply[i];
              const shortMessage = commit.message.length > 50 ? commit.message.substring(0, 47) + "..." : commit.message;

              sendStatus({
                type: "progress",
                message: `Cherry-picking commit ${i + 1}/${commitsToApply.length}: ${getShortHash(commit.sha)} - "${shortMessage}"`,
              });

              try {
                await repoGit.raw(["cherry-pick", commit.sha]);
              } catch {
                sendStatus({ type: "info", message: `Fetching commit ${getShortHash(commit.sha)} from upstream...` });
                try {
                  await repoGit.raw(["fetch", "upstream", commit.sha]);
                  await repoGit.raw(["cherry-pick", commit.sha]);
                } catch {
                  try {
                    await repoGit.raw(["cherry-pick", "--abort"]);
                  } catch {
                    // Ignore
                  }
                  await cleanup(tmpDir);
                  sendError("Cherry-pick failed", `Failed to apply commit ${getShortHash(commit.sha)}: "${shortMessage}". This may be due to merge conflicts.`);
                  return;
                }
              }
            }

            sendStatus({ type: "success", message: `All ${commitsToApply.length} commit(s) applied successfully` });
          }

          // Step 10: Push and create PR
          sendStatus({ type: "info", step: 10, totalSteps: 10, message: "Pushing branches to GitHub..." });

          try {
            // Push the base branch first
            await repoGit.push(["origin", baseBranchName, "--force"]);
            // Then push the review branch
            await repoGit.push(["origin", branchName, "--force"]);
            sendStatus({ type: "success", message: "Branches pushed successfully" });
          } catch (pushError) {
            await cleanup(tmpDir);
            sendError("Failed to push branches", `Could not push to repository: ${pushError instanceof Error ? pushError.message : String(pushError)}`);
            return;
          }

          sendStatus({ type: "info", step: 10, totalSteps: 10, message: "Creating pull request..." });

          const newPrTitle = `[Review] ${prTitle}`;
          let newPrBody: string;

          if (useDirectStrategy && directBaseCommit && directHeadCommit) {
            // PR body for direct strategy (merge-commit, squash-merge, or pr-head-fetch)
            const strategyDescription = strategyName === "pr-head-fetch"
              ? "direct PR head fetch - exact current state preserved"
              : strategyName === "squash-merge"
              ? "squash merge commit - exact merged state preserved"
              : "merge commit parents - exact merged state preserved";

            newPrBody = `Recreated from ${inputPrUrl} for Macroscope review.

**Original PR:** #${prNumber} by @${prAuthor}
**Status:** ${prState}${prMerged ? " (merged)" : " (open)"}

*Recreated using ${strategyDescription}.*

**Original PR:** ${inputPrUrl}`;
          } else {
            // PR body for cherry-pick fallback
            const skippedNote = mergeCommitCount > 0 ? `\n\n*Note: ${mergeCommitCount} merge commit(s) were skipped during recreation.*` : "";
            newPrBody = `Recreated from ${inputPrUrl} for Macroscope review.

**Original PR:** #${prNumber} by @${prAuthor}
**Status:** ${prState}${prMerged ? " (merged)" : ""}

**Includes ${commitsToApply.length} commit(s):**
${commitsToApply.map(c => `- \`${c.sha.substring(0, 7)}\`: ${c.message}`).join("\n")}${skippedNote}

**Original PR:** ${inputPrUrl}`;
          }

          let newPrUrl: string;
          try {
            // Create PR from review branch to base branch (not main)
            // This ensures a clean diff without conflicts from merged commits
            const { data: pr } = await octokit.pulls.create({
              owner: forkOwner,
              repo: repoName,
              title: newPrTitle,
              body: newPrBody,
              head: branchName,
              base: baseBranchName,
            });
            newPrUrl = pr.html_url;
          } catch (prError) {
            const errorMessage = prError instanceof Error ? prError.message : String(prError);

            if (errorMessage.includes("A pull request already exists")) {
              const { data: existingPRs } = await octokit.pulls.list({
                owner: forkOwner,
                repo: repoName,
                state: "open",
                head: `${forkOwner}:${branchName}`,
              });

              if (existingPRs.length > 0) {
                await cleanup(tmpDir);

                // Save to database so it's immediately available
                try {
                  const forkId = saveFork(forkOwner, repoName, forkUrl);
                  savePR(
                    forkId,
                    existingPRs[0].number,
                    existingPRs[0].title,
                    existingPRs[0].html_url,
                    inputPrUrl,
                    false,
                    null,
                    {
                      originalPrTitle: prTitle,
                      state: existingPRs[0].state,
                      commitCount: commitsToApply.length,
                      createdBy: session?.user?.login || session?.user?.name || null,
                    }
                  );
                } catch (dbError) {
                  console.error("Failed to save PR to database:", dbError);
                }

                sendStatus({ type: "success", message: "Found existing PR" });
                sendResult({
                  success: true,
                  message: `A PR already exists for PR #${prNumber}`,
                  prUrl: existingPRs[0].html_url,
                  forkUrl,
                  commitCount: commitsToApply.length,
                  originalPrNumber: prNumber,
                  prTitle: existingPRs[0].title,
                });
                return;
              }
            }

            await cleanup(tmpDir);
            sendError("Failed to create PR", `GitHub API error: ${errorMessage}`);
            return;
          }

          await cleanup(tmpDir);

          // Save to database so it's immediately available
          // For direct strategy, use prCommits.length (all PR commits) since they're all included
          // For cherry-pick fallback, use commitsToApply.length (non-merge commits)
          const effectiveCommitCount = useDirectStrategy ? prCommits.length : commitsToApply.length;
          try {
            const newPrNumber = parseInt(newPrUrl.split("/").pop() || "0", 10);
            const forkId = saveFork(forkOwner, repoName, forkUrl);
            savePR(
              forkId,
              newPrNumber,
              newPrTitle,
              newPrUrl,
              inputPrUrl, // original PR URL
              false, // has bugs (unknown yet)
              null, // bug count
              {
                originalPrTitle: prTitle,
                state: "open",
                commitCount: effectiveCommitCount,
                createdBy: session?.user?.login || session?.user?.name || null,
              }
            );
          } catch (dbError) {
            console.error("Failed to save PR to database:", dbError);
            // Continue anyway, GitHub is the source of truth
          }

          sendStatus({ type: "success", message: "Pull request created successfully!" });

          // Build appropriate success message based on strategy used
          let successMessage: string;
          if (useDirectStrategy) {
            const strategyLabel = strategyName === "pr-head-fetch" ? "direct head fetch" :
                                  strategyName === "squash-merge" ? "squash merge" : "merge commit";
            successMessage = `PR recreated using ${strategyLabel} strategy - exact state from original PR #${prNumber} preserved`;
          } else {
            successMessage = `PR recreated with ${commitsToApply.length} commits from original PR #${prNumber}${mergeCommitCount > 0 ? ` (${mergeCommitCount} merge commits skipped)` : ""}`;
          }

          sendResult({
            success: true,
            message: successMessage,
            prUrl: newPrUrl,
            forkUrl,
            commitCount: effectiveCommitCount,
            originalPrNumber: prNumber,
            prTitle: `[Review] ${prTitle}`,
          });

        } else if (repoUrl) {
          // ========================================
          // COMMIT MODE - Existing logic (simplified status messages)
          // ========================================

          sendStatus({ type: "info", step: 2, totalSteps: 10, message: "Parsing repository URL..." });

          const parsed = parseGitHubUrl(repoUrl);
          if (!parsed) {
            sendError("Invalid GitHub URL format", "Expected format: https://github.com/owner/repo-name");
            return;
          }

          const { owner: upstreamOwner, repo: repoName } = parsed;
          sendStatus({ type: "success", message: `Repository: ${upstreamOwner}/${repoName}` });

          // Check fork exists (DB-first, then GitHub API fallback)
          sendStatus({ type: "info", step: 3, totalSteps: 10, message: "Checking for existing fork..." });

          let forkUrl: string;

          // Check database first
          const dbForkCommitMode = getFork(forkOwner, repoName);
          if (dbForkCommitMode) {
            console.log(`[CACHE HIT] Fork ${forkOwner}/${repoName} found in database`);
            forkUrl = dbForkCommitMode.fork_url;
            sendStatus({ type: "success", message: "Fork found (from database)" });
          } else {
            // Database miss - check GitHub API
            console.log(`[CACHE MISS] Fork ${forkOwner}/${repoName} not in database, checking GitHub`);
            try {
              await octokit.repos.get({
                owner: forkOwner,
                repo: repoName,
              });
              forkUrl = `https://github.com/${forkOwner}/${repoName}`;
              console.log(`[CACHE SAVE] Saving fork ${forkOwner}/${repoName} to database`);
              saveFork(forkOwner, repoName, forkUrl);
              sendStatus({ type: "success", message: "Fork found on GitHub" });
            } catch {
              // Fork does not exist - require manual creation
              console.log(`[FORK REQUIRED] Fork ${forkOwner}/${repoName} does not exist`);
              sendError(
                "Fork required",
                `No fork found for ${upstreamOwner}/${repoName} in ${forkOwner}. Please create a fork manually at https://github.com/${upstreamOwner}/${repoName}/fork and select "${forkOwner}" as the owner, then try again.`
              );
              return;
            }
          }

          // Step 4: Skip (fork settings are now managed manually)
          sendStatus({ type: "info", step: 4, totalSteps: 10, message: "Fork verified, continuing..." });
          sendStatus({ type: "success", message: "Fork configuration verified" });

          // Get target commit
          sendStatus({ type: "info", step: 5, totalSteps: 10, message: "Getting target commit..." });

          let targetCommit: string;

          if (specifiedCommitHash) {
            targetCommit = specifiedCommitHash;
            sendStatus({ type: "info", message: `Using specified commit: ${getShortHash(targetCommit)}` });

            try {
              await octokit.repos.getCommit({
                owner: forkOwner,
                repo: repoName,
                ref: targetCommit,
              });
            } catch {
              try {
                await octokit.repos.getCommit({
                  owner: upstreamOwner,
                  repo: repoName,
                  ref: targetCommit,
                });
              } catch {
                sendError("Commit not found", `The commit ${targetCommit} does not exist`);
                return;
              }
            }
          } else {
            sendStatus({ type: "info", message: "Getting latest commit from main branch..." });
            try {
              const { data: branch } = await octokit.repos.getBranch({
                owner: forkOwner,
                repo: repoName,
                branch: "main",
              });
              targetCommit = branch.commit.sha;
            } catch {
              try {
                const { data: branch } = await octokit.repos.getBranch({
                  owner: forkOwner,
                  repo: repoName,
                  branch: "master",
                });
                targetCommit = branch.commit.sha;
              } catch {
                sendError("Branch not found", "Could not find main or master branch");
                return;
              }
            }
          }

          sendStatus({ type: "success", message: `Target commit: ${getShortHash(targetCommit)}` });

          // Get commit details
          sendStatus({ type: "info", step: 6, totalSteps: 10, message: "Analyzing commit..." });

          let parentCommit: string;
          let isMergeCommit = false;
          let commitMessage: string;
          let prCommits: PrCommitInfo[] = [];
          let originalPrNumber: number | null = null;

          let commitData;
          try {
            const response = await octokit.repos.getCommit({
              owner: forkOwner,
              repo: repoName,
              ref: targetCommit,
            });
            commitData = response.data;
          } catch {
            try {
              const response = await octokit.repos.getCommit({
                owner: upstreamOwner,
                repo: repoName,
                ref: targetCommit,
              });
              commitData = response.data;
            } catch {
              sendError("Commit details unavailable", `Unable to fetch details for commit ${targetCommit}`);
              return;
            }
          }

          if (!commitData.parents || commitData.parents.length === 0) {
            sendError("Invalid commit", "The target commit has no parent (initial commit)");
            return;
          }

          parentCommit = commitData.parents[0].sha;
          isMergeCommit = commitData.parents.length > 1;
          commitMessage = commitData.commit.message.split("\n")[0];

          if (isMergeCommit) {
            sendStatus({ type: "info", message: "Merge commit detected, looking for associated PR..." });

            try {
              const { data: prs } = await octokit.repos.listPullRequestsAssociatedWithCommit({
                owner: upstreamOwner,
                repo: repoName,
                commit_sha: targetCommit,
              });

              if (prs.length > 0) {
                const mergedPr = prs.find(pr => pr.merge_commit_sha === targetCommit) || prs[0];
                originalPrNumber = mergedPr.number;
                sendStatus({ type: "success", message: `Found associated PR #${originalPrNumber}` });

                const { data: prCommitsList } = await octokit.pulls.listCommits({
                  owner: upstreamOwner,
                  repo: repoName,
                  pull_number: originalPrNumber,
                  per_page: 100,
                });

                if (prCommitsList.length > 0) {
                  prCommits = prCommitsList.map(c => ({
                    sha: c.sha,
                    message: c.commit.message.split("\n")[0],
                    isMergeCommit: (c.parents?.length || 0) > 1,
                  }));

                  const firstCommitSha = prCommits[0].sha;
                  try {
                    const { data: firstCommitData } = await octokit.repos.getCommit({
                      owner: upstreamOwner,
                      repo: repoName,
                      ref: firstCommitSha,
                    });
                    if (firstCommitData.parents && firstCommitData.parents.length > 0) {
                      parentCommit = firstCommitData.parents[0].sha;
                    }
                  } catch {
                    // Keep original parent
                  }

                  sendStatus({ type: "info", message: `Including ${prCommits.length} commits from PR` });
                }
              } else {
                sendStatus({ type: "info", message: "No associated PR found, using single commit" });
              }
            } catch {
              sendStatus({ type: "info", message: "PR detection failed, using single commit" });
            }
          } else {
            sendStatus({ type: "info", message: "Single commit detected" });
          }

          const shortHash = getShortHash(targetCommit);
          const branchName = `review-${shortHash}`;

          // Check existing PR (commit mode uses dynamic branch names, so GitHub API is needed)
          console.log(`[CACHE MISS] Commit mode: checking GitHub for existing PR on branch ${branchName}`);
          try {
            const { data: existingPRs } = await octokit.pulls.list({
              owner: forkOwner,
              repo: repoName,
              state: "open",
              head: `${forkOwner}:${branchName}`,
            });

            if (existingPRs.length > 0) {
              sendStatus({ type: "success", message: "Found existing PR" });
              sendResult({
                success: true,
                message: "A PR already exists for this commit",
                prUrl: existingPRs[0].html_url,
                commitHash: targetCommit,
                forkUrl,
                commitCount: prCommits.length || 1,
                originalPrNumber: originalPrNumber || undefined,
                prTitle: existingPRs[0].title,
              });
              return;
            }
          } catch {
            // Continue
          }

          // Clone repository (using cache for speed if available)
          // If user requested caching, add to cache list before cloning
          if (cacheRepo) {
            addCachedRepo(forkOwner, repoName, `Upstream: ${upstreamOwner}/${repoName}`);
            sendStatus({ type: "info", step: 7, totalSteps: 10, message: `Added ${forkOwner}/${repoName} to cache list` });
          }

          const wasClonedLocallyCommitMode = isRepoClonedLocally(forkOwner, repoName);
          const willCacheCommitMode = cacheRepo || shouldCacheRepo(forkOwner, repoName);

          if (wasClonedLocallyCommitMode) {
            sendStatus({ type: "info", step: 7, totalSteps: 10, message: "Preparing repository (using cache)..." });
          } else if (willCacheCommitMode) {
            sendStatus({ type: "info", step: 7, totalSteps: 10, message: "Cloning and caching repository (this may take several minutes for large repos)..." });
          } else {
            sendStatus({ type: "info", step: 7, totalSteps: 10, message: "Cloning repository..." });
          }

          // Track last progress update to avoid flooding
          let lastProgressUpdateCommitMode = 0;
          const progressCallbackCommitMode = (stage: string, processed: number, total: number) => {
            const now = Date.now();
            if (now - lastProgressUpdateCommitMode > 2000) {
              const percent = Math.round((processed / total) * 100);
              const stageLabel = stage === 'receiving' ? 'Receiving objects' :
                                stage === 'resolving' ? 'Resolving deltas' :
                                stage === 'counting' ? 'Counting objects' :
                                stage === 'compressing' ? 'Compressing objects' : stage;
              sendStatus({ type: "info", step: 7, totalSteps: 10, message: `${stageLabel}: ${percent}% (${processed}/${total})` });
              lastProgressUpdateCommitMode = now;
            }
          };

          // Ensure reference repo is up-to-date if this repo is in the cache list
          const didCacheCommitMode = await ensureReferenceRepo(forkOwner, repoName, githubToken, progressCallbackCommitMode);

          // Clone to isolated working directory (no race conditions)
          tmpDir = await cloneToWorkDir(forkOwner, repoName, githubToken, progressCallbackCommitMode);

          const usedCacheCommitMode = wasClonedLocallyCommitMode || didCacheCommitMode;
          sendStatus({ type: "success", message: usedCacheCommitMode ? "Repository ready (fast clone from cache)" : "Clone complete" });

          const repoGit = simpleGit(tmpDir);
          await repoGit.addConfig("user.email", GITHUB_BOT_EMAIL);
          await repoGit.addConfig("user.name", GITHUB_BOT_NAME);

          const upstreamCloneUrl = `https://github.com/${upstreamOwner}/${repoName}.git`;
          // Add upstream remote (fresh clone, so no need for set-url fallback)
          await repoGit.addRemote("upstream", upstreamCloneUrl);

          sendStatus({ type: "info", message: "Fetching commits..." });
          await repoGit.fetch(["--all"]);

          // Create branch
          sendStatus({ type: "info", step: 8, totalSteps: 10, message: `Creating branch: ${branchName}...` });

          try {
            await repoGit.checkout(["-b", branchName, parentCommit]);
          } catch {
            try {
              await repoGit.checkout([branchName]);
              await repoGit.reset(["--hard", parentCommit]);
            } catch {
              await cleanup(tmpDir);
              sendError("Failed to create branch", `Could not create branch from parent commit`);
              return;
            }
          }
          sendStatus({ type: "success", message: "Branch created" });

          // Cherry-pick
          sendStatus({ type: "info", step: 9, totalSteps: 10, message: "Applying commits..." });

          const commitsToApplyInCommitMode = prCommits.filter(c => !c.isMergeCommit);

          if (commitsToApplyInCommitMode.length > 1) {
            for (let i = 0; i < commitsToApplyInCommitMode.length; i++) {
              const commit = commitsToApplyInCommitMode[i];
              sendStatus({
                type: "progress",
                message: `Cherry-picking ${i + 1}/${commitsToApplyInCommitMode.length}: ${getShortHash(commit.sha)}`,
              });

              try {
                await repoGit.raw(["cherry-pick", commit.sha]);
              } catch {
                try {
                  await repoGit.raw(["cherry-pick", "--abort"]);
                } catch {
                  // Ignore
                }
                await cleanup(tmpDir);
                sendError("Cherry-pick failed", `Failed to apply commit ${getShortHash(commit.sha)}`);
                return;
              }
            }
          } else if (commitsToApplyInCommitMode.length === 1) {
            try {
              await repoGit.raw(["cherry-pick", commitsToApplyInCommitMode[0].sha]);
            } catch {
              try {
                await repoGit.raw(["cherry-pick", "--abort"]);
              } catch {
                // Ignore
              }
              await cleanup(tmpDir);
              sendError("Cherry-pick failed", "Could not apply commit");
              return;
            }
          } else {
            // No PR commits, cherry-pick target
            try {
              if (isMergeCommit) {
                await repoGit.raw(["cherry-pick", "-m", "1", targetCommit]);
              } else {
                await repoGit.raw(["cherry-pick", targetCommit]);
              }
            } catch {
              try {
                await repoGit.raw(["cherry-pick", "--abort"]);
              } catch {
                // Ignore
              }
              await cleanup(tmpDir);
              sendError("Cherry-pick failed", "Merge conflict or commit not accessible");
              return;
            }
          }

          sendStatus({ type: "success", message: "Commits applied" });

          // Push
          sendStatus({ type: "info", step: 10, totalSteps: 10, message: "Pushing to GitHub..." });

          try {
            await repoGit.push(["origin", branchName, "--force"]);
          } catch (pushError) {
            await cleanup(tmpDir);
            sendError("Push failed", `${pushError instanceof Error ? pushError.message : String(pushError)}`);
            return;
          }

          sendStatus({ type: "success", message: "Branch pushed" });

          // Create PR
          sendStatus({ type: "info", message: "Creating pull request..." });

          let prBody: string;
          let prTitle: string;

          if (commitsToApplyInCommitMode.length > 1 && originalPrNumber) {
            prTitle = commitMessage;
            prBody = `Recreated from PR #${originalPrNumber} for Macroscope review.

**Includes ${commitsToApplyInCommitMode.length} commits from the original PR:**
${commitsToApplyInCommitMode.map(c => `- \`${c.sha.substring(0, 7)}\`: ${c.message}`).join("\n")}

**Original upstream:** https://github.com/${upstreamOwner}/${repoName}/pull/${originalPrNumber}`;
          } else {
            prTitle = commitMessage;
            prBody = `Recreated from commit \`${shortHash}\` for Macroscope review.

**Original commit:** ${targetCommit}
**Parent commit:** ${parentCommit}
**Original upstream:** https://github.com/${upstreamOwner}/${repoName}
${isMergeCommit ? "\n**Note:** This was a merge commit, cherry-picked with `-m 1`." : ""}`;
          }

          let prUrl: string;
          try {
            const { data: pr } = await octokit.pulls.create({
              owner: forkOwner,
              repo: repoName,
              title: prTitle,
              body: prBody,
              head: branchName,
              base: "main",
            });
            prUrl = pr.html_url;
          } catch (prError) {
            const errorMessage = prError instanceof Error ? prError.message : String(prError);

            if (errorMessage.includes("A pull request already exists")) {
              const { data: existingPRs } = await octokit.pulls.list({
                owner: forkOwner,
                repo: repoName,
                state: "open",
                head: `${forkOwner}:${branchName}`,
              });

              if (existingPRs.length > 0) {
                await cleanup(tmpDir);

                // Save to database
                try {
                  const forkId = saveFork(forkOwner, repoName, forkUrl);
                  savePR(
                    forkId,
                    existingPRs[0].number,
                    existingPRs[0].title,
                    existingPRs[0].html_url,
                    null,
                    false,
                    null,
                    {
                      state: existingPRs[0].state,
                      commitCount: commitsToApplyInCommitMode.length || 1,
                      createdBy: session?.user?.login || session?.user?.name || null,
                    }
                  );
                } catch (dbError) {
                  console.error("Failed to save PR to database:", dbError);
                }

                sendResult({
                  success: true,
                  message: "A PR already exists for this commit",
                  prUrl: existingPRs[0].html_url,
                  commitHash: targetCommit,
                  forkUrl,
                  commitCount: commitsToApplyInCommitMode.length || 1,
                  originalPrNumber: originalPrNumber || undefined,
                  prTitle: existingPRs[0].title,
                });
                return;
              }
            }

            // Try master
            try {
              const { data: pr } = await octokit.pulls.create({
                owner: forkOwner,
                repo: repoName,
                title: prTitle,
                body: prBody,
                head: branchName,
                base: "master",
              });
              prUrl = pr.html_url;
            } catch {
              await cleanup(tmpDir);
              sendError("Failed to create PR", `GitHub API error: ${errorMessage}`);
              return;
            }
          }

          await cleanup(tmpDir);

          // Save to database so it's immediately available
          try {
            const newPrNumber = parseInt(prUrl.split("/").pop() || "0", 10);
            const forkId = saveFork(forkOwner, repoName, forkUrl);
            savePR(
              forkId,
              newPrNumber,
              prTitle,
              prUrl,
              null, // no original PR URL in commit mode
              false,
              null,
              {
                state: "open",
                commitCount: commitsToApplyInCommitMode.length || 1,
                createdBy: session?.user?.login || session?.user?.name || null,
              }
            );
          } catch (dbError) {
            console.error("Failed to save PR to database:", dbError);
          }

          let successMessage: string;
          if (commitsToApplyInCommitMode.length > 1 && originalPrNumber) {
            successMessage = `PR created with ${commitsToApplyInCommitMode.length} commits from original PR #${originalPrNumber}`;
          } else {
            successMessage = `PR created successfully`;
          }

          sendStatus({ type: "success", message: "Pull request created!" });
          sendResult({
            success: true,
            message: successMessage,
            prUrl,
            commitHash: targetCommit,
            forkUrl,
            commitCount: commitsToApplyInCommitMode.length || 1,
            originalPrNumber: originalPrNumber || undefined,
            prTitle,
          });

        } else {
          sendError("Missing required fields", "Either repoUrl or prUrl is required");
        }
      } catch (error) {
        if (tmpDir) {
          await cleanup(tmpDir);
        }
        const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
        sendError("An unexpected error occurred", errorMessage);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}
