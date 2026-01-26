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

// Batch scoring types for advanced search reranking
export interface PRForScoring {
  number: number;
  title: string;
  files: Array<{ filename: string; additions: number; deletions: number }>;
}

export interface PRBatchScoreResult {
  pr_number: number;
  bug_likelihood_score: number;  // 1-10
  risk_reason: string;           // Brief explanation
  risk_categories: string[];     // e.g., ['auth', 'concurrency']
}

interface BatchScoreResponse {
  scores: Array<{
    pr_number: number;
    score: number;
    reason: string;
    categories?: string[];
  }>;
}

/**
 * Batch score multiple PRs for bug likelihood using LLM.
 * Used in Advanced search mode to rerank PRs.
 */
export async function batchScorePRsForBugLikelihood(
  prs: PRForScoring[],
  promptTemplate: string
): Promise<PRBatchScoreResult[]> {
  // Build PR descriptions for the prompt
  const prDescriptions = prs.map((pr, index) => {
    const fileList = pr.files
      .slice(0, 15)  // Limit files per PR to manage tokens
      .map(f => `   ${f.filename} (+${f.additions}, -${f.deletions})`)
      .join('\n');

    return `${index + 1}. PR #${pr.number}: "${pr.title}"\n   Files:\n${fileList}`;
  }).join('\n\n');

  // Interpolate the prompt template
  const prompt = promptTemplate.replace('{PR_DESCRIPTIONS}', prDescriptions);

  try {
    const result = await sendMessageAndParseJSON<BatchScoreResponse>(prompt, {
      model: "claude-sonnet-4-20250514",
      maxTokens: 2500,
      temperature: 0,
    });

    if (!result.scores || !Array.isArray(result.scores)) {
      throw new Error("Invalid response format: missing scores array");
    }

    return result.scores.map((s) => ({
      pr_number: s.pr_number,
      bug_likelihood_score: Math.max(1, Math.min(10, s.score)), // Clamp to 1-10
      risk_reason: s.reason || "No reason provided",
      risk_categories: Array.isArray(s.categories) ? s.categories : []
    }));
  } catch (error) {
    console.error("Batch PR scoring failed:", error);
    throw error; // Let caller handle fallback
  }
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
