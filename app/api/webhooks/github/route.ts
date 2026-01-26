import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import {
  getPRByRepoAndNumber,
  updatePRMacroscopeStatus,
} from "@/lib/services/database";
import { checkMacroscopeReviewStatus } from "@/lib/services/macroscope-status";

/**
 * GitHub Webhook Handler
 *
 * Receives webhooks from GitHub organization for:
 * - Check runs (Macroscope review completion)
 * - Pull request review comments (bug comments)
 *
 * Setup:
 * 1. Go to GitHub organization settings → Webhooks
 * 2. Add webhook URL: https://your-domain/api/webhooks/github
 * 3. Set content type to application/json
 * 4. Generate and set a webhook secret
 * 5. Add GITHUB_WEBHOOK_SECRET to environment variables
 * 6. Select events: Check runs, Pull request review comments
 */
export async function POST(request: NextRequest) {
  try {
    // 1. Get signature and raw payload
    const signature = request.headers.get("x-hub-signature-256");
    const payload = await request.text();

    // 2. Verify webhook signature (CRITICAL FOR SECURITY!)
    if (!verifyWebhookSignature(payload, signature)) {
      console.error("Invalid webhook signature");
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    // 3. Parse payload and get event type
    const event = JSON.parse(payload);
    const eventType = request.headers.get("x-github-event");

    console.log(`Webhook: ${eventType} - ${event.action || "no action"}`);

    // 4. Handle different event types
    switch (eventType) {
      case "check_run":
        await handleCheckRunEvent(event);
        break;

      case "pull_request_review_comment":
        await handleReviewCommentEvent(event);
        break;

      case "ping":
        // GitHub sends this when webhook is first configured
        console.log("Webhook ping received - webhook configured successfully");
        break;

      default:
        console.log(`Unhandled event type: ${eventType}`);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Webhook error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

/**
 * Verify that webhook payload is from GitHub
 * Uses HMAC SHA256 signature verification
 */
function verifyWebhookSignature(payload: string, signature: string | null): boolean {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;

  // If no secret configured, skip verification in development
  // IMPORTANT: Always configure the secret in production!
  if (!secret) {
    console.warn("GITHUB_WEBHOOK_SECRET not configured - skipping signature verification");
    // In production, you should return false here
    return process.env.NODE_ENV === "development";
  }

  if (!signature) {
    console.error("No signature provided in webhook request");
    return false;
  }

  const hmac = crypto.createHmac("sha256", secret);
  const digest = "sha256=" + hmac.update(payload).digest("hex");

  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest));
  } catch {
    return false;
  }
}

/**
 * Handle check_run events
 * Triggered when Macroscope check starts, progresses, or completes
 */
async function handleCheckRunEvent(event: CheckRunEvent) {
  const { action, check_run } = event;

  // Check if this is a Macroscope-related check
  const isMacroscopeCheck =
    check_run.name.toLowerCase().includes("macroscope") ||
    check_run.name.toLowerCase().includes("correctness");

  if (!isMacroscopeCheck) {
    return;
  }

  const pullRequests = check_run.pull_requests || [];
  if (pullRequests.length === 0) {
    console.log("Check run not associated with a PR");
    return;
  }

  for (const pr of pullRequests) {
    const owner = pr.base.repo.owner.login;
    const repoName = pr.base.repo.name;
    const prNumber = pr.number;

    console.log(
      `Macroscope check ${action} for ${owner}/${repoName}#${prNumber}`
    );

    try {
      // Find PR in our database
      const dbPR = getPRByRepoAndNumber(owner, repoName, prNumber);

      if (!dbPR) {
        console.log(`PR ${owner}/${repoName}#${prNumber} not found in database`);
        continue;
      }

      // Determine status based on action
      let status: "pending" | "in_progress" | "completed" | "failed";
      let bugsCount: number | undefined;

      if (action === "completed") {
        // Fetch detailed status including bug count
        const fullStatus = await checkMacroscopeReviewStatus(
          owner,
          repoName,
          prNumber
        );
        status = fullStatus.status;
        bugsCount = fullStatus.bugsFound;

        console.log(
          `Updated ${owner}/${repoName}#${prNumber}: ${bugsCount} bugs found`
        );
      } else if (action === "created" || action === "requested_action") {
        status = "in_progress";
      } else {
        status = "in_progress";
      }

      // Update database
      updatePRMacroscopeStatus(dbPR.id, {
        status,
        bugsCount,
        startedAt: check_run.started_at,
        completedAt: check_run.completed_at,
      });
    } catch (error) {
      console.error(
        `Failed to process check_run for ${owner}/${repoName}#${prNumber}:`,
        error
      );
    }
  }
}

/**
 * Handle pull_request_review_comment events
 * Triggered when Macroscope adds bug comments
 */
async function handleReviewCommentEvent(event: ReviewCommentEvent) {
  const { comment, pull_request } = event;

  // Only process Macroscope bot comments
  if (!comment.user.login.toLowerCase().includes("macroscope")) {
    return;
  }

  const owner = pull_request.base.repo.owner.login;
  const repo = pull_request.base.repo.name;
  const prNumber = pull_request.number;

  console.log(`Macroscope comment on ${owner}/${repo}#${prNumber}`);

  try {
    // Find PR in database
    const dbPR = getPRByRepoAndNumber(owner, repo, prNumber);

    if (!dbPR) {
      console.log(`PR ${owner}/${repo}#${prNumber} not found in database`);
      return;
    }

    // Re-sync status (in case check_run event was missed)
    const status = await checkMacroscopeReviewStatus(owner, repo, prNumber);
    updatePRMacroscopeStatus(dbPR.id, {
      status: status.status,
      bugsCount: status.bugsFound,
      startedAt: status.startedAt,
      completedAt: status.completedAt,
    });
  } catch (error) {
    console.error(
      `Failed to process review comment for ${owner}/${repo}#${prNumber}:`,
      error
    );
  }
}

// Type definitions for GitHub webhook events
interface CheckRunEvent {
  action: string;
  check_run: {
    name: string;
    status: string;
    conclusion: string | null;
    started_at: string | null;
    completed_at: string | null;
    pull_requests: Array<{
      number: number;
      base: {
        repo: {
          name: string;
          owner: {
            login: string;
          };
        };
      };
    }>;
  };
}

interface ReviewCommentEvent {
  action: string;
  comment: {
    id: number;
    body: string;
    user: {
      login: string;
    };
  };
  pull_request: {
    number: number;
    base: {
      repo: {
        name: string;
        owner: {
          login: string;
        };
      };
    };
  };
}
