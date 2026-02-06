import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { promises as fs } from "fs";
import path from "path";
import type { ParsedSignupData, SignupLLMFields, GenerateSignupEmailResponse } from "@/lib/types/signup-lead";
import type { ConnectionMatch } from "@/lib/constants/macroscope-team";

interface GenerateRequest {
  prospectData: ParsedSignupData;
  connectionMatches: ConnectionMatch[];
}

/**
 * POST /api/generate-signup-email
 *
 * Generates personalized email fields for signup outreach using Claude.
 * Takes prospect data and connection matches, returns CONNECTION_BLURB, LOCATION_INVITE, SWAG_OFFER.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json<GenerateSignupEmailResponse>(
        { success: false, error: "ANTHROPIC_API_KEY is not configured" },
        { status: 500 }
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json<GenerateSignupEmailResponse>(
        { success: false, error: "Invalid JSON in request body" },
        { status: 400 }
      );
    }

    if (!body || typeof body !== "object") {
      return NextResponse.json<GenerateSignupEmailResponse>(
        { success: false, error: "Request body must be a JSON object" },
        { status: 400 }
      );
    }

    const { prospectData, connectionMatches } = body as GenerateRequest;

    if (!prospectData || typeof prospectData !== "object") {
      return NextResponse.json<GenerateSignupEmailResponse>(
        { success: false, error: "prospectData is required" },
        { status: 400 }
      );
    }

    // Load the prompt template
    const promptPath = path.join(process.cwd(), "prompts", "signup-email-personalization.md");
    let promptTemplate: string;
    try {
      promptTemplate = await fs.readFile(promptPath, "utf-8");
    } catch {
      return NextResponse.json<GenerateSignupEmailResponse>(
        { success: false, error: "Failed to load prompt template" },
        { status: 500 }
      );
    }

    // Extract model from prompt
    const modelMatch = promptTemplate.match(/Model:\s*(\S+)/i);
    const model = modelMatch ? modelMatch[1] : "claude-haiku-4-5-20251001";

    // Format prospect data for the prompt
    const prospectDataStr = JSON.stringify(prospectData, null, 2);

    // Format connection matches for the prompt
    const connectionMatchesStr = connectionMatches && connectionMatches.length > 0
      ? JSON.stringify(connectionMatches, null, 2)
      : "No connection matches found.";

    // Build the prompt
    const prompt = promptTemplate
      .replace("{PROSPECT_DATA}", prospectDataStr)
      .replace("{CONNECTION_MATCHES}", connectionMatchesStr);

    // Extract just the user prompt part (after the first ---)
    const promptParts = prompt.split("---");
    const userPrompt = promptParts.slice(1).join("---").trim();

    // Initialize Anthropic client
    const anthropic = new Anthropic({ apiKey });

    const response = await anthropic.messages.create({
      model,
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: userPrompt,
        },
      ],
    });

    // Extract the response text
    const responseText =
      response.content[0].type === "text" ? response.content[0].text : "";

    // Parse the JSON response
    let fields: SignupLLMFields = {};
    try {
      // Try to extract JSON from the response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        fields = {
          CONNECTION_BLURB: parsed.CONNECTION_BLURB || "",
          LOCATION_INVITE: parsed.LOCATION_INVITE || "",
          SWAG_OFFER: parsed.SWAG_OFFER || "",
        };
      }
    } catch (parseError) {
      console.error("Failed to parse LLM response:", responseText);
      return NextResponse.json<GenerateSignupEmailResponse>(
        { success: false, error: "Failed to parse personalization fields from LLM" },
        { status: 500 }
      );
    }

    return NextResponse.json<GenerateSignupEmailResponse>({
      success: true,
      fields,
    });
  } catch (error) {
    console.error("Generate signup email error:", error);

    const errorMessage = error instanceof Error ? error.message : String(error);

    if (errorMessage.includes("rate limit")) {
      return NextResponse.json<GenerateSignupEmailResponse>(
        { success: false, error: "API rate limit reached. Please try again in a moment." },
        { status: 429 }
      );
    }

    return NextResponse.json<GenerateSignupEmailResponse>(
      { success: false, error: `Failed to generate email: ${errorMessage}` },
      { status: 500 }
    );
  }
}
