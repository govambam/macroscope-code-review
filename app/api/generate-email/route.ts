import { NextRequest, NextResponse } from "next/server";
import { generateEmail, EmailBugInput, EmailGenerationResult } from "@/lib/services/email-generator";
import { EmailVariables, EmailSequence } from "@/lib/constants/email-templates";
import { saveGeneratedEmail } from "@/lib/services/database";
import { generateCodeImage, isCodeImageGenerationAvailable } from "@/lib/services/code-image";

interface GenerateEmailRequest {
  originalPrUrl: string;
  prTitle?: string;
  forkedPrUrl: string;
  bug: EmailBugInput;
  analysisId?: number;
}

interface GenerateEmailResponse {
  success: boolean;
  variables?: EmailVariables;
  dbVariables?: EmailGenerationResult["dbVariables"];
  previews?: EmailSequence;
  error?: string;
  emailId?: number;
}

/**
 * POST /api/generate-email
 *
 * Generates email variables by analyzing a Macroscope review comment.
 * Returns LLM-generated variables, DB-sourced variables, and rendered email previews.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json<GenerateEmailResponse>(
        {
          success: false,
          error:
            "ANTHROPIC_API_KEY is not configured. Please add it to your .env.local file.",
        },
        { status: 500 }
      );
    }

    const body: GenerateEmailRequest = await request.json();

    if (!body.originalPrUrl) {
      return NextResponse.json<GenerateEmailResponse>(
        { success: false, error: "originalPrUrl is required" },
        { status: 400 }
      );
    }

    if (!body.forkedPrUrl) {
      return NextResponse.json<GenerateEmailResponse>(
        { success: false, error: "forkedPrUrl is required" },
        { status: 400 }
      );
    }

    if (!body.bug) {
      return NextResponse.json<GenerateEmailResponse>(
        { success: false, error: "bug is required" },
        { status: 400 }
      );
    }

    // Generate code image if missing but code suggestion exists
    if (!body.bug.code_snippet_image_url && body.bug.code_suggestion && isCodeImageGenerationAvailable()) {
      try {
        const ext = body.bug.file_path?.split(".").pop()?.toLowerCase() || "js";
        const langMap: Record<string, string> = {
          ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
          py: "python", rb: "ruby", go: "go", rs: "rust", java: "java",
          cs: "csharp", cpp: "cpp", c: "c", php: "php", swift: "swift",
        };
        const language = langMap[ext] || ext;
        const imageResult = await generateCodeImage({
          code: body.bug.code_suggestion,
          language,
          prId: `email-${Date.now()}`,
        });
        if (imageResult.success) {
          body.bug.code_snippet_image_url = imageResult.url;
          console.log("Generated code image during email generation:", imageResult.url);
        } else {
          console.warn("Code image generation failed:", imageResult.error);
        }
      } catch (imageError) {
        console.error("Failed to generate code image during email generation:", imageError);
      }
    }

    const result = await generateEmail({
      originalPrUrl: body.originalPrUrl,
      prTitle: body.prTitle,
      forkedPrUrl: body.forkedPrUrl,
      bug: body.bug,
    });

    // Save variables to database if we have an analysis ID
    let emailId: number | undefined;
    if (body.analysisId) {
      try {
        emailId = saveGeneratedEmail(
          body.analysisId,
          "{{first_name}}",
          null,
          "{{company}}",
          "{{sender_first_name}}",
          JSON.stringify({ variables: result.variables, dbVariables: result.dbVariables })
        );
      } catch (dbError) {
        console.error("Failed to save email to database:", dbError);
      }
    }

    return NextResponse.json<GenerateEmailResponse>({
      success: true,
      variables: result.variables,
      dbVariables: result.dbVariables,
      previews: result.previews,
      emailId,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Email generation error:", errorMessage);

    if (errorMessage.includes("rate limit")) {
      return NextResponse.json<GenerateEmailResponse>(
        {
          success: false,
          error: "API rate limit reached. Please try again in a few moments.",
        },
        { status: 429 }
      );
    }

    if (errorMessage.includes("ANTHROPIC_API_KEY")) {
      return NextResponse.json<GenerateEmailResponse>(
        { success: false, error: errorMessage },
        { status: 500 }
      );
    }

    return NextResponse.json<GenerateEmailResponse>(
      { success: false, error: `Email generation failed: ${errorMessage}` },
      { status: 500 }
    );
  }
}
