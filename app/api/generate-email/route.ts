import { NextRequest, NextResponse } from "next/server";
import { generateEmail, EmailGenerationInput } from "@/lib/services/email-generator";
import { BugSnippet } from "@/lib/services/pr-analyzer";
import { saveGeneratedEmail } from "@/lib/services/database";

interface GenerateEmailRequest {
  originalPrUrl: string; // URL to their original PR in their repo
  prTitle?: string;
  forkedPrUrl: string; // URL to our fork with Macroscope review
  bug: BugSnippet;
  totalBugs: number;
  analysisId?: number; // Database ID of the analysis to link this email to
}

interface GenerateEmailResponse {
  success: boolean;
  email?: string;
  error?: string;
  emailId?: number; // Database ID of the saved email
}

/**
 * POST /api/generate-email
 *
 * Generates an outreach email based on bug analysis results.
 * The email will contain Attio merge fields for personalization.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // Check for required environment variables
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

    // Validate required fields
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

    // Generate the email (with Attio merge fields for personalization)
    const input: EmailGenerationInput = {
      originalPrUrl: body.originalPrUrl,
      prTitle: body.prTitle,
      forkedPrUrl: body.forkedPrUrl,
      bug: body.bug,
      totalBugs: body.totalBugs || 1,
    };

    const email = await generateEmail(input);

    // Save email to database if we have an analysis ID
    // Use placeholder values since we're using Attio merge fields
    let emailId: number | undefined;
    if (body.analysisId) {
      try {
        emailId = saveGeneratedEmail(
          body.analysisId,
          "{ First Name }", // Attio merge field
          null,
          "{ Company Name }", // Attio merge field
          "{ Sender Name }", // Attio merge field
          email
        );
      } catch (dbError) {
        console.error("Failed to save email to database:", dbError);
        // Continue anyway - email was still generated successfully
      }
    }

    return NextResponse.json<GenerateEmailResponse>({
      success: true,
      email,
      emailId,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Email generation error:", errorMessage);

    // Check for specific error types
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
