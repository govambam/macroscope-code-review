import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";
import {
  getAllPrompts,
  getPrompt,
  savePrompt,
  PromptRecord,
} from "@/lib/services/database";

interface PromptData {
  name: string;
  content: string;
  model: string | null;
  purpose: string | null;
}

/**
 * Parses a prompt file to extract metadata and content.
 */
function parsePromptFile(content: string): {
  model: string | null;
  purpose: string | null;
  body: string;
} {
  const lines = content.split("\n");
  let model: string | null = null;
  let purpose: string | null = null;
  let headerEnd = 0;

  // Parse header (before first ---)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "---") {
      headerEnd = i;
      break;
    }
    const modelMatch = line.match(/^Model:\s*(.+)/);
    if (modelMatch) {
      model = modelMatch[1].trim();
    }
    const purposeMatch = line.match(/^Purpose:\s*(.+)/);
    if (purposeMatch) {
      purpose = purposeMatch[1].trim();
    }
  }

  // The body is everything after the first ---
  const body = lines.slice(headerEnd + 1).join("\n").trim();

  return { model, purpose, body };
}

/**
 * Formats prompt data back to file format with header.
 */
function formatPromptFile(name: string, data: PromptData): string {
  const title = name
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

  let header = `# ${title} Prompt\n`;
  if (data.model) {
    header += `Model: ${data.model}\n`;
  }
  if (data.purpose) {
    header += `Purpose: ${data.purpose}\n`;
  }
  header += "\n---\n\n";

  return header + data.content;
}

/**
 * Loads prompts from file system and syncs to database if not already present.
 */
function syncPromptsFromFiles(): void {
  const promptsDir = path.join(process.cwd(), "prompts");

  if (!fs.existsSync(promptsDir)) {
    return;
  }

  const files = fs.readdirSync(promptsDir).filter(
    (file) => file.endsWith(".md") && file !== "README.md"
  );

  for (const file of files) {
    const name = file.replace(".md", "");
    const filePath = path.join(promptsDir, file);
    const content = fs.readFileSync(filePath, "utf-8");
    const { model, purpose, body } = parsePromptFile(content);

    // Only save to DB if not already present
    const existing = getPrompt(name);
    if (!existing) {
      savePrompt(name, body, model, purpose);
    }
  }
}

/**
 * GET /api/prompts
 * Returns all prompts from the database.
 * On first load, syncs prompts from files if database is empty.
 */
export async function GET(): Promise<NextResponse> {
  try {
    // Sync from files if database has no prompts
    const existingPrompts = getAllPrompts();
    if (existingPrompts.length === 0) {
      syncPromptsFromFiles();
    }

    const prompts = getAllPrompts();

    // Transform to a more friendly format
    const promptList = prompts.map((p: PromptRecord) => ({
      name: p.name,
      content: p.content,
      model: p.model,
      purpose: p.purpose,
      updatedAt: p.updated_at,
    }));

    // Sort with pr-analysis at the top, then alphabetically
    promptList.sort((a, b) => {
      if (a.name === "pr-analysis") return -1;
      if (b.name === "pr-analysis") return 1;
      return a.name.localeCompare(b.name);
    });

    return NextResponse.json({
      success: true,
      prompts: promptList,
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
 * PUT /api/prompts
 * Updates a prompt in the database.
 */
export async function PUT(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const { name, content, model, purpose } = body as PromptData;

    if (!name || !content) {
      return NextResponse.json(
        { success: false, error: "Name and content are required" },
        { status: 400 }
      );
    }

    // Save to database
    const id = savePrompt(name, content, model, purpose);

    // Also update the file on disk for version control
    const promptsDir = path.join(process.cwd(), "prompts");
    const filePath = path.join(promptsDir, `${name}.md`);
    const fileContent = formatPromptFile(name, { name, content, model, purpose });
    fs.writeFileSync(filePath, fileContent, "utf-8");

    return NextResponse.json({
      success: true,
      id,
      message: `Prompt "${name}" updated successfully`,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 }
    );
  }
}
