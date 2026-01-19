import { NextRequest, NextResponse } from "next/server";
import {
  getPromptVersions,
  PromptVersionRecord,
} from "@/lib/services/database";

interface GetVersionsResponse {
  success: boolean;
  versions?: PromptVersionRecord[];
  error?: string;
}

/**
 * GET /api/settings/prompts/versions?type=pr-analysis|email-generation
 * Returns all versions for a prompt type.
 */
export async function GET(request: NextRequest): Promise<NextResponse<GetVersionsResponse>> {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type");

    if (!type || !["pr-analysis", "email-generation"].includes(type)) {
      return NextResponse.json(
        { success: false, error: "Invalid or missing prompt type" },
        { status: 400 }
      );
    }

    const versions = await getPromptVersions(type as "pr-analysis" | "email-generation");

    return NextResponse.json({
      success: true,
      versions,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Failed to get prompt versions:", errorMessage);
    return NextResponse.json(
      { success: false, error: `Failed to get prompt versions: ${errorMessage}` },
      { status: 500 }
    );
  }
}
