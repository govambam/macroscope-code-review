import { NextRequest, NextResponse } from "next/server";
import { Octokit } from "@octokit/rest";
import { config } from "@/lib/config";
import {
  getNextQueuedOperation,
  markOperationProcessing,
  markOperationCompleted,
  markOperationFailed,
  getStuckOperation,
  resetStuckOperation,
  getQueueStatus,
  saveFork,
  savePR,
  getFork,
  CreateForkPayload,
  CreatePRPayload,
  DeleteForkPayload,
  DeleteBranchPayload,
  SimulatePRPayload,
} from "@/lib/services/database";
import simpleGit from "simple-git";
import path from "path";
import fs from "fs";

// Minimum delay between operations (60 seconds)
const MIN_OPERATION_DELAY_MS = 60 * 1000;

// Last operation timestamp (in-memory, resets on server restart)
let lastOperationTime: number = 0;

function getOctokit(): Octokit {
  const token = config.githubToken;
  if (!token) {
    throw new Error("GitHub bot token not configured");
  }
  return new Octokit({ auth: token });
}

/**
 * POST /api/queue/process
 * Process the next queued operation.
 *
 * This endpoint should be called periodically (e.g., by a cron job or polling).
 * It enforces a minimum delay between operations to avoid GitHub rate limiting.
 *
 * Returns:
 * - { processed: true, operation: {...} } if an operation was processed
 * - { processed: false, reason: "..." } if no operation was processed
 */
export async function POST(request: NextRequest) {
  try {
    // First, check for and reset any stuck operations
    const stuckOp = getStuckOperation(10); // 10 minutes timeout
    if (stuckOp) {
      console.log(`Resetting stuck operation ${stuckOp.id}`);
      resetStuckOperation(stuckOp.id);
    }

    // Check if enough time has passed since last operation
    const now = Date.now();
    const timeSinceLastOp = now - lastOperationTime;

    if (lastOperationTime > 0 && timeSinceLastOp < MIN_OPERATION_DELAY_MS) {
      const waitTime = Math.ceil((MIN_OPERATION_DELAY_MS - timeSinceLastOp) / 1000);
      return NextResponse.json({
        processed: false,
        reason: "rate_limited",
        waitSeconds: waitTime,
        message: `Must wait ${waitTime} seconds before next operation`,
      });
    }

    // Get next operation to process
    const operation = getNextQueuedOperation();

    if (!operation) {
      return NextResponse.json({
        processed: false,
        reason: "queue_empty",
        message: "No operations in queue",
      });
    }

    // Mark as processing
    const marked = markOperationProcessing(operation.id);
    if (!marked) {
      return NextResponse.json({
        processed: false,
        reason: "already_processing",
        message: "Operation was already picked up by another processor",
      });
    }

    // Process the operation
    try {
      const result = await processOperation(operation.operation_type, JSON.parse(operation.payload));

      // Mark as completed
      markOperationCompleted(operation.id, result);

      // Update last operation time
      lastOperationTime = Date.now();

      return NextResponse.json({
        processed: true,
        operation: {
          id: operation.id,
          type: operation.operation_type,
          status: "completed",
          result,
        },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      markOperationFailed(operation.id, errorMessage);

      // Still update last operation time to prevent rapid retries
      lastOperationTime = Date.now();

      return NextResponse.json({
        processed: true,
        operation: {
          id: operation.id,
          type: operation.operation_type,
          status: "failed",
          error: errorMessage,
        },
      });
    }
  } catch (error) {
    console.error("Queue process error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to process queue" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/queue/process
 * Get processing status and timing info.
 */
export async function GET() {
  try {
    const status = getQueueStatus();
    const now = Date.now();
    const timeSinceLastOp = lastOperationTime > 0 ? now - lastOperationTime : null;
    const canProcessNow = lastOperationTime === 0 || timeSinceLastOp! >= MIN_OPERATION_DELAY_MS;
    const waitSeconds = canProcessNow ? 0 : Math.ceil((MIN_OPERATION_DELAY_MS - timeSinceLastOp!) / 1000);

    return NextResponse.json({
      ...status,
      canProcessNow,
      waitSeconds,
      minDelaySeconds: MIN_OPERATION_DELAY_MS / 1000,
      lastOperationTime: lastOperationTime > 0 ? new Date(lastOperationTime).toISOString() : null,
    });
  } catch (error) {
    console.error("Queue status error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to get queue status" },
      { status: 500 }
    );
  }
}

/**
 * Process a single operation based on its type.
 */
async function processOperation(
  type: string,
  payload: CreateForkPayload | CreatePRPayload | DeleteForkPayload | DeleteBranchPayload | SimulatePRPayload
): Promise<object> {
  switch (type) {
    case "create_fork":
      return await processCreateFork(payload as CreateForkPayload);
    case "create_pr":
      return await processCreatePR(payload as CreatePRPayload);
    case "delete_fork":
      return await processDeleteFork(payload as DeleteForkPayload);
    case "delete_branch":
      return await processDeleteBranch(payload as DeleteBranchPayload);
    case "simulate_pr":
      return await processSimulatePR(payload as SimulatePRPayload);
    default:
      throw new Error(`Unknown operation type: ${type}`);
  }
}

/**
 * Create a fork of a repository.
 */
async function processCreateFork(payload: CreateForkPayload): Promise<object> {
  const octokit = getOctokit();

  console.log(`Creating fork of ${payload.sourceOwner}/${payload.sourceRepo} in ${payload.targetOrg}`);

  // Check if fork already exists
  try {
    const { data: existingRepo } = await octokit.repos.get({
      owner: payload.targetOrg,
      repo: payload.sourceRepo,
    });

    if (existingRepo) {
      console.log(`Fork already exists: ${existingRepo.html_url}`);

      // Save to database
      const forkId = saveFork(
        payload.targetOrg,
        payload.sourceRepo,
        existingRepo.html_url,
        false,
        payload.sourceOwner
      );

      return {
        fork_url: existingRepo.html_url,
        fork_id: forkId,
        already_existed: true,
      };
    }
  } catch {
    // Fork doesn't exist, create it
  }

  // Create the fork
  const { data: fork } = await octokit.repos.createFork({
    owner: payload.sourceOwner,
    repo: payload.sourceRepo,
    organization: payload.targetOrg,
  });

  // Wait for fork to be ready
  await new Promise(resolve => setTimeout(resolve, 3000));

  // Disable GitHub Actions on the fork
  try {
    await octokit.actions.setGithubActionsPermissionsRepository({
      owner: payload.targetOrg,
      repo: payload.sourceRepo,
      enabled: false,
    });
  } catch (error) {
    console.warn("Failed to disable actions on fork:", error);
  }

  // Save to database
  const forkId = saveFork(
    payload.targetOrg,
    payload.sourceRepo,
    fork.html_url,
    false,
    payload.sourceOwner
  );

  return {
    fork_url: fork.html_url,
    fork_id: forkId,
    already_existed: false,
  };
}

/**
 * Create a PR on a fork.
 */
async function processCreatePR(payload: CreatePRPayload): Promise<object> {
  const octokit = getOctokit();

  console.log(`Creating PR on ${payload.forkOwner}/${payload.forkRepo}`);

  // Check if PR already exists for this branch
  const { data: existingPRs } = await octokit.pulls.list({
    owner: payload.forkOwner,
    repo: payload.forkRepo,
    head: `${payload.forkOwner}:${payload.branch}`,
    state: "open",
  });

  if (existingPRs.length > 0) {
    console.log(`PR already exists: ${existingPRs[0].html_url}`);
    return {
      pr_url: existingPRs[0].html_url,
      pr_number: existingPRs[0].number,
      already_existed: true,
    };
  }

  // Create the PR
  const { data: pr } = await octokit.pulls.create({
    owner: payload.forkOwner,
    repo: payload.forkRepo,
    head: payload.branch,
    base: payload.baseBranch,
    title: payload.title,
    body: payload.body,
  });

  return {
    pr_url: pr.html_url,
    pr_number: pr.number,
    already_existed: false,
  };
}

/**
 * Delete a fork repository.
 */
async function processDeleteFork(payload: DeleteForkPayload): Promise<object> {
  const octokit = getOctokit();

  console.log(`Deleting fork ${payload.owner}/${payload.repo}`);

  await octokit.repos.delete({
    owner: payload.owner,
    repo: payload.repo,
  });

  return { deleted: true };
}

/**
 * Delete a branch using git (not API).
 */
async function processDeleteBranch(payload: DeleteBranchPayload): Promise<object> {
  console.log(`Deleting branch ${payload.branch} from ${payload.owner}/${payload.repo}`);

  // Use git to delete the remote branch
  const cacheDir = config.reposDir;
  const repoPath = path.join(cacheDir, payload.owner, payload.repo);

  // Check if we have a cached clone
  if (fs.existsSync(repoPath)) {
    const git = simpleGit(repoPath);

    try {
      await git.push(["origin", "--delete", payload.branch]);
      return { deleted: true, method: "git" };
    } catch (error) {
      // If git fails, fall back to API
      console.warn(`Git delete failed, falling back to API:`, error);
    }
  }

  // Fall back to API if git fails or repo not cached
  const octokit = getOctokit();
  await octokit.git.deleteRef({
    owner: payload.owner,
    repo: payload.repo,
    ref: `heads/${payload.branch}`,
  });

  return { deleted: true, method: "api" };
}

/**
 * Process a PR simulation by calling the create-pr endpoint.
 * This handles the entire flow: fork creation, branch setup, and PR creation.
 */
async function processSimulatePR(payload: SimulatePRPayload): Promise<object> {
  console.log(`Processing PR simulation for ${payload.prUrl}`);

  // Parse the PR URL to get repo info
  const prMatch = payload.prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (!prMatch) {
    throw new Error("Invalid PR URL format");
  }

  const [, sourceOwner, sourceRepo, prNumberStr] = prMatch;
  const prNumber = parseInt(prNumberStr, 10);

  // Get the base URL for internal API calls
  // In production, use the APP_URL or construct from request
  const baseUrl = process.env.APP_URL || process.env.NEXTAUTH_URL || "http://localhost:3000";

  // Call the create-pr endpoint
  const response = await fetch(`${baseUrl}/api/create-pr`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prUrl: payload.prUrl,
      cacheRepo: payload.cacheRepo ?? true,
    }),
  });

  if (!response.ok && !response.body) {
    throw new Error(`Failed to call create-pr endpoint: ${response.status}`);
  }

  // Parse SSE response
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("No response body from create-pr endpoint");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let result: {
    success: boolean;
    prUrl?: string;
    forkUrl?: string;
    message?: string;
    error?: string;
    commitCount?: number;
    prTitle?: string;
  } | null = null;
  const statusMessages: string[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (value) {
      buffer += decoder.decode(value, { stream: !done });
    }
    if (done) break;

    // Process SSE events
    const events = buffer.split("\n\n");
    buffer = events.pop() || "";

    for (const event of events) {
      if (!event.trim()) continue;

      const dataMatch = event.match(/^data: (.+)$/m);
      if (!dataMatch) continue;

      try {
        const data = JSON.parse(dataMatch[1]);

        if (data.eventType === "status") {
          statusMessages.push(data.message);
          console.log(`[simulate_pr] ${data.message}`);
        } else if (data.eventType === "result") {
          result = data;
        }
      } catch {
        // Ignore parse errors
      }
    }
  }

  // Process any remaining buffer
  if (buffer.trim()) {
    const dataMatch = buffer.match(/^data: (.+)$/m);
    if (dataMatch) {
      try {
        const data = JSON.parse(dataMatch[1]);
        if (data.eventType === "result") {
          result = data;
        }
      } catch {
        // Ignore
      }
    }
  }

  if (!result) {
    throw new Error("No result received from create-pr endpoint");
  }

  if (!result.success) {
    throw new Error(result.error || result.message || "PR simulation failed");
  }

  // Update the optimistic database records with actual data
  if (result.prUrl) {
    // Parse the actual PR URL to get the PR number
    const actualPrMatch = result.prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
    if (actualPrMatch) {
      const [, forkOwner, forkRepo, actualPrNumber] = actualPrMatch;

      // Get or create the fork record
      let fork = getFork(forkOwner, forkRepo);
      let forkId: number;

      if (fork) {
        forkId = fork.id;
      } else if (result.forkUrl) {
        forkId = saveFork(forkOwner, forkRepo, result.forkUrl, false, sourceOwner);
      } else {
        forkId = saveFork(forkOwner, forkRepo, `https://github.com/${forkOwner}/${forkRepo}`, false, sourceOwner);
      }

      // Update the PR record (this will update the placeholder record created when queued)
      savePR(
        forkId,
        parseInt(actualPrNumber, 10),
        result.prTitle || `PR #${prNumber} from ${sourceOwner}/${sourceRepo}`,
        result.prUrl,
        payload.prUrl,
        false,
        null,
        {
          state: "open",
          commitCount: result.commitCount,
        }
      );
    }
  }

  return {
    success: true,
    prUrl: result.prUrl,
    forkUrl: result.forkUrl,
    commitCount: result.commitCount,
    statusMessages,
  };
}
