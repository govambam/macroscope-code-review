import { NextRequest, NextResponse } from "next/server";
import {
  saveSignupLead,
  getSignupLeadForSession,
  updateSignupLeadParsedData,
  updateSignupLeadEmailVariables,
  updateSignupLeadApolloEnrichment,
  type SignupLeadRecord,
} from "@/lib/services/database";
import type { SignupLeadApiResponse, ParsedSignupData, SignupEmailVariables, ApolloEnrichmentData } from "@/lib/types/signup-lead";

interface CreateSignupLeadRequest {
  sessionId: number;
  rawSlackThread?: string;
  parsedData?: ParsedSignupData;
  emailVariables?: SignupEmailVariables;
}

interface UpdateSignupLeadRequest {
  leadId: number;
  parsedData?: ParsedSignupData;
  emailVariables?: SignupEmailVariables;
  apolloEnrichment?: ApolloEnrichmentData;
}

interface GetSignupLeadRequest {
  sessionId: number;
}

/**
 * POST /api/signup-lead
 *
 * Creates a new signup lead or updates an existing one.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    if (!body || typeof body !== "object") {
      return NextResponse.json<SignupLeadApiResponse>(
        { success: false, error: "Request body must be a JSON object" },
        { status: 400 }
      );
    }
    const { sessionId, rawSlackThread, parsedData, emailVariables } = body as CreateSignupLeadRequest;

    if (!sessionId || typeof sessionId !== "number") {
      return NextResponse.json<SignupLeadApiResponse>(
        { success: false, error: "sessionId is required" },
        { status: 400 }
      );
    }

    const leadId = saveSignupLead(
      sessionId,
      rawSlackThread || null,
      parsedData ? JSON.stringify(parsedData) : null,
      emailVariables ? JSON.stringify(emailVariables) : null
    );

    const lead: SignupLeadRecord = {
      id: leadId,
      session_id: sessionId,
      raw_slack_thread: rawSlackThread || null,
      parsed_data_json: parsedData ? JSON.stringify(parsedData) : null,
      email_variables_json: emailVariables ? JSON.stringify(emailVariables) : null,
      apollo_enrichment_json: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    return NextResponse.json<SignupLeadApiResponse>({
      success: true,
      lead,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Create signup lead error:", errorMessage);

    return NextResponse.json<SignupLeadApiResponse>(
      { success: false, error: `Failed to create signup lead: ${errorMessage}` },
      { status: 500 }
    );
  }
}

/**
 * GET /api/signup-lead?sessionId=123
 *
 * Retrieves the signup lead for a session.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const sessionIdStr = searchParams.get("sessionId");

    if (!sessionIdStr) {
      return NextResponse.json<SignupLeadApiResponse>(
        { success: false, error: "sessionId query parameter is required" },
        { status: 400 }
      );
    }

    const sessionId = parseInt(sessionIdStr, 10);
    if (isNaN(sessionId)) {
      return NextResponse.json<SignupLeadApiResponse>(
        { success: false, error: "sessionId must be a valid number" },
        { status: 400 }
      );
    }

    const lead = getSignupLeadForSession(sessionId);

    if (!lead) {
      return NextResponse.json<SignupLeadApiResponse>({
        success: true,
        lead: undefined,
      });
    }

    return NextResponse.json<SignupLeadApiResponse>({
      success: true,
      lead,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Get signup lead error:", errorMessage);

    return NextResponse.json<SignupLeadApiResponse>(
      { success: false, error: `Failed to get signup lead: ${errorMessage}` },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/signup-lead
 *
 * Updates an existing signup lead's parsed data or email variables.
 */
export async function PATCH(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    if (!body || typeof body !== "object") {
      return NextResponse.json<SignupLeadApiResponse>(
        { success: false, error: "Request body must be a JSON object" },
        { status: 400 }
      );
    }
    const { leadId, parsedData, emailVariables, apolloEnrichment } = body as UpdateSignupLeadRequest;

    if (!leadId || typeof leadId !== "number") {
      return NextResponse.json<SignupLeadApiResponse>(
        { success: false, error: "leadId is required" },
        { status: 400 }
      );
    }

    if (parsedData) {
      const success = updateSignupLeadParsedData(leadId, JSON.stringify(parsedData));
      if (!success) {
        return NextResponse.json<SignupLeadApiResponse>(
          { success: false, error: "Failed to update parsed data - lead not found" },
          { status: 404 }
        );
      }
    }

    if (emailVariables) {
      const success = updateSignupLeadEmailVariables(leadId, JSON.stringify(emailVariables));
      if (!success) {
        return NextResponse.json<SignupLeadApiResponse>(
          { success: false, error: "Failed to update email variables - lead not found" },
          { status: 404 }
        );
      }
    }

    if (apolloEnrichment) {
      const success = updateSignupLeadApolloEnrichment(leadId, JSON.stringify(apolloEnrichment));
      if (!success) {
        return NextResponse.json<SignupLeadApiResponse>(
          { success: false, error: "Failed to update Apollo enrichment - lead not found" },
          { status: 404 }
        );
      }
    }

    return NextResponse.json<SignupLeadApiResponse>({
      success: true,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Update signup lead error:", errorMessage);

    return NextResponse.json<SignupLeadApiResponse>(
      { success: false, error: `Failed to update signup lead: ${errorMessage}` },
      { status: 500 }
    );
  }
}
