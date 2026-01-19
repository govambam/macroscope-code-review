import { NextRequest, NextResponse } from "next/server";
import { getPromptVersion, PromptVersionRecord } from "@/lib/services/database";

interface GetVersionResponse {
  success: boolean;
  version?: PromptVersionRecord;
  error?: string;
}

/**
 * GET /api/settings/prompts/versions/[id]
 * Returns a specific version by ID.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse<GetVersionResponse>> {
  try {
    const { id } = await params;
    const versionId = parseInt(id, 10);

    if (isNaN(versionId)) {
      return NextResponse.json(
        { success: false, error: "Invalid version ID" },
        { status: 400 }
      );
    }

    const version = await getPromptVersion(versionId);

    if (!version) {
      return NextResponse.json(
        { success: false, error: "Version not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      version,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Failed to get prompt version:", errorMessage);
    return NextResponse.json(
      { success: false, error: `Failed to get prompt version: ${errorMessage}` },
      { status: 500 }
    );
  }
}
