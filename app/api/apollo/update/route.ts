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

/**
 * POST /api/apollo/update
 *
 * Updates an Apollo account's custom fields with the email sequence.
 * Uses hardcoded field IDs for the macroscope email fields.
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

    // Build the update payload using hardcoded field IDs
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

    // Wrap in account object with typed_custom_fields as required by Apollo API
    const requestBody = {
      account: {
        typed_custom_fields: customFieldsById,
      },
    };

    console.log("Updating Apollo account with request body:", JSON.stringify(requestBody, null, 2));

    // Update the account using Apollo API with field IDs
    // API docs: https://apolloio.github.io/apollo-api-docs/#tag/Accounts/operation/update_account
    const response = await fetch(`https://api.apollo.io/v1/accounts/${encodeURIComponent(accountId)}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "X-Api-Key": apolloApiKey,
      },
      body: JSON.stringify(requestBody),
    });

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

    // Log the response for debugging
    console.log("Apollo update response:", JSON.stringify(data, null, 2));

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
