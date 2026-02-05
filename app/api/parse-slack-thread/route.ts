import { NextRequest, NextResponse } from "next/server";
import { parseSlackSignupThread } from "@/lib/services/slack-thread-parser";
import type { ParseSlackThreadResponse } from "@/lib/types/signup-lead";

interface ParseSlackThreadRequest {
  rawThread: string;
}

/**
 * POST /api/parse-slack-thread
 *
 * Parses a Slack signup notification thread and extracts structured lead data.
 * Uses Claude (Haiku) to intelligently extract information from the unstructured text.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    if (!body || typeof body !== "object") {
      return NextResponse.json<ParseSlackThreadResponse>(
        { success: false, error: "Request body must be a JSON object" },
        { status: 400 }
      );
    }
    const { rawThread } = body as ParseSlackThreadRequest;

    if (!rawThread || typeof rawThread !== "string") {
      return NextResponse.json<ParseSlackThreadResponse>(
        { success: false, error: "rawThread is required and must be a string" },
        { status: 400 }
      );
    }

    if (rawThread.trim().length < 50) {
      return NextResponse.json<ParseSlackThreadResponse>(
        { success: false, error: "Thread content is too short. Please paste the full Slack thread." },
        { status: 400 }
      );
    }

    const parsedData = await parseSlackSignupThread(rawThread);

    return NextResponse.json<ParseSlackThreadResponse>({
      success: true,
      data: parsedData,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Parse Slack thread error:", errorMessage);

    if (errorMessage.includes("rate limit")) {
      return NextResponse.json<ParseSlackThreadResponse>(
        { success: false, error: "API rate limit reached. Please try again in a moment." },
        { status: 429 }
      );
    }

    if (errorMessage.includes("ANTHROPIC_API_KEY")) {
      return NextResponse.json<ParseSlackThreadResponse>(
        { success: false, error: "Anthropic API key is not configured" },
        { status: 500 }
      );
    }

    return NextResponse.json<ParseSlackThreadResponse>(
      { success: false, error: `Failed to parse thread: ${errorMessage}` },
      { status: 500 }
    );
  }
}
