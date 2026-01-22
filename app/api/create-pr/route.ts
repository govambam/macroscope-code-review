import { NextRequest } from "next/server";
import simpleGit, { SimpleGit } from "simple-git";
import { Octokit } from "@octokit/rest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Cache directory for reference repositories (speeds up cloning)
const REPOS_CACHE_DIR = path.join(process.cwd(), "data", "repos");

// Ensure cache directory exists
if (!fs.existsSync(REPOS_CACHE_DIR)) {
  fs.mkdirSync(REPOS_CACHE_DIR, { recursive: true });
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

// Wait for a specified number of milliseconds
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Get the path where a reference repo should be cached
 */
function getRepoCachePath(owner: string, repo: string): string {
  return path.join(REPOS_CACHE_DIR, owner, repo);
}

/**
 * Check if a reference repo exists in the cache
 */
function isRepoCached(owner: string, repo: string): boolean {
  const repoPath = getRepoCachePath(owner, repo);
  return fs.existsSync(path.join(repoPath, ".git"));
}

/**
 * Ensure reference repo exists and is up-to-date in the cache.
 * This is used to speed up subsequent clones via --reference.
 */
async function ensureReferenceRepo(
  owner: string,
  repo: string,
  githubToken: string
): Promise<void> {
  const repoPath = getRepoCachePath(owner, repo);
  const cloneUrl = `https://x-access-token:${githubToken}@github.com/${owner}/${repo}.git`;

  if (isRepoCached(owner, repo)) {
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

    // Clone the repo (Bug 1 fix: clean up on failure)
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
  }
}

/**
 * Clone repo to an isolated temp directory for working.
 * Uses --reference to the cached repo for faster cloning.
 * Each request gets its own temp directory (Bug 2 fix: no race conditions).
 */
async function cloneToWorkDir(
  owner: string,
  repo: string,
  githubToken: string
): Promise<string> {
  const cloneUrl = `https://x-access-token:${githubToken}@github.com/${owner}/${repo}.git`;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "macroscope-"));

  try {
    const git = simpleGit();

    // Check if we have a reference repo for faster cloning
    if (isRepoCached(owner, repo)) {
      const refPath = getRepoCachePath(owner, repo);
      console.log(`[GIT CACHE] Fast clone using reference repo`);
      await git.clone(cloneUrl, tmpDir, ["--no-single-branch", "--reference", refPath]);
    } else {
      // No reference repo, do regular clone
      console.log(`[GIT CACHE] Regular clone (no reference repo available)`);
      await git.clone(cloneUrl, tmpDir, ["--no-single-branch"]);
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
        // Step 1: Validate configuration
        sendStatus({ type: "info", step: 1, totalSteps: 10, message: "Checking GitHub configuration..." });

        const githubToken = process.env.GITHUB_TOKEN;
        if (!githubToken) {
          sendError("GitHub token not configured", "GITHUB_TOKEN environment variable is not set");
          return;
        }

        // Parse request body
        const body = await request.json();
        const { repoUrl, commitHash: specifiedCommitHash, prUrl: inputPrUrl } = body;

        // Initialize Octokit
        const octokit = new Octokit({ auth: githubToken });

        // Get authenticated user
        sendStatus({ type: "info", step: 1, totalSteps: 10, message: "Authenticating with GitHub..." });
        const { data: authenticatedUser } = await octokit.users.getAuthenticated();
        const forkOwner = authenticatedUser.login;
        sendStatus({ type: "success", message: `Authenticated as @${forkOwner}` });

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

          // Step 3: Fetch PR commits first (we need them to find the true base)
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

          // Step 4: Determine the true base commit
          // The correct base is the parent of the first commit in the PR
          // This ensures we're recreating the PR on the exact same base it was originally created from
          sendStatus({ type: "info", step: 4, totalSteps: 10, message: "Finding original base commit..." });

          let baseCommit: string;

          if (prCommitsList.length > 0) {
            const firstPrCommitSha = prCommitsList[0].sha;
            try {
              const { data: firstCommitData } = await octokit.repos.getCommit({
                owner: upstreamOwner,
                repo: repoName,
                ref: firstPrCommitSha,
              });

              if (firstCommitData.parents && firstCommitData.parents.length > 0) {
                baseCommit = firstCommitData.parents[0].sha;
                sendStatus({ type: "success", message: `Using true PR base commit (${getShortHash(baseCommit)})` });
              } else {
                baseCommit = prData.base.sha;
                sendStatus({ type: "info", message: `Using PR base ref (${getShortHash(baseCommit)})` });
              }
            } catch {
              baseCommit = prData.base.sha;
              sendStatus({ type: "info", message: `Using PR base ref (${getShortHash(baseCommit)})` });
            }
          } else {
            baseCommit = prData.base.sha;
            sendStatus({ type: "info", message: `Using PR base ref (${getShortHash(baseCommit)})` });
          }

          // Filter out merge commits from the list
          const mergeCommitCount = prCommits.filter(c => c.isMergeCommit).length;
          const commitsToApply = prCommits.filter(c => !c.isMergeCommit);
          const regularCommitCount = commitsToApply.length;

          if (mergeCommitCount > 0) {
            sendStatus({ type: "info", message: `${mergeCommitCount} merge commit(s) will be skipped, ${regularCommitCount} commit(s) to apply` });
          }

          if (regularCommitCount === 0) {
            sendError("No commits to apply", "All commits in this PR are merge commits. Nothing to recreate.");
            return;
          }

          // Step 5: Check/create fork
          sendStatus({ type: "info", step: 5, totalSteps: 10, message: "Checking for existing fork..." });

          let forkExists = false;
          let forkUrl: string;

          try {
            await octokit.repos.get({
              owner: forkOwner,
              repo: repoName,
            });
            forkExists = true;
            forkUrl = `https://github.com/${forkOwner}/${repoName}`;
            sendStatus({ type: "success", message: "Fork already exists, will reuse it" });
          } catch {
            sendStatus({ type: "info", message: "Fork not found, creating one..." });

            try {
              await octokit.repos.get({
                owner: upstreamOwner,
                repo: repoName,
              });
            } catch {
              sendError("Repository not accessible", `The repository ${upstreamOwner}/${repoName} does not exist or is not accessible`);
              return;
            }

            await octokit.repos.createFork({
              owner: upstreamOwner,
              repo: repoName,
            });
            forkUrl = `https://github.com/${forkOwner}/${repoName}`;
            sendStatus({ type: "info", message: "Fork created, waiting for GitHub to process..." });
            await wait(3000);
            sendStatus({ type: "success", message: "Fork is ready" });
          }

          // Step 6: Disable GitHub Actions
          sendStatus({ type: "info", step: 6, totalSteps: 10, message: "Configuring fork settings..." });

          try {
            await octokit.actions.setGithubActionsPermissionsRepository({
              owner: forkOwner,
              repo: repoName,
              enabled: false,
            });
            sendStatus({ type: "success", message: "GitHub Actions disabled on fork" });
          } catch {
            sendStatus({ type: "info", message: "Could not disable Actions (continuing anyway)" });
          }

          // Check for existing PR
          const branchName = `review-pr-${prNumber}`;

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

          // Step 7: Clone repository (using cache for speed)
          const isCached = isRepoCached(forkOwner, repoName);
          if (isCached) {
            sendStatus({ type: "info", step: 7, totalSteps: 10, message: "Preparing repository (using cache)..." });
          } else {
            sendStatus({ type: "info", step: 7, totalSteps: 10, message: "Cloning repository (this may take a while for large repos)..." });
          }

          // First, ensure reference repo is up-to-date (for faster cloning)
          await ensureReferenceRepo(forkOwner, repoName, githubToken);

          // Clone to isolated working directory (no race conditions)
          tmpDir = await cloneToWorkDir(forkOwner, repoName, githubToken);

          sendStatus({ type: "success", message: isCached ? "Repository ready (fast clone from cache)" : "Repository cloned successfully" });

          const repoGit = simpleGit(tmpDir);
          await repoGit.addConfig("user.email", "macroscope-pr-creator@example.com");
          await repoGit.addConfig("user.name", "Macroscope PR Creator");

          // Add upstream remote and fetch
          sendStatus({ type: "info", step: 7, totalSteps: 10, message: "Fetching commits from upstream repository..." });

          const upstreamCloneUrl = `https://github.com/${upstreamOwner}/${repoName}.git`;
          // Add upstream remote (fresh clone, so no need for set-url fallback)
          await repoGit.addRemote("upstream", upstreamCloneUrl);
          await repoGit.fetch(["upstream", "--no-tags"]);

          // Fetch specific commits
          sendStatus({ type: "info", message: "Fetching specific commits needed for cherry-pick..." });
          const commitsToFetch = [baseCommit, ...commitsToApply.map(c => c.sha)];
          for (const sha of commitsToFetch) {
            try {
              await repoGit.fetch(["upstream", sha]);
            } catch {
              // Ignore
            }
          }

          sendStatus({ type: "success", message: "All commits fetched" });

          // Step 8: Create base branch and review branch
          // We need a base branch at the original base commit to create a clean PR
          // (the fork's main branch contains the merged PR, which would cause conflicts)
          const baseBranchName = `base-for-pr-${prNumber}`;
          sendStatus({ type: "info", step: 8, totalSteps: 10, message: `Creating branches from base commit ${getShortHash(baseCommit)}...` });

          // First create the base branch at the base commit
          try {
            await repoGit.checkout(["-b", baseBranchName, baseCommit]);
            sendStatus({ type: "success", message: `Base branch created at ${getShortHash(baseCommit)}` });
          } catch {
            try {
              // Branch might exist, try to reset it
              await repoGit.checkout([baseBranchName]);
              await repoGit.reset(["--hard", baseCommit]);
              sendStatus({ type: "success", message: `Base branch reset to ${getShortHash(baseCommit)}` });
            } catch {
              await cleanup(tmpDir);
              sendError("Failed to create base branch", `Could not create branch at base commit ${getShortHash(baseCommit)}`);
              return;
            }
          }

          // Now create the review branch from the same base
          try {
            await repoGit.checkout(["-b", branchName, baseCommit]);
            sendStatus({ type: "success", message: `Review branch created from commit ${getShortHash(baseCommit)}` });
          } catch {
            try {
              await repoGit.checkout([branchName]);
              await repoGit.reset(["--hard", baseCommit]);
              sendStatus({ type: "success", message: `Review branch reset to commit ${getShortHash(baseCommit)}` });
            } catch {
              await cleanup(tmpDir);
              sendError("Failed to create review branch", `Could not create branch from base commit ${getShortHash(baseCommit)}`);
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
          const skippedNote = mergeCommitCount > 0 ? `\n\n*Note: ${mergeCommitCount} merge commit(s) were skipped during recreation.*` : "";
          const newPrBody = `Recreated from ${inputPrUrl} for Macroscope review.

**Original PR:** #${prNumber} by @${prAuthor}
**Status:** ${prState}${prMerged ? " (merged)" : ""}

**Includes ${commitsToApply.length} commit(s):**
${commitsToApply.map(c => `- \`${c.sha.substring(0, 7)}\`: ${c.message}`).join("\n")}${skippedNote}

**Original PR:** ${inputPrUrl}`;

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

          sendStatus({ type: "success", message: "Pull request created successfully!" });
          sendResult({
            success: true,
            message: `PR recreated with ${commitsToApply.length} commits from original PR #${prNumber}${mergeCommitCount > 0 ? ` (${mergeCommitCount} merge commits skipped)` : ""}`,
            prUrl: newPrUrl,
            forkUrl,
            commitCount: commitsToApply.length,
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

          // Check/create fork
          sendStatus({ type: "info", step: 3, totalSteps: 10, message: "Checking for existing fork..." });

          let forkExists = false;
          let forkUrl: string;

          try {
            await octokit.repos.get({
              owner: forkOwner,
              repo: repoName,
            });
            forkExists = true;
            forkUrl = `https://github.com/${forkOwner}/${repoName}`;
            sendStatus({ type: "success", message: "Fork already exists" });
          } catch {
            sendStatus({ type: "info", message: "Creating fork..." });

            try {
              await octokit.repos.get({
                owner: upstreamOwner,
                repo: repoName,
              });
            } catch {
              sendError("Repository not accessible", `The repository ${upstreamOwner}/${repoName} does not exist or is not accessible`);
              return;
            }

            await octokit.repos.createFork({
              owner: upstreamOwner,
              repo: repoName,
            });
            forkUrl = `https://github.com/${forkOwner}/${repoName}`;
            sendStatus({ type: "info", message: "Waiting for fork to be ready..." });
            await wait(3000);
            sendStatus({ type: "success", message: "Fork created" });
          }

          // Disable Actions
          sendStatus({ type: "info", step: 4, totalSteps: 10, message: "Configuring fork..." });
          try {
            await octokit.actions.setGithubActionsPermissionsRepository({
              owner: forkOwner,
              repo: repoName,
              enabled: false,
            });
            sendStatus({ type: "success", message: "GitHub Actions disabled" });
          } catch {
            sendStatus({ type: "info", message: "Could not disable Actions (continuing)" });
          }

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

          // Check existing PR
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

          // Clone repository (using cache for speed)
          const isCachedCommitMode = isRepoCached(forkOwner, repoName);
          if (isCachedCommitMode) {
            sendStatus({ type: "info", step: 7, totalSteps: 10, message: "Preparing repository (using cache)..." });
          } else {
            sendStatus({ type: "info", step: 7, totalSteps: 10, message: "Cloning repository..." });
          }

          // First, ensure reference repo is up-to-date (for faster cloning)
          await ensureReferenceRepo(forkOwner, repoName, githubToken);

          // Clone to isolated working directory (no race conditions)
          tmpDir = await cloneToWorkDir(forkOwner, repoName, githubToken);

          sendStatus({ type: "success", message: isCachedCommitMode ? "Repository ready (fast clone from cache)" : "Clone complete" });

          const repoGit = simpleGit(tmpDir);
          await repoGit.addConfig("user.email", "macroscope-pr-creator@example.com");
          await repoGit.addConfig("user.name", "Macroscope PR Creator");

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
