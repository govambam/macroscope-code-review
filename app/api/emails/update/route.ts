import { NextRequest, NextResponse } from "next/server";
import { updateGeneratedEmailByAnalysisId } from "@/lib/services/database";

interface UpdateEmailRequest {
  analysisId: number;
  emailContent: string; // JSON stringified EmailSequence
}

interface UpdateEmailResponse {
  success: boolean;
  error?: string;
}

/**
 * POST /api/emails/update
 *
 * Updates the email content for a given analysis.
 * Used when users edit emails before sending to Apollo/Attio.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    if (!body || typeof body !== "object") {
      return NextResponse.json<UpdateEmailResponse>(
        { success: false, error: "Request body must be a JSON object" },
        { status: 400 }
      );
    }

    const { analysisId, emailContent } = body as UpdateEmailRequest;

    if (!analysisId || typeof analysisId !== "number") {
      return NextResponse.json<UpdateEmailResponse>(
        { success: false, error: "analysisId is required and must be a number" },
        { status: 400 }
      );
    }

    if (!emailContent || typeof emailContent !== "string") {
      return NextResponse.json<UpdateEmailResponse>(
        { success: false, error: "emailContent is required and must be a string" },
        { status: 400 }
      );
    }

    // Validate that emailContent is valid JSON
    try {
      JSON.parse(emailContent);
    } catch {
      return NextResponse.json<UpdateEmailResponse>(
        { success: false, error: "emailContent must be valid JSON" },
        { status: 400 }
      );
    }

    const updated = updateGeneratedEmailByAnalysisId(analysisId, emailContent);

    if (!updated) {
      return NextResponse.json<UpdateEmailResponse>(
        { success: false, error: "No email found for the given analysis ID" },
        { status: 404 }
      );
    }

    return NextResponse.json<UpdateEmailResponse>({
      success: true,
    });
  } catch (error) {
    console.error("Email update error:", error);
    return NextResponse.json<UpdateEmailResponse>(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to update email",
      },
      { status: 500 }
    );
  }
}
