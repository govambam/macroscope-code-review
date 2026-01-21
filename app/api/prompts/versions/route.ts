import { NextRequest, NextResponse } from "next/server";
import {
  getPrompt,
  getPromptVersionsByName,
  revertPromptToVersion,
  getCurrentVersionNumber,
  PromptVersionRecord,
} from "@/lib/services/database";

interface VersionResponse {
  id: number;
  versionNumber: number;
  content: string;
  model: string | null;
  purpose: string | null;
  createdAt: string;
  isCurrent: boolean;
}

/**
 * GET /api/prompts/versions?name=prompt-name
 * Returns version history for a prompt.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const name = searchParams.get("name");

    if (!name) {
      return NextResponse.json(
        { success: false, error: "Prompt name is required" },
        { status: 400 }
      );
    }

    const prompt = getPrompt(name);
    if (!prompt) {
      return NextResponse.json(
        { success: false, error: `Prompt "${name}" not found` },
        { status: 404 }
      );
    }

    const versions = getPromptVersionsByName(name);
    const currentVersion = getCurrentVersionNumber(prompt.id);

    // Transform to API format
    const versionList: VersionResponse[] = versions.map((v: PromptVersionRecord) => ({
      id: v.id,
      versionNumber: v.version_number,
      content: v.content,
      model: v.model,
      purpose: v.purpose,
      createdAt: v.created_at,
      isCurrent: Boolean(v.is_current),
    }));

    return NextResponse.json({
      success: true,
      promptId: prompt.id,
      promptName: name,
      currentVersion,
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

/**
 * POST /api/prompts/versions
 * Reverts a prompt to a specific version.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const { name, versionNumber } = body as { name: string; versionNumber: number };

    if (!name || versionNumber === undefined) {
      return NextResponse.json(
        { success: false, error: "Name and versionNumber are required" },
        { status: 400 }
      );
    }

    const prompt = getPrompt(name);
    if (!prompt) {
      return NextResponse.json(
        { success: false, error: `Prompt "${name}" not found` },
        { status: 404 }
      );
    }

    const success = revertPromptToVersion(prompt.id, versionNumber);

    if (!success) {
      return NextResponse.json(
        { success: false, error: `Version ${versionNumber} not found` },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `Reverted to version ${versionNumber}`,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 }
    );
  }
}
