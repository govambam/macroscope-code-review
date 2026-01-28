/**
 * Slack notification service for sending webhook notifications.
 */

interface SlackNotificationPayload {
  text: string;
  blocks?: SlackBlock[];
}

interface SlackBlock {
  type: string;
  text?: {
    type: string;
    text: string;
    emoji?: boolean;
  };
  elements?: Array<{
    type: string;
    text?: string;
    url?: string;
  }>;
}

interface MacroscopeReviewNotification {
  prUrl: string;
  prTitle: string | null;
  repoName: string;
  prNumber: number;
  bugCount: number;
  ownerGithubUsername: string | null;
  ownerSlackUserId: string | null;
}

/**
 * Send a Slack notification when Macroscope review completes.
 */
export async function sendMacroscopeReviewNotification(
  notification: MacroscopeReviewNotification
): Promise<{ success: boolean; error?: string }> {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;

  if (!webhookUrl) {
    return { success: false, error: "SLACK_WEBHOOK_URL is not configured" };
  }

  const { prUrl, prTitle, repoName, prNumber, bugCount, ownerSlackUserId } = notification;

  // Build the user mention - use Slack mention if we have the ID, otherwise just show GitHub username
  const userMention = ownerSlackUserId
    ? `<@${ownerSlackUserId}>`
    : notification.ownerGithubUsername
      ? `@${notification.ownerGithubUsername}`
      : "Team";

  // Build the review URL for our app
  const appBaseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
  const reviewUrl = `${appBaseUrl}?prUrl=${encodeURIComponent(prUrl)}`;

  const bugText = bugCount === 1 ? "1 potential bug" : `${bugCount} potential bugs`;
  const prDisplayTitle = prTitle || `PR #${prNumber}`;

  const payload: SlackNotificationPayload = {
    text: `Macroscope found ${bugText} in ${repoName}#${prNumber}`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${userMention} Macroscope review complete for *<${prUrl}|${prDisplayTitle}>*`,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: bugCount > 0
            ? `:bug: Found *${bugText}* that may need attention`
            : `:white_check_mark: No bugs found`,
        },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: "View in GitHub",
            url: prUrl,
          },
          ...(bugCount > 0 ? [{
            type: "button",
            text: "Analyze & Review",
            url: reviewUrl,
          }] : []),
        ],
      },
    ],
  };

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Slack webhook error:", response.status, errorText);
      return { success: false, error: `Slack API error: ${response.status}` };
    }

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Failed to send Slack notification:", errorMessage);
    return { success: false, error: errorMessage };
  }
}
