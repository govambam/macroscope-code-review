import { NextRequest, NextResponse } from "next/server";
import { getPromptVersions } from "@/lib/services/database";

/**
 * GET /api/prompts/versions?name={promptName}
 * Returns version history for a specific prompt.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const name = searchParams.get("name");

    // Validate name parameter
    if (typeof name !== "string" || !name) {
      return NextResponse.json(
        { success: false, error: "Missing prompt name" },
        { status: 400 }
      );
    }

    const versions = getPromptVersions(name);

    // Transform to API format
    const versionList = versions.map((v) => ({
      version_number: v.version_number,
      content: v.content,
      model: v.model,
      purpose: v.purpose,
      created_at: v.created_at,
    }));

    return NextResponse.json({
      success: true,
      versions: versionList,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 }
    );
  }
}
