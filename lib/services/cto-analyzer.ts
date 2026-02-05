import { loadPrompt, getPromptMetadata } from "./prompt-loader";
import { sendMessageAndParseJSON, DEFAULT_MODEL } from "./anthropic";
import type { AnalysisComment } from "./pr-analyzer";
import type { CTOPerspective, CTOAnalysisResult } from "@/lib/types/prospector-analysis";

/**
 * Raw response from Claude for CTO perspective analysis.
 */
interface CTOAnalysisRawResponse {
  perspectives: Record<string, {
    outreach_score: number;
    outreach_reasoning: string;
    cto_would_care: boolean;
    talking_point: string;
    is_recommended: boolean;
    recommendation_summary?: string;
  }>;
  best_bug_index: number | null;
  overall_recommendation: string;
}

/**
 * Analyzes bugs from a CTO perspective for outreach suitability.
 *
 * @param comments - Array of AnalysisComment objects to evaluate
 * @returns CTOAnalysisResult with perspectives for each comment
 */
export async function analyzeCTOPerspective(
  comments: AnalysisComment[]
): Promise<CTOAnalysisResult> {
  // Filter to only meaningful bugs for efficiency
  const meaningfulBugs = comments.filter(c => c.is_meaningful_bug);

  if (meaningfulBugs.length === 0) {
    return {
      perspectives: {},
      best_bug_index: null,
      overall_recommendation: "No meaningful bugs found for outreach evaluation.",
      analysis_timestamp: new Date().toISOString(),
    };
  }

  // Prepare simplified comment data for the prompt
  const commentsForPrompt = meaningfulBugs.map(c => ({
    index: c.index,
    file_path: c.file_path,
    category: c.category,
    title: c.title,
    explanation: c.explanation,
    code_suggestion: c.code_suggestion,
    outreach_ready: c.outreach_ready,
    outreach_skip_reason: c.outreach_skip_reason,
  }));

  const prompt = loadPrompt("cto-perspective", {
    COMMENTS_JSON: JSON.stringify(commentsForPrompt, null, 2),
  });

  const metadata = getPromptMetadata("cto-perspective");
  const model = metadata.model || DEFAULT_MODEL;

  const rawResult = await sendMessageAndParseJSON<CTOAnalysisRawResponse>(prompt, {
    model,
    maxTokens: 4096,
    temperature: 0,
  });

  // Convert string keys to numbers and validate outreach_score
  const perspectives: Record<number, CTOPerspective> = {};
  for (const [key, value] of Object.entries(rawResult.perspectives)) {
    const numericKey = parseInt(key, 10);
    perspectives[numericKey] = {
      outreach_score: Math.min(5, Math.max(1, value.outreach_score)) as 1 | 2 | 3 | 4 | 5,
      outreach_reasoning: value.outreach_reasoning,
      cto_would_care: value.cto_would_care,
      talking_point: value.talking_point,
      is_recommended: value.is_recommended,
      recommendation_summary: value.recommendation_summary,
    };
  }

  return {
    perspectives,
    best_bug_index: rawResult.best_bug_index,
    overall_recommendation: rawResult.overall_recommendation,
    analysis_timestamp: new Date().toISOString(),
  };
}
