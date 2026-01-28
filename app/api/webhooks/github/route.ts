import { NextRequest, NextResponse } from "next/server";
import { Octokit } from "@octokit/rest";
import { config, GITHUB_ORG } from "@/lib/config";
import {
  getFork,
  getPR,
  saveFork,
  savePR,
  updatePRBugCount,
  getSlackUserMapping,
} from "@/lib/services/database";
import { sendMacroscopeReviewNotification } from "@/lib/services/slack";

interface CheckRunPayload {
  action: string;
  check_run: {
    id: number;
    name: string;
    status: string;
    conclusion: string | null;
    app: {
      slug: string;
      name: string;
    };
    check_suite: {
      id: number;
      pull_requests: Array<{
        number: number;
        url: string;
      }>;
    };
  };
  repository: {
    name: string;
    full_name: string;
    owner: {
      login: string;
    };
  };
}

interface WebhookResponse {
  success: boolean;
  message: string;
  bugCount?: number;
  slackNotified?: boolean;
}

/**
 * POST /api/webhooks/github
 *
 * Handles GitHub webhook events for check_run completions.
 * When Macroscope completes its review:
 * 1. Counts Macroscope bot comments (lightweight bug count)
 * 2. Updates the PR record in the database
 * 3. Sends Slack notification to the PR owner
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const eventType = request.headers.get("x-github-event");

    // Only process check_run events
    if (eventType !== "check_run") {
      return NextResponse.json<WebhookResponse>({
        success: true,
        message: `Ignored event type: ${eventType}`,
      });
    }

    const payload: CheckRunPayload = await request.json();

    // Only process completed check runs
    if (payload.action !== "completed") {
      return NextResponse.json<WebhookResponse>({
        success: true,
        message: `Ignored check_run action: ${payload.action}`,
      });
    }

    // Check if this is a Macroscope check run
    const appSlug = payload.check_run.app?.slug;
    const appName = payload.check_run.app?.name;
    const isMacroscope =
      appSlug === "macroscope" ||
      appName?.toLowerCase().includes("macroscope") ||
      payload.check_run.name?.toLowerCase().includes("macroscope");

    if (!isMacroscope) {
      return NextResponse.json<WebhookResponse>({
        success: true,
        message: `Ignored non-Macroscope check run: ${appSlug || appName || payload.check_run.name}`,
      });
    }

    // Get PR information from the check run
    const pullRequests = payload.check_run.check_suite?.pull_requests || [];
    if (pullRequests.length === 0) {
      return NextResponse.json<WebhookResponse>({
        success: true,
        message: "No pull requests associated with this check run",
      });
    }

    const repoOwner = payload.repository.owner.login;
    const repoName = payload.repository.name;

    // Only process PRs in our organization
    if (repoOwner !== GITHUB_ORG) {
      return NextResponse.json<WebhookResponse>({
        success: true,
        message: `Ignored PR from outside organization: ${repoOwner}`,
      });
    }

    const githubToken = config.githubToken;
    if (!githubToken) {
      return NextResponse.json<WebhookResponse>(
        { success: false, message: "GitHub bot token not configured" },
        { status: 500 }
      );
    }

    const octokit = new Octokit({ auth: githubToken });

    // Process each associated PR
    const results: Array<{
      prNumber: number;
      bugCount: number;
      slackNotified: boolean;
    }> = [];

    for (const pr of pullRequests) {
      const prNumber = pr.number;

      // Fetch review comments to count Macroscope bugs
      const { data: reviewComments } = await octokit.pulls.listReviewComments({
        owner: repoOwner,
        repo: repoName,
        pull_number: prNumber,
        per_page: 100,
      });

      const macroscopeComments = reviewComments.filter(
        (comment) => comment.user?.login === "macroscopeapp[bot]"
      );

      const bugCount = macroscopeComments.length;

      // Ensure PR exists in database and update bug count
      let prRecord = null;
      try {
        let fork = getFork(repoOwner, repoName);
        if (!fork) {
          const forkId = saveFork(
            repoOwner,
            repoName,
            `https://github.com/${repoOwner}/${repoName}`
          );
          fork = { id: forkId, repo_owner: repoOwner, repo_name: repoName, fork_url: `https://github.com/${repoOwner}/${repoName}`, is_internal: false, created_at: new Date().toISOString() };
        }

        prRecord = getPR(fork.id, prNumber);
        if (!prRecord) {
          // Fetch PR details from GitHub
          const { data: prData } = await octokit.pulls.get({
            owner: repoOwner,
            repo: repoName,
            pull_number: prNumber,
          });

          const prId = savePR(
            fork.id,
            prNumber,
            prData.title,
            prData.html_url,
            null, // original PR URL not known from webhook
            bugCount > 0,
            bugCount,
            { updateBugCheckTime: true }
          );
          prRecord = getPR(fork.id, prNumber);
        } else {
          updatePRBugCount(prRecord.id, bugCount);
        }
      } catch (dbError) {
        console.error("Failed to update database:", dbError);
      }

      // Send Slack notification
      let slackNotified = false;
      if (prRecord) {
        const ownerGithubUsername = prRecord.created_by;
        let ownerSlackUserId: string | null = null;

        if (ownerGithubUsername) {
          const slackMapping = getSlackUserMapping(ownerGithubUsername);
          ownerSlackUserId = slackMapping?.slack_user_id || null;
        }

        const slackResult = await sendMacroscopeReviewNotification({
          prUrl: prRecord.forked_pr_url,
          prTitle: prRecord.pr_title,
          repoName,
          prNumber,
          bugCount,
          ownerGithubUsername,
          ownerSlackUserId,
        });

        slackNotified = slackResult.success;
        if (!slackResult.success) {
          console.error("Slack notification failed:", slackResult.error);
        }
      }

      results.push({ prNumber, bugCount, slackNotified });
    }

    const totalBugs = results.reduce((sum, r) => sum + r.bugCount, 0);
    const anySlackNotified = results.some((r) => r.slackNotified);

    return NextResponse.json<WebhookResponse>({
      success: true,
      message: `Processed ${results.length} PR(s) with ${totalBugs} total Macroscope comment(s)`,
      bugCount: totalBugs,
      slackNotified: anySlackNotified,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Webhook processing error:", errorMessage);
    return NextResponse.json<WebhookResponse>(
      { success: false, message: errorMessage },
      { status: 500 }
    );
  }
}
