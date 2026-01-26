import { sendMessageAndParseJSON } from "@/lib/services/anthropic";

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

  const prompt = `Assess the bug risk of this pull request based on the files changed.

PR Title: "${prTitle}"
Total lines changed: ${totalLinesChanged}

Files changed:
${fileList}

Respond with JSON only:
{
  "assessment": "2-3 sentence explanation of what this PR does and why it might contain bugs worth catching. Focus on specific risks like concurrency issues, error handling gaps, security concerns, data integrity, etc. If this looks low-risk (docs, config, tests only), say so.",
  "categories": ["list", "of", "risk", "categories"]
}

Risk categories to choose from: concurrency, auth, security, data-handling, error-handling, state-management, api-changes, database, caching, serialization, networking, core-logic, refactor, new-feature, config, tests, docs, low-risk

Return 1-4 most relevant categories.`;

  try {
    const result = await sendMessageAndParseJSON<RiskAssessmentResult>(prompt, {
      model: "claude-sonnet-4-20250514",
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
