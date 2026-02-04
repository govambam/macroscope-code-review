import { NextRequest, NextResponse } from "next/server";

interface ApolloUpdateRequest {
  accountId: string;
  variables: Record<string, string>;
}

interface ApolloUpdateResponse {
  success: boolean;
  error?: string;
  accountId?: string;
  accountName?: string;
}

// Apollo custom field IDs for the email template variables.
// These were created via the Apollo API and map to our AllEmailVariables keys.
const APOLLO_FIELD_IDS: Record<string, string> = {
  BUG_DESCRIPTION: "69837cab139a64001576391f",
  BUG_IMPACT: "69837cb9cb2415000db6e25d",
  FIX_SUGGESTION: "69837cce9c0fa9001d7489e1",
  BUG_TYPE: "69837cdd139a640015764099",
  PR_NAME: "69837cf32f2450000d446067",
  PR_LINK: "69837d0186a00f0015c0625a",
  BUG_FIX_URL: "69837d10955d06000db56beb",
  SIMULATED_PR_LINK: "69837d1e618f6b0019bfa967",
};

/**
 * POST /api/apollo/update
 *
 * Updates an Apollo account's custom fields with the email template variables.
 * Uses typed_custom_fields with field IDs and PATCH method.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // Check for Apollo API key
    const apolloApiKey = process.env.APOLLO_API_KEY;
    if (!apolloApiKey) {
      return NextResponse.json<ApolloUpdateResponse>(
        {
          success: false,
          error: "APOLLO_API_KEY is not configured. Please add it to your environment variables.",
        },
        { status: 500 }
      );
    }

    const body = await request.json();
    if (!body || typeof body !== "object") {
      return NextResponse.json<ApolloUpdateResponse>(
        { success: false, error: "Request body must be a JSON object" },
        { status: 400 }
      );
    }
    const { accountId, variables } = body as ApolloUpdateRequest;

    // Validate request
    if (!accountId || typeof accountId !== "string") {
      return NextResponse.json<ApolloUpdateResponse>(
        { success: false, error: "accountId is required" },
        { status: 400 }
      );
    }

    if (!variables || typeof variables !== "object") {
      return NextResponse.json<ApolloUpdateResponse>(
        { success: false, error: "variables object is required" },
        { status: 400 }
      );
    }

    // Build the custom fields object using field IDs
    const customFieldsById: Record<string, string> = {};
    for (const [varName, value] of Object.entries(variables)) {
      const fieldId = APOLLO_FIELD_IDS[varName];
      if (fieldId) {
        customFieldsById[fieldId] = value;
      }
    }

    const requestBody = {
      typed_custom_fields: customFieldsById,
    };

    console.log("Sending to Apollo:", JSON.stringify(requestBody, null, 2));

    const response = await fetch(
      `https://api.apollo.io/api/v1/accounts/${encodeURIComponent(accountId)}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
          "X-Api-Key": apolloApiKey,
        },
        body: JSON.stringify(requestBody),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Apollo API error:", response.status, errorText);

      if (response.status === 401) {
        return NextResponse.json<ApolloUpdateResponse>(
          { success: false, error: "Invalid Apollo API key" },
          { status: 401 }
        );
      }
      if (response.status === 404) {
        return NextResponse.json<ApolloUpdateResponse>(
          { success: false, error: "Account not found in Apollo" },
          { status: 404 }
        );
      }
      if (response.status === 422) {
        return NextResponse.json<ApolloUpdateResponse>(
          {
            success: false,
            error: "Failed to update custom fields. The field IDs may have changed in Apollo.",
          },
          { status: 422 }
        );
      }
      if (response.status === 429) {
        return NextResponse.json<ApolloUpdateResponse>(
          { success: false, error: "Apollo API rate limit exceeded. Please try again later." },
          { status: 429 }
        );
      }

      return NextResponse.json<ApolloUpdateResponse>(
        { success: false, error: `Apollo API error: ${response.status}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    console.log("Apollo response:", JSON.stringify(data, null, 2));

    return NextResponse.json<ApolloUpdateResponse>({
      success: true,
      accountId: data.account?.id || accountId,
      accountName: data.account?.name,
    });
  } catch (error) {
    console.error("Apollo update error:", error);
    return NextResponse.json<ApolloUpdateResponse>(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to update Apollo account",
      },
      { status: 500 }
    );
  }
}
