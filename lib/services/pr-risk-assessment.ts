import { sendMessageAndParseJSON } from "@/lib/services/anthropic";
import { loadPrompt, getPromptMetadata } from "@/lib/services/prompt-loader";

export interface FileInfo {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
}

interface RiskAssessmentResult {
  assessment: string;
  categories: string[];
}

export async function assessPRRisk(
  prTitle: string,
  totalLinesChanged: number,
  files: FileInfo[]
): Promise<{ assessment: string; categories: string[] }> {
  const fileList = files
    .slice(0, 50) // Limit to 50 files to manage token usage
    .map((f) => `- ${f.filename} (+${f.additions}/-${f.deletions})`)
    .join("\n");

  // Load prompt from database/filesystem (editable in Settings)
  const prompt = loadPrompt("discover-scoring", {
    PR_TITLE: prTitle,
    TOTAL_LINES: String(totalLinesChanged),
    FILES_LIST: fileList,
  });

  // Get model from prompt metadata, fallback to default
  const metadata = getPromptMetadata("discover-scoring");
  const model = metadata.model || "claude-sonnet-4-20250514";

  try {
    const result = await sendMessageAndParseJSON<RiskAssessmentResult>(prompt, {
      model,
      maxTokens: 500,
      temperature: 0,
    });

    return {
      assessment: result.assessment || "Unable to assess",
      categories: Array.isArray(result.categories) ? result.categories : [],
    };
  } catch (error) {
    console.error("Risk assessment failed:", error);
    return { assessment: "Unable to assess", categories: [] };
  }
}
