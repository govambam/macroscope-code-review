import { NextRequest, NextResponse } from "next/server";
import { generateCodeImage, isCodeImageGenerationAvailable } from "@/lib/services/code-image";

interface GenerateCodeImageRequest {
  codeSuggestion: string;
  filePath: string;
}

interface GenerateCodeImageResponse {
  success: boolean;
  url?: string;
  error?: string;
}

/**
 * POST /api/generate-code-image
 *
 * Generates a syntax-highlighted PNG image from a code suggestion,
 * uploads it to R2, and returns the public URL.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    if (!isCodeImageGenerationAvailable()) {
      return NextResponse.json<GenerateCodeImageResponse>(
        { success: false, error: "Code image generation is not configured (R2 storage missing)" },
        { status: 500 }
      );
    }

    const body: GenerateCodeImageRequest = await request.json();

    if (!body.codeSuggestion || typeof body.codeSuggestion !== "string") {
      return NextResponse.json<GenerateCodeImageResponse>(
        { success: false, error: "codeSuggestion is required" },
        { status: 400 }
      );
    }

    const ext = (body.filePath || "").split(".").pop()?.toLowerCase() || "js";
    const langMap: Record<string, string> = {
      ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
      py: "python", rb: "ruby", go: "go", rs: "rust", java: "java",
      cs: "csharp", cpp: "cpp", c: "c", php: "php", swift: "swift",
    };
    const language = langMap[ext] || ext;

    const imageResult = await generateCodeImage({
      code: body.codeSuggestion,
      language,
      prId: `regen-${Date.now()}`,
    });

    if (!imageResult.success) {
      return NextResponse.json<GenerateCodeImageResponse>(
        { success: false, error: imageResult.error || "Image generation failed" },
        { status: 500 }
      );
    }

    return NextResponse.json<GenerateCodeImageResponse>({
      success: true,
      url: imageResult.url,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Code image generation error:", errorMessage);
    return NextResponse.json<GenerateCodeImageResponse>(
      { success: false, error: `Code image generation failed: ${errorMessage}` },
      { status: 500 }
    );
  }
}
