import { NextRequest, NextResponse } from "next/server";
import { generateEmail, EmailGenerationInput, EmailSequence } from "@/lib/services/email-generator";
import { BugSnippet } from "@/lib/services/pr-analyzer";
import { saveGeneratedEmail } from "@/lib/services/database";

interface GenerateEmailRequest {
  originalPrUrl: string; // URL to their original PR in their repo
  prTitle?: string;
  prStatus?: "open" | "merged" | "closed"; // Status of the original PR
  prMergedAt?: string | null; // ISO timestamp if merged
  forkedPrUrl: string; // URL to our fork with Macroscope review
  bug: BugSnippet;
  totalBugs: number;
  analysisId?: number; // Database ID of the analysis to link this email to
}

interface GenerateEmailResponse {
  success: boolean;
  email?: EmailSequence;
  error?: string;
  emailId?: number; // Database ID of the saved email
}

/**
 * POST /api/generate-email
 *
 * Generates a 4-email outreach sequence based on bug analysis results.
 * Each email contains Apollo merge fields for personalization ({{first_name}}, {{company}}, etc.)
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

    // Check if PR was closed without merging - warn but still allow email generation
    if (body.prStatus === "closed") {
      console.warn("Generating email for a closed (not merged) PR - outreach may not be relevant");
    }

    // Generate the email sequence (with Apollo merge fields for personalization)
    const input: EmailGenerationInput = {
      originalPrUrl: body.originalPrUrl,
      prTitle: body.prTitle,
      prStatus: body.prStatus,
      prMergedAt: body.prMergedAt,
      forkedPrUrl: body.forkedPrUrl,
      bug: body.bug,
      totalBugs: body.totalBugs || 1,
    };

    const emailSequence = await generateEmail(input);

    // Save email sequence to database if we have an analysis ID
    // Store as JSON string, use placeholder values for Apollo merge fields
    let emailId: number | undefined;
    if (body.analysisId) {
      try {
        emailId = saveGeneratedEmail(
          body.analysisId,
          "{{first_name}}", // Apollo merge field
          null,
          "{{company}}", // Apollo merge field
          "{{sender_first_name}}", // Apollo merge field
          JSON.stringify(emailSequence)
        );
      } catch (dbError) {
        console.error("Failed to save email to database:", dbError);
        // Continue anyway - email was still generated successfully
      }
    }

    return NextResponse.json<GenerateEmailResponse>({
      success: true,
      email: emailSequence,
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
