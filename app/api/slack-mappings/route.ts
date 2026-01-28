import { NextRequest, NextResponse } from "next/server";
import {
  getAllSlackUserMappings,
  saveSlackUserMapping,
  deleteSlackUserMapping,
  SlackUserMappingRecord,
} from "@/lib/services/database";

interface SlackMappingsResponse {
  success: boolean;
  mappings?: SlackUserMappingRecord[];
  error?: string;
}

interface SaveMappingRequest {
  githubUsername: string;
  slackUserId: string;
}

interface DeleteMappingRequest {
  githubUsername: string;
}

/**
 * GET /api/slack-mappings
 *
 * Returns all GitHub to Slack user mappings.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const mappings = getAllSlackUserMappings();
    return NextResponse.json<SlackMappingsResponse>({
      success: true,
      mappings,
    });
  } catch (error) {
    console.error("Failed to get Slack mappings:", error);
    return NextResponse.json<SlackMappingsResponse>(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to get mappings",
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/slack-mappings
 *
 * Creates or updates a GitHub to Slack user mapping.
 *
 * Request body:
 * - githubUsername: The GitHub username
 * - slackUserId: The Slack user ID (e.g., "U12345678")
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    if (!body || typeof body !== "object") {
      return NextResponse.json<SlackMappingsResponse>(
        { success: false, error: "Request body must be a JSON object" },
        { status: 400 }
      );
    }

    const { githubUsername, slackUserId } = body as SaveMappingRequest;

    if (!githubUsername || typeof githubUsername !== "string") {
      return NextResponse.json<SlackMappingsResponse>(
        { success: false, error: "githubUsername is required and must be a string" },
        { status: 400 }
      );
    }

    if (!slackUserId || typeof slackUserId !== "string") {
      return NextResponse.json<SlackMappingsResponse>(
        { success: false, error: "slackUserId is required and must be a string" },
        { status: 400 }
      );
    }

    // Validate Slack user ID format (starts with U and has alphanumeric characters)
    if (!/^U[A-Z0-9]+$/i.test(slackUserId)) {
      return NextResponse.json<SlackMappingsResponse>(
        { success: false, error: "slackUserId must be a valid Slack user ID (e.g., U12345678)" },
        { status: 400 }
      );
    }

    saveSlackUserMapping(githubUsername, slackUserId);

    const mappings = getAllSlackUserMappings();
    return NextResponse.json<SlackMappingsResponse>({
      success: true,
      mappings,
    });
  } catch (error) {
    console.error("Failed to save Slack mapping:", error);
    return NextResponse.json<SlackMappingsResponse>(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to save mapping",
      },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/slack-mappings
 *
 * Deletes a GitHub to Slack user mapping.
 *
 * Request body:
 * - githubUsername: The GitHub username to remove mapping for
 */
export async function DELETE(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    if (!body || typeof body !== "object") {
      return NextResponse.json<SlackMappingsResponse>(
        { success: false, error: "Request body must be a JSON object" },
        { status: 400 }
      );
    }

    const { githubUsername } = body as DeleteMappingRequest;

    if (!githubUsername || typeof githubUsername !== "string") {
      return NextResponse.json<SlackMappingsResponse>(
        { success: false, error: "githubUsername is required and must be a string" },
        { status: 400 }
      );
    }

    const deleted = deleteSlackUserMapping(githubUsername);

    if (!deleted) {
      return NextResponse.json<SlackMappingsResponse>(
        { success: false, error: "Mapping not found" },
        { status: 404 }
      );
    }

    const mappings = getAllSlackUserMappings();
    return NextResponse.json<SlackMappingsResponse>({
      success: true,
      mappings,
    });
  } catch (error) {
    console.error("Failed to delete Slack mapping:", error);
    return NextResponse.json<SlackMappingsResponse>(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to delete mapping",
      },
      { status: 500 }
    );
  }
}
