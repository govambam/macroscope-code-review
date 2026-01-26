import { NextResponse } from "next/server";
import {
  getPRsNeedingMacroscopeSync,
  updatePRMacroscopeStatus,
} from "@/lib/services/database";
import { checkMacroscopeReviewStatus } from "@/lib/services/macroscope-status";

interface PollResult {
  prId: number;
  prNumber: number;
  repo: string;
  oldStatus: string | null;
  newStatus: string;
  bugsFound: number;
}

interface PollResponse {
  success: boolean;
  polled: number;
  updated: number;
  updates: PollResult[];
  error?: string;
}

/**
 * POST /api/poll-macroscope-reviews
 *
 * Background polling for Macroscope review status.
 * This is a backup mechanism for webhooks.
 *
 * Polls PRs that are:
 * - Still pending/in_progress
 * - Created in last 48 hours
 * - Haven't been synced in last 5 minutes
 *
 * Can be called:
 * - From client-side on an interval (every 30 seconds)
 * - From a cron job as a backup
 */
export async function POST(): Promise<NextResponse<PollResponse>> {
  try {
    // Get PRs that need status checking
    const pendingPRs = getPRsNeedingMacroscopeSync(50);

    if (pendingPRs.length === 0) {
      return NextResponse.json({
        success: true,
        polled: 0,
        updated: 0,
        updates: [],
      });
    }

    console.log(`[Polling] Polling ${pendingPRs.length} PRs for Macroscope reviews:`, pendingPRs.map(p => `${p.repo_owner}/${p.repo_name}#${p.pr_number} (${p.macroscope_review_status})`));

    const updates: PollResult[] = [];

    // Check each PR's status
    for (const pr of pendingPRs) {
      try {
        const status = await checkMacroscopeReviewStatus(
          pr.repo_owner,
          pr.repo_name,
          pr.pr_number
        );

        // Update database
        updatePRMacroscopeStatus(pr.id, {
          status: status.status,
          bugsCount: status.bugsFound,
          startedAt: status.startedAt,
          completedAt: status.completedAt,
        });

        // Track updates where status actually changed
        if (status.status !== pr.macroscope_review_status) {
          updates.push({
            prId: pr.id,
            prNumber: pr.pr_number,
            repo: `${pr.repo_owner}/${pr.repo_name}`,
            oldStatus: pr.macroscope_review_status,
            newStatus: status.status,
            bugsFound: status.bugsFound,
          });

          console.log(
            `${pr.repo_owner}/${pr.repo_name}#${pr.pr_number}: ${pr.macroscope_review_status} → ${status.status} (${status.bugsFound} bugs)`
          );
        }

        // Small delay to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 500));
      } catch (error) {
        console.error(
          `Failed to poll PR ${pr.repo_owner}/${pr.repo_name}#${pr.pr_number}:`,
          error
        );
      }
    }

    return NextResponse.json({
      success: true,
      polled: pendingPRs.length,
      updated: updates.length,
      updates,
    });
  } catch (error) {
    console.error("Polling error:", error);
    return NextResponse.json(
      {
        success: false,
        polled: 0,
        updated: 0,
        updates: [],
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/poll-macroscope-reviews
 *
 * Returns the current status of PRs awaiting review.
 * Useful for checking how many PRs need attention.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const pendingPRs = getPRsNeedingMacroscopeSync(100);

    return NextResponse.json({
      success: true,
      pendingCount: pendingPRs.length,
      prs: pendingPRs.map((pr) => ({
        id: pr.id,
        prNumber: pr.pr_number,
        repo: `${pr.repo_owner}/${pr.repo_name}`,
        status: pr.macroscope_review_status,
        lastSynced: pr.macroscope_last_synced_at,
        createdAt: pr.created_at,
      })),
    });
  } catch (error) {
    console.error("Error fetching pending PRs:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
