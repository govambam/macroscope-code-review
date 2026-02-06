import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { promises as fs } from "fs";
import path from "path";
import type { WorkHistoryEntry } from "@/lib/constants/macroscope-team";

interface ParseLinkedInResponse {
  success: boolean;
  workHistory?: WorkHistoryEntry[];
  error?: string;
}

/**
 * POST /api/parse-linkedin-profile
 *
 * Parses a LinkedIn profile to extract work history.
 * Accepts either:
 * - JSON body with { text: string } for pasted content
 * - FormData with file (PDF) upload
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json<ParseLinkedInResponse>(
        { success: false, error: "ANTHROPIC_API_KEY is not configured" },
        { status: 500 }
      );
    }

    let profileContent: string;
    let isPdf = false;

    // Check content type to determine how to parse the request
    const contentType = request.headers.get("content-type") || "";

    if (contentType.includes("multipart/form-data")) {
      // Handle file upload
      const formData = await request.formData();
      const file = formData.get("file") as File | null;

      if (!file || !(file instanceof File)) {
        return NextResponse.json<ParseLinkedInResponse>(
          { success: false, error: "No file provided or invalid file field" },
          { status: 400 }
        );
      }

      // Check if it's a PDF
      if (file.type === "application/pdf") {
        isPdf = true;
        // For PDF, we'll send the base64 content to Claude
        const arrayBuffer = await file.arrayBuffer();
        const base64 = Buffer.from(arrayBuffer).toString("base64");
        profileContent = base64;
      } else {
        // For text files, read as text
        profileContent = await file.text();
      }
    } else {
      // Handle JSON body with text content
      const body = await request.json();
      if (!body || typeof body !== "object") {
        return NextResponse.json<ParseLinkedInResponse>(
          { success: false, error: "Request body must be a JSON object" },
          { status: 400 }
        );
      }

      const { text } = body;
      if (!text || typeof text !== "string" || text.trim().length < 20) {
        return NextResponse.json<ParseLinkedInResponse>(
          { success: false, error: "Profile content is required (minimum 20 characters)" },
          { status: 400 }
        );
      }

      profileContent = text.trim();
    }

    // Load the prompt template
    const promptPath = path.join(process.cwd(), "prompts", "parse-linkedin-profile.md");
    let promptTemplate: string;
    try {
      promptTemplate = await fs.readFile(promptPath, "utf-8");
    } catch {
      return NextResponse.json<ParseLinkedInResponse>(
        { success: false, error: "Failed to load prompt template" },
        { status: 500 }
      );
    }

    // Extract model from prompt
    const modelMatch = promptTemplate.match(/Model:\s*(\S+)/i);
    const model = modelMatch ? modelMatch[1] : "claude-haiku-4-5-20251001";

    // Initialize Anthropic client
    const anthropic = new Anthropic({ apiKey });

    let response;

    if (isPdf) {
      // For PDF, use document processing
      response = await anthropic.messages.create({
        model,
        max_tokens: 2048,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "document",
                source: {
                  type: "base64",
                  media_type: "application/pdf",
                  data: profileContent,
                },
              },
              {
                type: "text",
                text: `Extract the work/employment history from this LinkedIn profile PDF.

For each job, extract:
- company: The company name exactly as shown
- title: The job title
- startDate: Start date (e.g., "Jan 2017")
- endDate: End date (e.g., "Feb 2023" or "Present")

Return ONLY valid JSON with no additional text:

{
  "workHistory": [
    {
      "company": "Company Name",
      "title": "Job Title",
      "startDate": "Start Date",
      "endDate": "End Date"
    }
  ]
}`,
              },
            ],
          },
        ],
      });
    } else {
      // For text content, use the prompt template
      const prompt = promptTemplate.replace("{PROFILE_CONTENT}", () => profileContent);

      // Extract just the user prompt part (after the ---)
      const promptParts = prompt.split("---");
      const userPrompt = promptParts.slice(1).join("---").trim();

      response = await anthropic.messages.create({
        model,
        max_tokens: 2048,
        messages: [
          {
            role: "user",
            content: userPrompt,
          },
        ],
      });
    }

    // Extract the response text
    const responseText =
      response.content[0].type === "text" ? response.content[0].text : "";

    // Parse the JSON response
    let workHistory: WorkHistoryEntry[] = [];
    try {
      // Try to extract JSON from the response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        workHistory = parsed.workHistory || [];
      }
    } catch (parseError) {
      console.error("Failed to parse LinkedIn response:", responseText);
      return NextResponse.json<ParseLinkedInResponse>(
        { success: false, error: "Failed to parse work history from profile" },
        { status: 500 }
      );
    }

    return NextResponse.json<ParseLinkedInResponse>({
      success: true,
      workHistory,
    });
  } catch (error) {
    console.error("Parse LinkedIn profile error:", error);

    const errorMessage = error instanceof Error ? error.message : String(error);

    if (errorMessage.includes("rate limit")) {
      return NextResponse.json<ParseLinkedInResponse>(
        { success: false, error: "API rate limit reached. Please try again in a moment." },
        { status: 429 }
      );
    }

    return NextResponse.json<ParseLinkedInResponse>(
      { success: false, error: `Failed to parse profile: ${errorMessage}` },
      { status: 500 }
    );
  }
}
