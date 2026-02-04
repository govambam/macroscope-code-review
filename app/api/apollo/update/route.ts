import { NextRequest, NextResponse } from "next/server";

interface EmailVariables {
  BUG_DESCRIPTION: string;
  BUG_IMPACT: string;
  FIX_SUGGESTION: string;
  BUG_TYPE: string;
}

interface DbVariables {
  PR_NAME: string;
  PR_LINK: string;
  BUG_FIX_URL: string;
  SIMULATED_PR_LINK: string;
}

interface ApolloUpdateRequest {
  accountId: string;
  variables: EmailVariables;
  dbVariables: DbVariables;
}

interface ApolloUpdateResponse {
  success: boolean;
  error?: string;
  accountId?: string;
  accountName?: string;
}

/** The 8 custom field names we expect to exist in Apollo */
const VARIABLE_FIELD_NAMES = [
  "BUG_DESCRIPTION",
  "BUG_IMPACT",
  "FIX_SUGGESTION",
  "BUG_TYPE",
  "PR_NAME",
  "PR_LINK",
  "BUG_FIX_URL",
  "SIMULATED_PR_LINK",
] as const;

/**
 * Fetches Apollo custom field definitions and returns a name→ID map
 * for our 8 expected fields.
 */
async function getFieldIdMap(
  apiKey: string
): Promise<Record<string, string>> {
  const res = await fetch("https://api.apollo.io/v1/typed_custom_fields", {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
      "X-Api-Key": apiKey,
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch custom fields: ${res.status}`);
  }

  const data = await res.json();
  const fields: Array<{ id: string; name: string }> = data.typed_custom_fields || [];

  const map: Record<string, string> = {};
  for (const field of fields) {
    if ((VARIABLE_FIELD_NAMES as readonly string[]).includes(field.name)) {
      map[field.name] = field.id;
    }
  }

  return map;
}

/**
 * POST /api/apollo/update
 *
 * Updates an Apollo account's custom fields with the 8 email variables.
 * Dynamically looks up field IDs by name, then PATCHes the account.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
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
    const { accountId, variables, dbVariables } = body as ApolloUpdateRequest;

    if (!accountId || typeof accountId !== "string") {
      return NextResponse.json<ApolloUpdateResponse>(
        { success: false, error: "accountId is required" },
        { status: 400 }
      );
    }

    if (!variables || !dbVariables) {
      return NextResponse.json<ApolloUpdateResponse>(
        { success: false, error: "variables and dbVariables are required" },
        { status: 400 }
      );
    }

    // Step 1: Look up field IDs by name
    const fieldIdMap = await getFieldIdMap(apolloApiKey);

    const missingFields = VARIABLE_FIELD_NAMES.filter((name) => !fieldIdMap[name]);
    if (missingFields.length > 0) {
      return NextResponse.json<ApolloUpdateResponse>(
        {
          success: false,
          error: `Missing custom fields in Apollo: ${missingFields.join(", ")}. Please create them in Apollo first.`,
        },
        { status: 400 }
      );
    }

    // Step 2: Build typed_custom_fields mapping field IDs to values
    const allVars: Record<string, string> = { ...variables, ...dbVariables };
    const typedCustomFields: Record<string, string> = {};
    for (const name of VARIABLE_FIELD_NAMES) {
      typedCustomFields[fieldIdMap[name]] = allVars[name] || "";
    }

    const requestBody = {
      typed_custom_fields: typedCustomFields,
    };

    console.log("Sending to Apollo:", JSON.stringify(requestBody, null, 2));

    // Step 3: Update the account
    const response = await fetch(
      `https://api.apollo.io/v1/accounts/${encodeURIComponent(accountId)}`,
      {
        method: "PUT",
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
            error: "Failed to update custom fields. Check that the fields exist in Apollo.",
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
