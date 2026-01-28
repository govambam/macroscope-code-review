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

// Hardcoded Apollo custom field IDs
// These were created via the Apollo API and won't change
const APOLLO_FIELD_IDS = {
  macroscope_email_1_subject: "697967aa1f5edb000d93a158",
  macroscope_email_1_body: "6979681c0d207100193f8e7e",
  macroscope_email_2_subject: "6979680bff3e0e00192f1e38",
  macroscope_email_2_body: "6979681fec7fc4002117ee99",
  macroscope_email_3_subject: "69796813ff3e0e0011702a78",
  macroscope_email_3_body: "69796825d01e21000d61c202",
  macroscope_email_4_subject: "69796818d01e21000d61c1be",
  macroscope_email_4_body: "6979682b979d150021c01504",
};

const ALL_FIELD_IDS = Object.values(APOLLO_FIELD_IDS);

/**
 * Helper function to update Apollo account custom fields
 */
async function updateApolloAccount(
  apiKey: string,
  accountId: string,
  customFields: Record<string, string | null>,
  logLabel: string
): Promise<{ ok: boolean; status: number; data?: unknown; error?: string }> {
  const requestBody = {
    account: {
      typed_custom_fields: customFields,
    },
  };

  // Log what we're sending
  console.log(`[${logLabel}] Sending to Apollo:`, JSON.stringify(requestBody, null, 2));

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
    return { ok: false, status: response.status, error: errorText };
  }

  const data = await response.json();
  return { ok: true, status: response.status, data };
}

/**
 * POST /api/apollo/update
 *
 * Updates an Apollo account's custom fields with the email sequence.
 * Uses hardcoded field IDs for the macroscope email fields.
 *
 * To handle Apollo's behavior of not overwriting existing values,
 * we first clear the fields with empty strings, then set the new values.
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

    // Step 1: Clear all custom fields first (set to null)
    // This is needed because Apollo doesn't overwrite existing values
    const emptyFields: Record<string, null> = {};
    for (const fieldId of ALL_FIELD_IDS) {
      emptyFields[fieldId] = null;
    }

    console.log("Step 1: Clearing existing custom fields...");
    const clearResult = await updateApolloAccount(apolloApiKey, accountId, emptyFields, "CLEAR");

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

    // Log what Apollo returned after clearing to verify it worked
    const clearData = clearResult.data as { account?: { typed_custom_fields?: Record<string, unknown> } };
    console.log("[CLEAR] Apollo response - checking if fields were cleared:");
    for (const fieldId of ALL_FIELD_IDS) {
      const value = clearData.account?.typed_custom_fields?.[fieldId];
      console.log(`  ${fieldId}: ${value === null || value === undefined ? "CLEARED ✓" : `STILL HAS VALUE: "${String(value).substring(0, 50)}..."`}`);
    }

    console.log("Custom fields cleared successfully");

    // Step 2: Set the new values
    const customFieldsById: Record<string, string> = {
      [APOLLO_FIELD_IDS.macroscope_email_1_subject]: emailSequence.email_1.subject,
      [APOLLO_FIELD_IDS.macroscope_email_1_body]: emailSequence.email_1.body,
      [APOLLO_FIELD_IDS.macroscope_email_2_subject]: emailSequence.email_2.subject,
      [APOLLO_FIELD_IDS.macroscope_email_2_body]: emailSequence.email_2.body,
      [APOLLO_FIELD_IDS.macroscope_email_3_subject]: emailSequence.email_3.subject,
      [APOLLO_FIELD_IDS.macroscope_email_3_body]: emailSequence.email_3.body,
      [APOLLO_FIELD_IDS.macroscope_email_4_subject]: emailSequence.email_4.subject,
      [APOLLO_FIELD_IDS.macroscope_email_4_body]: emailSequence.email_4.body,
    };

    console.log("Step 2: Setting new custom field values...");
    const updateResult = await updateApolloAccount(apolloApiKey, accountId, customFieldsById, "UPDATE");

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
            error: "Failed to update custom fields. The field IDs may have changed in Apollo.",
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

    // Log the response for debugging - compare what we sent vs what Apollo returned
    const updateData = updateResult.data as { account?: { id?: string; name?: string; typed_custom_fields?: Record<string, string> } };

    console.log("[UPDATE] Comparing sent values vs Apollo response:");
    for (const [fieldId, sentValue] of Object.entries(customFieldsById)) {
      const returnedValue = updateData.account?.typed_custom_fields?.[fieldId];
      const sentPreview = sentValue.substring(0, 50);
      const returnedPreview = returnedValue ? returnedValue.substring(0, 50) : "undefined";
      const match = sentValue === returnedValue;
      console.log(`  ${fieldId}:`);
      console.log(`    SENT:     "${sentPreview}..."`);
      console.log(`    RETURNED: "${returnedPreview}..."`);
      console.log(`    MATCH: ${match ? "✓ YES" : "✗ NO - UPDATE FAILED"}`);
    }

    console.log("Apollo update response:", JSON.stringify(updateResult.data, null, 2));

    const data = updateData;

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
