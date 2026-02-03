import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  queueGithubOperation,
  getQueueEntry,
  saveFork,
  savePR,
  getFork,
  getPendingOperations,
  SimulatePRPayload,
} from "@/lib/services/database";

interface QueuePRSimulationRequest {
  prUrl: string;
  targetOrg?: string; // Defaults to macroscope-gtm
}

/**
 * POST /api/queue/add
 * Add a PR simulation to the queue.
 *
 * This queues the entire PR simulation process (fork creation, branch setup, PR creation).
 * The operation will be processed by the queue processor with rate limiting.
 *
 * It also creates optimistic database entries for immediate UI display.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const createdBy = session?.user?.name || session?.user?.email || null;

    const body: QueuePRSimulationRequest = await request.json();
    const { prUrl, targetOrg = "macroscope-gtm" } = body;

    if (!prUrl) {
      return NextResponse.json(
        { error: "prUrl is required" },
        { status: 400 }
      );
    }

    // Parse the PR URL to extract owner, repo, and PR number
    const prMatch = prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
    if (!prMatch) {
      return NextResponse.json(
        { error: "Invalid PR URL format" },
        { status: 400 }
      );
    }

    const [, sourceOwner, sourceRepo, prNumberStr] = prMatch;
    const prNumber = parseInt(prNumberStr, 10);

    // Check if this PR is already queued
    const pendingOps = getPendingOperations();
    const alreadyQueued = pendingOps.some(op => {
      if (op.operation_type !== "simulate_pr") return false;
      try {
        const payload = JSON.parse(op.payload) as SimulatePRPayload;
        return payload.prUrl === prUrl;
      } catch {
        return false;
      }
    });

    if (alreadyQueued) {
      return NextResponse.json(
        { error: "This PR is already in the queue" },
        { status: 409 }
      );
    }

    // Create or get fork record (optimistic)
    let existingFork = getFork(targetOrg, sourceRepo);
    let forkId: number;

    if (existingFork) {
      forkId = existingFork.id;
    } else {
      // Create optimistic fork record
      forkId = saveFork(
        targetOrg,
        sourceRepo,
        `https://github.com/${targetOrg}/${sourceRepo}`,
        false,
        sourceOwner
      );
    }

    // Create optimistic PR record with "queued" state
    // Use a placeholder PR number (0) and URL - will be updated when actually created
    const prId = savePR(
      forkId,
      0, // Placeholder PR number
      `[Queued] PR #${prNumber} from ${sourceOwner}/${sourceRepo}`,
      `queued://${targetOrg}/${sourceRepo}/pr/${prNumber}`, // Placeholder URL to track
      prUrl,
      false,
      null,
      {
        state: "queued",
        createdBy,
      }
    );

    // Queue the simulate_pr operation
    const payload: SimulatePRPayload = {
      prUrl,
      targetOrg,
      cacheRepo: true,
    };

    const queueId = queueGithubOperation("simulate_pr", payload, createdBy, 0);
    const queueEntry = getQueueEntry(queueId);

    // Calculate queue position
    const queuePosition = pendingOps.filter(op => op.status === "queued").length + 1;

    return NextResponse.json({
      success: true,
      message: "PR simulation queued",
      queueId,
      forkId,
      prId,
      queuePosition,
      operation: queueEntry ? {
        id: queueEntry.id,
        type: queueEntry.operation_type,
        status: queueEntry.status,
        created_at: queueEntry.created_at,
      } : null,
    });
  } catch (error) {
    console.error("Queue add error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to queue operation" },
      { status: 500 }
    );
  }
}
