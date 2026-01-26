import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { Octokit } from "@octokit/rest";
import { getPRByRepoAndNumber, updatePRBugCount } from "@/lib/services/database";
import { config } from "@/lib/config";

/**
 * GitHub Webhook Handler
 *
 * Handles check_run events to update bug counts when Macroscope review completes.
 *
 * Setup in GitHub org settings:
 * 1. Payload URL: https://your-domain/api/webhooks/github
 * 2. Content type: application/json
 * 3. Secret: Set GITHUB_WEBHOOK_SECRET env var
 * 4. Events: Select "Check runs"
 */
export async function POST(request: NextRequest) {
  try {
    // 1. Get signature and raw payload
    const signature = request.headers.get("x-hub-signature-256");
    const payload = await request.text();

    // 2. Verify webhook signature
    if (!verifyWebhookSignature(payload, signature)) {
      console.error("[Webhook] Invalid signature");
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    // 3. Parse payload and get event type
    const event = JSON.parse(payload);
    if (!event || typeof event !== "object") {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }
    const eventType = request.headers.get("x-github-event");

    console.log(`[Webhook] Received: ${eventType} - ${event.action || "no action"}`);

    // 4. Handle different event types
    switch (eventType) {
      case "check_run":
        await handleCheckRunEvent(event);
        break;

      case "ping":
        console.log("[Webhook] Ping received - webhook configured successfully");
        break;

      default:
        console.log(`[Webhook] Ignoring event type: ${eventType}`);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Webhook] Error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

/**
 * Verify webhook payload signature using HMAC SHA256
 */
function verifyWebhookSignature(payload: string, signature: string | null): boolean {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;

  // If no secret configured, reject in production, allow in development
  if (!secret) {
    console.warn("[Webhook] GITHUB_WEBHOOK_SECRET not configured");
    return process.env.NODE_ENV === "development";
  }

  if (!signature) {
    console.error("[Webhook] No signature in request");
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
 * Handle check_run events - update bug count when Macroscope check completes
 */
async function handleCheckRunEvent(event: CheckRunEvent) {
  const { action, check_run } = event;

  // Only process completed checks
  if (action !== "completed") {
    return;
  }

  // Check if this is a Macroscope-related check
  const checkName = check_run.name.toLowerCase();
  const isMacroscopeCheck =
    checkName.includes("macroscope") ||
    checkName.includes("correctness");

  if (!isMacroscopeCheck) {
    console.log(`[Webhook] Ignoring non-Macroscope check: ${check_run.name}`);
    return;
  }

  console.log(`[Webhook] Macroscope check completed: ${check_run.name}`);

  // Get associated PRs
  const pullRequests = check_run.pull_requests || [];
  if (pullRequests.length === 0) {
    console.log("[Webhook] Check run not associated with any PR");
    return;
  }

  const githubToken = config.githubToken;
  if (!githubToken) {
    console.error("[Webhook] GITHUB_BOT_TOKEN not configured");
    return;
  }

  const octokit = new Octokit({ auth: githubToken });

  // Process each associated PR
  for (const pr of pullRequests) {
    const owner = pr.base.repo.owner.login;
    const repo = pr.base.repo.name;
    const prNumber = pr.number;

    console.log(`[Webhook] Processing ${owner}/${repo}#${prNumber}`);

    try {
      // Find PR in our database
      const dbPR = getPRByRepoAndNumber(owner, repo, prNumber);
      if (!dbPR) {
        console.log(`[Webhook] PR ${owner}/${repo}#${prNumber} not found in database`);
        continue;
      }

      // Fetch bug count from GitHub (Macroscope comments)
      const bugCount = await fetchMacroscopeBugCount(octokit, owner, repo, prNumber);

      // Update database
      updatePRBugCount(dbPR.id, bugCount);

      console.log(`[Webhook] Updated ${owner}/${repo}#${prNumber}: ${bugCount} bugs`);
    } catch (error) {
      console.error(`[Webhook] Error processing ${owner}/${repo}#${prNumber}:`, error);
    }
  }
}

/**
 * Fetch Macroscope bug count by counting review comments from the Macroscope bot
 */
async function fetchMacroscopeBugCount(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number
): Promise<number> {
  const { data: reviewComments } = await octokit.pulls.listReviewComments({
    owner,
    repo,
    pull_number: prNumber,
    per_page: 100,
  });

  // Count comments from Macroscope bot that indicate bugs
  const macroscopeComments = reviewComments.filter(
    (comment) =>
      (comment.user?.login?.toLowerCase() ?? "").includes("macroscope") &&
      // Bug indicators - Macroscope uses specific patterns
      (comment.body.includes("🎯") ||
        comment.body.toLowerCase().includes("suggestion") ||
        comment.body.toLowerCase().includes("want me to fix"))
  );

  return macroscopeComments.length;
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
