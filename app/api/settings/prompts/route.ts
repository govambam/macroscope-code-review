import { NextRequest, NextResponse } from "next/server";
import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import {
  getLatestPromptVersion,
  savePromptVersion,
  hasDefaultPromptVersions,
  getPromptVersionCount,
  PromptVersionRecord,
} from "@/lib/services/database";
import { DEFAULT_MODEL } from "@/lib/config/models";

interface VersionInfo {
  currentVersion: number;
  totalVersions: number;
  lastEditedBy: string | null;
  lastEditedAt: string | null;
  isDefault: boolean;
  model: string;
}

interface GetPromptsResponse {
  success: boolean;
  prompts?: {
    prAnalysis: string;
    emailGeneration: string;
  };
  versions?: {
    prAnalysis: VersionInfo;
    emailGeneration: VersionInfo;
  };
  error?: string;
}

interface UpdatePromptRequest {
  type: "pr-analysis" | "email-generation";
  content: string;
  userId?: number;
  model?: string;
}

interface UpdatePromptResponse {
  success: boolean;
  versionId?: number;
  error?: string;
}

const PROMPTS_DIR = join(process.cwd(), "prompts");

/**
 * Seed default prompt versions from files if not already done.
 */
async function seedDefaultVersionsIfNeeded(): Promise<void> {
  const hasDefaults = await hasDefaultPromptVersions();
  if (hasDefaults) return;

  // Read original prompts from files
  const [prAnalysisContent, emailGenerationContent] = await Promise.all([
    readFile(join(PROMPTS_DIR, "pr-analysis.md"), "utf-8"),
    readFile(join(PROMPTS_DIR, "email-generation.md"), "utf-8"),
  ]);

  // Save as default versions (null user = system, default model)
  await savePromptVersion("pr-analysis", prAnalysisContent, null, true, DEFAULT_MODEL);
  await savePromptVersion("email-generation", emailGenerationContent, null, true, DEFAULT_MODEL);
}

/**
 * Get version info for a prompt type.
 */
async function getVersionInfo(
  promptType: "pr-analysis" | "email-generation",
  latestVersion: PromptVersionRecord | null
): Promise<VersionInfo> {
  const totalVersions = await getPromptVersionCount(promptType);

  if (!latestVersion) {
    return {
      currentVersion: 0,
      totalVersions: 0,
      lastEditedBy: null,
      lastEditedAt: null,
      isDefault: true,
      model: DEFAULT_MODEL,
    };
  }

  return {
    currentVersion: totalVersions, // Latest version is the highest number
    totalVersions,
    lastEditedBy: latestVersion.edited_by_user_name || (latestVersion.is_default ? "System" : null),
    lastEditedAt: latestVersion.created_at,
    isDefault: latestVersion.is_default,
    model: latestVersion.model || DEFAULT_MODEL,
  };
}

/**
 * GET /api/settings/prompts
 * Returns all prompts with version info.
 */
export async function GET(): Promise<NextResponse<GetPromptsResponse>> {
  try {
    // Ensure default versions are seeded
    await seedDefaultVersionsIfNeeded();

    // Get latest versions from database
    const [prAnalysisVersion, emailGenerationVersion] = await Promise.all([
      getLatestPromptVersion("pr-analysis"),
      getLatestPromptVersion("email-generation"),
    ]);

    // If no versions in database, fall back to files
    let prAnalysisContent: string;
    let emailGenerationContent: string;

    if (prAnalysisVersion) {
      prAnalysisContent = prAnalysisVersion.content;
    } else {
      prAnalysisContent = await readFile(join(PROMPTS_DIR, "pr-analysis.md"), "utf-8");
    }

    if (emailGenerationVersion) {
      emailGenerationContent = emailGenerationVersion.content;
    } else {
      emailGenerationContent = await readFile(join(PROMPTS_DIR, "email-generation.md"), "utf-8");
    }

    // Get version info
    const [prAnalysisInfo, emailGenerationInfo] = await Promise.all([
      getVersionInfo("pr-analysis", prAnalysisVersion),
      getVersionInfo("email-generation", emailGenerationVersion),
    ]);

    return NextResponse.json({
      success: true,
      prompts: {
        prAnalysis: prAnalysisContent,
        emailGeneration: emailGenerationContent,
      },
      versions: {
        prAnalysis: prAnalysisInfo,
        emailGeneration: emailGenerationInfo,
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Failed to read prompts:", errorMessage);
    return NextResponse.json(
      { success: false, error: `Failed to read prompts: ${errorMessage}` },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/settings/prompts
 * Updates a prompt and creates a new version.
 */
export async function PUT(request: NextRequest): Promise<NextResponse<UpdatePromptResponse>> {
  try {
    const body: UpdatePromptRequest = await request.json();
    const { type, content, userId, model } = body;

    if (!type || !["pr-analysis", "email-generation"].includes(type)) {
      return NextResponse.json(
        { success: false, error: "Invalid prompt type" },
        { status: 400 }
      );
    }

    if (!content || !content.trim()) {
      return NextResponse.json(
        { success: false, error: "Content is required" },
        { status: 400 }
      );
    }

    // Ensure default versions exist
    await seedDefaultVersionsIfNeeded();

    // Save new version to database with model selection
    const versionId = await savePromptVersion(
      type as "pr-analysis" | "email-generation",
      content,
      userId ?? null,
      false,
      model ?? DEFAULT_MODEL
    );

    // Also update the file for backwards compatibility
    const filename = `${type}.md`;
    await writeFile(join(PROMPTS_DIR, filename), content, "utf-8");

    return NextResponse.json({ success: true, versionId });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Failed to update prompt:", errorMessage);
    return NextResponse.json(
      { success: false, error: `Failed to update prompt: ${errorMessage}` },
      { status: 500 }
    );
  }
}
