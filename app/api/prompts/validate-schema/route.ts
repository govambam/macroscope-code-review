import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import {
  getPromptSchema,
  schemaToDescription,
  getAllFieldPaths,
  SchemaValidationResult,
} from "@/lib/schemas/prompt-schemas";

interface ValidateSchemaRequest {
  promptType: string;
  promptContent: string;
}

/**
 * POST /api/prompts/validate-schema
 *
 * Validates that a prompt's output schema is compatible with what the code expects.
 * Uses Claude to extract the schema from the prompt and compare it against the expected schema.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();

    // Validate that body is a non-null object before destructuring
    if (typeof body !== "object" || body === null) {
      return NextResponse.json<SchemaValidationResult>(
        {
          compatible: true,
          warnings: ["Invalid request body"],
        },
        { status: 400 }
      );
    }

    const { promptType, promptContent } = body as ValidateSchemaRequest;

    if (!promptType || !promptContent || typeof promptType !== "string" || typeof promptContent !== "string") {
      return NextResponse.json<SchemaValidationResult>(
        {
          compatible: true,
          warnings: ["Missing prompt type or content"],
        },
        { status: 400 }
      );
    }

    // Get the expected schema for this prompt type
    const expectedSchema = getPromptSchema(promptType);
    if (!expectedSchema) {
      return NextResponse.json<SchemaValidationResult>({
        compatible: true,
        warnings: ["No schema defined for this prompt type - cannot validate compatibility"],
        summary: "No expected schema found. Save will proceed without validation.",
      });
    }

    // Check if this is a plain text output schema (like email generation)
    const isPlainTextSchema = expectedSchema instanceof z.ZodString;

    const expectedSchemaDescription = schemaToDescription(expectedSchema);
    const expectedFieldPaths = isPlainTextSchema ? [] : getAllFieldPaths(expectedSchema);

    // Check for Anthropic API key
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json<SchemaValidationResult>({
        compatible: true,
        warnings: ["ANTHROPIC_API_KEY not configured - cannot validate schema"],
        summary: "Schema validation unavailable. Save will proceed without validation.",
      });
    }

    const anthropic = new Anthropic({ apiKey });

    // Use different validation prompts for JSON vs plain text output
    const validationPrompt = isPlainTextSchema
      ? `You are a prompt output format analyzer. I need you to verify that a prompt produces plain text output (not JSON).

## Expected Output Format
The application code expects this prompt to produce **plain text output**, not JSON.
${(expectedSchema as z.ZodString).description ? `Expected format: ${(expectedSchema as z.ZodString).description}` : ""}

## Prompt Being Saved
\`\`\`
${promptContent.slice(0, 10000)}${promptContent.length > 10000 ? "\n... (truncated)" : ""}
\`\`\`

## Your Task
1. Check if the prompt instructs the LLM to produce plain text output (not JSON)
2. Verify the output format matches expectations (e.g., email format, specific structure)
3. Identify any issues

## Compatible If:
- Prompt asks for plain text output (email, message, etc.)
- Output format matches the expected description
- No JSON wrapper is requested

## NOT Compatible If:
- Prompt asks for JSON output when plain text is expected
- Output format doesn't match expectations

## Response Format
Respond with ONLY valid JSON, no markdown fences:
{
  "compatible": true | false,
  "warnings": ["Any concerns about the output format"],
  "summary": "One sentence summary of compatibility status"
}`
      : `You are a JSON schema analyzer. I need you to compare two schemas and identify breaking changes.

## Expected Schema (what the code requires)
The application code expects the prompt to produce JSON output matching this schema:
\`\`\`json
${expectedSchemaDescription}
\`\`\`

Expected field paths: ${expectedFieldPaths.join(", ")}

## Prompt Being Saved
The user is trying to save this prompt. Extract the JSON schema it defines by looking for:
- Response Format sections
- JSON examples with field names
- Field definitions and descriptions
- Output structure documentation

\`\`\`
${promptContent.slice(0, 10000)}${promptContent.length > 10000 ? "\n... (truncated)" : ""}
\`\`\`

## Your Task
1. Extract the JSON output schema that this prompt instructs the LLM to produce
2. Compare it to the expected schema above
3. Identify any breaking changes

## Breaking Changes Include:
- Missing required fields (field exists in expected schema but not defined in prompt)
- Type changes (e.g., field expected as string but prompt asks for number)
- Renamed fields (similar name but different key)
- Structural changes (e.g., flat field changed to nested object, or vice versa)
- Missing nested fields (e.g., summary.recommendation missing)

## NOT Breaking Changes:
- Additional fields in the prompt (code will ignore extra fields)
- More detailed descriptions or examples
- Different formatting of the prompt text itself
- Reordering of fields

## Response Format
Respond with ONLY valid JSON, no markdown fences:
{
  "compatible": true | false,
  "extracted_fields": ["list", "of", "field", "paths", "found", "in", "prompt"],
  "missing_fields": ["field", "paths", "expected", "but", "not", "found"],
  "type_mismatches": [
    {"field": "field_path", "expected": "expected_type", "found": "found_type"}
  ],
  "renamed_fields": [
    {"expected": "expected_name", "found": "found_name", "confidence": "high|medium|low"}
  ],
  "warnings": ["Any other concerns about the schema"],
  "summary": "One sentence summary of compatibility status"
}`;

    // Use Claude to extract and compare schemas
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2048,
      temperature: 0,
      messages: [
        {
          role: "user",
          content: validationPrompt,
        },
      ],
    });

    // Extract text response
    const content = response.content[0];
    if (content.type !== "text") {
      throw new Error("Unexpected response type from Claude");
    }

    // Parse Claude's JSON response
    let jsonText = content.text.trim();

    // Handle potential markdown code blocks
    const jsonMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      jsonText = jsonMatch[1].trim();
    }

    // Find the JSON object in the response
    const firstBrace = jsonText.indexOf("{");
    const lastBrace = jsonText.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1) {
      jsonText = jsonText.slice(firstBrace, lastBrace + 1);
    }

    const analysis = JSON.parse(jsonText) as SchemaValidationResult;

    return NextResponse.json<SchemaValidationResult>(analysis);
  } catch (error) {
    console.error("Schema validation error:", error);

    // Fail open - allow save if validation fails
    return NextResponse.json<SchemaValidationResult>({
      compatible: true,
      warnings: ["Schema validation failed - proceeding without validation"],
      error: error instanceof Error ? error.message : "Unknown error",
      summary: "Validation error occurred. Save will proceed without validation.",
    });
  }
}
