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

/**
 * POST /api/apollo/update
 *
 * Updates an Apollo account's custom fields with the email sequence.
 * Expected custom fields in Apollo (lowercase):
 * - macroscope_email_1_subject
 * - macroscope_email_1_body
 * - macroscope_email_2_subject
 * - macroscope_email_2_body
 * - macroscope_email_3_subject
 * - macroscope_email_3_body
 * - macroscope_email_4_subject
 * - macroscope_email_4_body
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

    // Field name to value mapping (lowercase to match Apollo field names)
    const fieldValues: Record<string, string> = {
      macroscope_email_1_subject: emailSequence.email_1.subject,
      macroscope_email_1_body: emailSequence.email_1.body,
      macroscope_email_2_subject: emailSequence.email_2.subject,
      macroscope_email_2_body: emailSequence.email_2.body,
      macroscope_email_3_subject: emailSequence.email_3.subject,
      macroscope_email_3_body: emailSequence.email_3.body,
      macroscope_email_4_subject: emailSequence.email_4.subject,
      macroscope_email_4_body: emailSequence.email_4.body,
    };

    // First, fetch custom field definitions to get the field IDs
    // Apollo requires field IDs (not names) when updating custom fields
    const fieldsResponse = await fetch("https://api.apollo.io/v1/typed_custom_fields", {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "X-Api-Key": apolloApiKey,
      },
    });

    if (!fieldsResponse.ok) {
      console.error("Failed to fetch custom field definitions:", fieldsResponse.status);
      return NextResponse.json<ApolloUpdateResponse>(
        { success: false, error: "Failed to fetch Apollo custom field definitions" },
        { status: 500 }
      );
    }

    const fieldsData = await fieldsResponse.json();

    // Log the full response to debug field structure
    console.log("Apollo custom fields response:", JSON.stringify(fieldsData, null, 2));

    // Build a map of field name -> field ID
    // Apollo returns typed_custom_fields array with objects containing id and label
    const fieldNameToId: Record<string, string> = {};
    if (fieldsData.typed_custom_fields && Array.isArray(fieldsData.typed_custom_fields)) {
      for (const field of fieldsData.typed_custom_fields) {
        // Log each field to see structure
        console.log("Field:", field.id, field.label, field.name, field.modality);
        if (field.label && field.id) {
          // Store exact match, uppercase, and lowercase versions
          fieldNameToId[field.label] = field.id;
          fieldNameToId[field.label.toUpperCase()] = field.id;
          fieldNameToId[field.label.toLowerCase()] = field.id;
        }
        // Also try 'name' property if 'label' doesn't exist
        if (field.name && field.id) {
          fieldNameToId[field.name] = field.id;
          fieldNameToId[field.name.toUpperCase()] = field.id;
          fieldNameToId[field.name.toLowerCase()] = field.id;
        }
      }
    }

    console.log("Field name to ID mapping:", JSON.stringify(fieldNameToId, null, 2));

    // Build the update payload using field IDs
    const customFieldsById: Record<string, string> = {};
    const missingFields: string[] = [];

    for (const [fieldName, value] of Object.entries(fieldValues)) {
      const fieldId = fieldNameToId[fieldName];
      if (fieldId) {
        customFieldsById[fieldId] = value;
      } else {
        missingFields.push(fieldName);
      }
    }

    if (missingFields.length > 0) {
      console.warn("Missing custom field IDs for:", missingFields);
      return NextResponse.json<ApolloUpdateResponse>(
        {
          success: false,
          error: `Custom fields not found in Apollo: ${missingFields.join(", ")}. Please create these fields in Apollo Settings > Customize > Custom Fields > Account.`,
        },
        { status: 422 }
      );
    }

    // Update the account using Apollo API with field IDs
    // API docs: https://apolloio.github.io/apollo-api-docs/#tag/Accounts/operation/update_account
    const response = await fetch(`https://api.apollo.io/v1/accounts/${encodeURIComponent(accountId)}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "X-Api-Key": apolloApiKey,
      },
      body: JSON.stringify(customFieldsById),
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
            error: "Custom fields not configured in Apollo. Please create the required custom fields: macroscope_email_1_subject, macroscope_email_1_body, etc.",
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
