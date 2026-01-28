import { NextRequest, NextResponse } from "next/server";

interface EmailEntry {
  subject: string;
  body: string;
}

interface EmailSequence {
  email_1: EmailEntry;
  email_2: EmailEntry;
  email_3: EmailEntry;
  email_4: EmailEntry;
}

interface ApolloUpdateRequest {
  accountId: string;
  emailSequence: EmailSequence;
}

interface ApolloUpdateResponse {
  success: boolean;
  error?: string;
  accountId?: string;
  accountName?: string;
}

// Apollo custom field names (as created in Apollo)
// Using names instead of IDs to try a different API approach
const APOLLO_FIELD_NAMES = {
  email_1_subject: "macroscope_email_1_subject",
  email_1_body: "macroscope_email_1_body",
  email_2_subject: "macroscope_email_2_subject",
  email_2_body: "macroscope_email_2_body",
  email_3_subject: "macroscope_email_3_subject",
  email_3_body: "macroscope_email_3_body",
  email_4_subject: "macroscope_email_4_subject",
  email_4_body: "macroscope_email_4_body",
};

const ALL_FIELD_NAMES = Object.values(APOLLO_FIELD_NAMES);

/**
 * Helper function to update Apollo account custom fields using the custom_fields array format.
 * This uses field NAMES instead of field IDs, which may have different overwrite behavior.
 */
async function updateApolloAccountWithNames(
  apiKey: string,
  accountId: string,
  fields: Array<{ name: string; value: string }>,
  logLabel: string
): Promise<{ ok: boolean; status: number; data?: unknown; error?: string }> {
  const requestBody = {
    custom_fields: fields,
  };

  // Log what we're sending
  console.log(`[${logLabel}] Sending to Apollo (custom_fields format):`, JSON.stringify(requestBody, null, 2));

  const response = await fetch(
    `https://api.apollo.io/v1/accounts/${encodeURIComponent(accountId)}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "X-Api-Key": apiKey,
      },
      body: JSON.stringify(requestBody),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.log(`[${logLabel}] Apollo response error:`, response.status, errorText);
    return { ok: false, status: response.status, error: errorText };
  }

  const data = await response.json();
  console.log(`[${logLabel}] Apollo response:`, JSON.stringify(data, null, 2));
  return { ok: true, status: response.status, data };
}

/**
 * POST /api/apollo/update
 *
 * Updates an Apollo account's custom fields with the email sequence.
 * Uses field NAMES with custom_fields array format (instead of typed_custom_fields with IDs).
 *
 * This approach may have different merge/overwrite behavior than typed_custom_fields.
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
    const { accountId, emailSequence } = body as ApolloUpdateRequest;

    // Validate request
    if (!accountId || typeof accountId !== "string") {
      return NextResponse.json<ApolloUpdateResponse>(
        { success: false, error: "accountId is required" },
        { status: 400 }
      );
    }

    if (!emailSequence || !emailSequence.email_1 || !emailSequence.email_2 || !emailSequence.email_3 || !emailSequence.email_4) {
      return NextResponse.json<ApolloUpdateResponse>(
        { success: false, error: "emailSequence with all 4 emails is required" },
        { status: 400 }
      );
    }

    // Step 1: Clear all custom fields first (set to empty string)
    // This is needed because Apollo doesn't overwrite existing values
    console.log("Step 1: Clearing existing custom fields (using empty string)...");
    const clearFields = ALL_FIELD_NAMES.map(name => ({ name, value: "" }));
    const clearResult = await updateApolloAccountWithNames(apolloApiKey, accountId, clearFields, "CLEAR");

    if (!clearResult.ok) {
      console.error("Failed to clear custom fields:", clearResult.status, clearResult.error);

      if (clearResult.status === 401) {
        return NextResponse.json<ApolloUpdateResponse>(
          { success: false, error: "Invalid Apollo API key" },
          { status: 401 }
        );
      }
      if (clearResult.status === 404) {
        return NextResponse.json<ApolloUpdateResponse>(
          { success: false, error: "Account not found in Apollo" },
          { status: 404 }
        );
      }

      return NextResponse.json<ApolloUpdateResponse>(
        { success: false, error: `Failed to clear custom fields: ${clearResult.status}` },
        { status: clearResult.status }
      );
    }

    // Check if fields were actually cleared
    const clearData = clearResult.data as { account?: { typed_custom_fields?: Record<string, unknown> } };
    console.log("[CLEAR] Checking if fields were cleared in response...");

    console.log("Custom fields cleared successfully");

    // Step 2: Set the new values
    console.log("Step 2: Setting new custom field values...");
    const updateFields = [
      { name: APOLLO_FIELD_NAMES.email_1_subject, value: emailSequence.email_1.subject },
      { name: APOLLO_FIELD_NAMES.email_1_body, value: emailSequence.email_1.body },
      { name: APOLLO_FIELD_NAMES.email_2_subject, value: emailSequence.email_2.subject },
      { name: APOLLO_FIELD_NAMES.email_2_body, value: emailSequence.email_2.body },
      { name: APOLLO_FIELD_NAMES.email_3_subject, value: emailSequence.email_3.subject },
      { name: APOLLO_FIELD_NAMES.email_3_body, value: emailSequence.email_3.body },
      { name: APOLLO_FIELD_NAMES.email_4_subject, value: emailSequence.email_4.subject },
      { name: APOLLO_FIELD_NAMES.email_4_body, value: emailSequence.email_4.body },
    ];

    const updateResult = await updateApolloAccountWithNames(apolloApiKey, accountId, updateFields, "UPDATE");

    if (!updateResult.ok) {
      console.error("Failed to set custom fields:", updateResult.status, updateResult.error);

      if (updateResult.status === 401) {
        return NextResponse.json<ApolloUpdateResponse>(
          { success: false, error: "Invalid Apollo API key" },
          { status: 401 }
        );
      }
      if (updateResult.status === 404) {
        return NextResponse.json<ApolloUpdateResponse>(
          { success: false, error: "Account not found in Apollo" },
          { status: 404 }
        );
      }
      if (updateResult.status === 422) {
        return NextResponse.json<ApolloUpdateResponse>(
          {
            success: false,
            error: "Failed to update custom fields. The field names may not exist in Apollo.",
          },
          { status: 422 }
        );
      }
      if (updateResult.status === 429) {
        return NextResponse.json<ApolloUpdateResponse>(
          { success: false, error: "Apollo API rate limit exceeded. Please try again later." },
          { status: 429 }
        );
      }

      return NextResponse.json<ApolloUpdateResponse>(
        { success: false, error: `Apollo API error: ${updateResult.status}` },
        { status: updateResult.status }
      );
    }

    const data = updateResult.data as { account?: { id?: string; name?: string } };

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
