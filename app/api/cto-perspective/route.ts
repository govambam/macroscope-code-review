import { NextRequest, NextResponse } from "next/server";
import { analyzeCTOPerspective } from "@/lib/services/cto-analyzer";
import {
  getCTOPerspective,
  saveCTOPerspective,
  getAnalysisById,
} from "@/lib/services/database";
import { isV2AnalysisResult, PRAnalysisResultV2 } from "@/lib/services/pr-analyzer";
import type { CTOAnalysisResult, CTOAnalysisApiResponse } from "@/lib/types/prospector-analysis";

interface CTOPerspectiveRequest {
  analysisId: number;
  forceRefresh?: boolean;
  cacheOnly?: boolean;
}

/**
 * POST /api/cto-perspective
 *
 * Analyzes bugs from a CTO perspective for outreach suitability.
 * Returns cached result if available, otherwise runs Claude analysis.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body: CTOPerspectiveRequest = await request.json();
    const { analysisId, forceRefresh, cacheOnly } = body;

    if (!analysisId || typeof analysisId !== "number") {
      return NextResponse.json<CTOAnalysisApiResponse>(
        { success: false, error: "analysisId is required" },
        { status: 400 }
      );
    }

    // Check cache first
    if (!forceRefresh) {
      const cached = getCTOPerspective(analysisId);
      if (cached) {
        try {
          const result = JSON.parse(cached) as CTOAnalysisResult;
          return NextResponse.json<CTOAnalysisApiResponse>({
            success: true,
            result,
            cached: true,
          });
        } catch {
          // Invalid cached data, continue to regenerate
          console.warn("Invalid cached CTO perspective, regenerating");
        }
      }
    }

    // If cacheOnly mode, return success with no result (not an error)
    if (cacheOnly) {
      return NextResponse.json<CTOAnalysisApiResponse>({
        success: true,
        cached: false,
      });
    }

    // Get the analysis to access comments
    const analysis = getAnalysisById(analysisId);
    if (!analysis) {
      return NextResponse.json<CTOAnalysisApiResponse>(
        { success: false, error: "Analysis not found" },
        { status: 404 }
      );
    }

    // Parse analysis JSON
    let analysisResult: PRAnalysisResultV2;
    try {
      const parsed = JSON.parse(analysis.analysis_json);
      if (!isV2AnalysisResult(parsed)) {
        return NextResponse.json<CTOAnalysisApiResponse>(
          { success: false, error: "CTO perspective requires V2 analysis format" },
          { status: 400 }
        );
      }
      analysisResult = parsed;
    } catch {
      return NextResponse.json<CTOAnalysisApiResponse>(
        { success: false, error: "Failed to parse analysis data" },
        { status: 500 }
      );
    }

    // Run CTO analysis
    const result = await analyzeCTOPerspective(analysisResult.all_comments);

    // Cache result
    saveCTOPerspective(analysisId, JSON.stringify(result));

    return NextResponse.json<CTOAnalysisApiResponse>({
      success: true,
      result,
      cached: false,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("CTO perspective analysis error:", errorMessage);

    if (errorMessage.includes("rate limit")) {
      return NextResponse.json<CTOAnalysisApiResponse>(
        { success: false, error: "API rate limit reached. Please try again in a moment." },
        { status: 429 }
      );
    }

    if (errorMessage.includes("ANTHROPIC_API_KEY")) {
      return NextResponse.json<CTOAnalysisApiResponse>(
        { success: false, error: "Anthropic API key is not configured" },
        { status: 500 }
      );
    }

    return NextResponse.json<CTOAnalysisApiResponse>(
      { success: false, error: `CTO perspective analysis failed: ${errorMessage}` },
      { status: 500 }
    );
  }
}
