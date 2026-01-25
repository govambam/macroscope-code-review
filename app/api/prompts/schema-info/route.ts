import { NextRequest, NextResponse } from "next/server";
import {
  getPromptSchemaInfo,
  PromptSchemaInfo,
} from "@/lib/schemas/prompt-schemas";

/**
 * GET /api/prompts/schema-info?type=<prompt-type>
 *
 * Returns information about the expected output schema for a prompt type.
 * This helps users understand what fields are required and what the code expects.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const promptType = request.nextUrl.searchParams.get("type");

  if (!promptType) {
    return NextResponse.json(
      { error: "Missing 'type' query parameter" },
      { status: 400 }
    );
  }

  const schemaInfo = getPromptSchemaInfo(promptType);

  if (!schemaInfo.hasSchema) {
    return NextResponse.json<PromptSchemaInfo & { warning: string }>({
      ...schemaInfo,
      warning: `No schema defined for prompt type "${promptType}". The code may not validate the output.`,
    });
  }

  return NextResponse.json<PromptSchemaInfo>(schemaInfo);
}
