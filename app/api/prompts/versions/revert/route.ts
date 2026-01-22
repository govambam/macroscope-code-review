import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getPromptVersion, savePrompt } from "@/lib/services/database";

interface RevertRequest {
  name: string;
  versionNumber: number;
}

/**
 * POST /api/prompts/versions/revert
 * Reverts a prompt to a specific version by loading that version's content
 * and saving it as the current prompt (which also creates a new version).
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // Get the current user from session
    const session = await getServerSession(authOptions);
    const createdBy = session?.user?.login || null;

    const body = await request.json();
    const { name, versionNumber } = body as RevertRequest;

    // Validate name
    if (typeof name !== "string" || !name) {
      return NextResponse.json(
        { success: false, error: "Invalid prompt name" },
        { status: 400 }
      );
    }

    // Validate versionNumber
    if (
      typeof versionNumber !== "number" ||
      !Number.isInteger(versionNumber) ||
      versionNumber < 1
    ) {
      return NextResponse.json(
        { success: false, error: "Invalid version number" },
        { status: 400 }
      );
    }

    // Get the version to revert to
    const version = getPromptVersion(name, versionNumber);
    if (!version) {
      return NextResponse.json(
        { success: false, error: "Version not found" },
        { status: 404 }
      );
    }

    // Save the version's content as current (this creates a new version)
    savePrompt(name, version.content, version.model, version.purpose, createdBy);

    // Get the new version number (it's the latest one now)
    const { getPromptVersions } = await import("@/lib/services/database");
    const versions = getPromptVersions(name);
    const newVersionNumber = versions.length > 0 ? versions[0].version_number : 1;

    return NextResponse.json({
      success: true,
      newVersionNumber,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 }
    );
  }
}
