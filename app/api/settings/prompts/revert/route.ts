import { NextRequest, NextResponse } from "next/server";
import { writeFile } from "fs/promises";
import { join } from "path";
import {
  getPromptVersion,
  getDefaultPromptVersion,
  savePromptVersion,
} from "@/lib/services/database";

interface RevertRequest {
  type: "pr-analysis" | "email-generation";
  versionId?: number;  // If not provided, reverts to default
  userId?: number;
}

interface RevertResponse {
  success: boolean;
  newVersionId?: number;
  error?: string;
}

const PROMPTS_DIR = join(process.cwd(), "prompts");

/**
 * POST /api/settings/prompts/revert
 * Reverts a prompt to a specific version or default.
 * Creates a new version with the reverted content.
 */
export async function POST(request: NextRequest): Promise<NextResponse<RevertResponse>> {
  try {
    const body: RevertRequest = await request.json();
    const { type, versionId, userId } = body;

    if (!type || !["pr-analysis", "email-generation"].includes(type)) {
      return NextResponse.json(
        { success: false, error: "Invalid prompt type" },
        { status: 400 }
      );
    }

    let contentToRevert: string;

    if (versionId !== undefined) {
      // Revert to a specific version
      const version = await getPromptVersion(versionId);
      if (!version) {
        return NextResponse.json(
          { success: false, error: "Version not found" },
          { status: 404 }
        );
      }

      // Verify the version is for the correct prompt type
      if (version.prompt_type !== type) {
        return NextResponse.json(
          { success: false, error: "Version type does not match requested type" },
          { status: 400 }
        );
      }

      contentToRevert = version.content;
    } else {
      // Revert to default version
      const defaultVersion = await getDefaultPromptVersion(type as "pr-analysis" | "email-generation");
      if (!defaultVersion) {
        return NextResponse.json(
          { success: false, error: "Default version not found" },
          { status: 404 }
        );
      }

      contentToRevert = defaultVersion.content;
    }

    // Save as a new version (creates audit trail)
    const newVersionId = await savePromptVersion(
      type as "pr-analysis" | "email-generation",
      contentToRevert,
      userId ?? null,
      false
    );

    // Also update the file for backwards compatibility
    const filename = `${type}.md`;
    await writeFile(join(PROMPTS_DIR, filename), contentToRevert, "utf-8");

    return NextResponse.json({
      success: true,
      newVersionId,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Failed to revert prompt:", errorMessage);
    return NextResponse.json(
      { success: false, error: `Failed to revert prompt: ${errorMessage}` },
      { status: 500 }
    );
  }
}
