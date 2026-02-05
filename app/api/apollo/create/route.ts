import { NextRequest, NextResponse } from "next/server";

interface ApolloCreateRequest {
  name: string;
  domain?: string;
}

interface ApolloAccount {
  id: string;
  name: string;
  domain: string | null;
  website_url: string | null;
}

interface ApolloCreateResponse {
  success: boolean;
  account?: ApolloAccount;
  error?: string;
}

/**
 * POST /api/apollo/create
 *
 * Creates a new account in Apollo.
 * Requires at least the company name; domain is optional but recommended.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // Check for Apollo API key
    const apolloApiKey = process.env.APOLLO_API_KEY;
    if (!apolloApiKey) {
      return NextResponse.json<ApolloCreateResponse>(
        {
          success: false,
          error: "APOLLO_API_KEY is not configured. Please add it to your environment variables.",
        },
        { status: 500 }
      );
    }

    const body = await request.json();
    if (!body || typeof body !== "object") {
      return NextResponse.json<ApolloCreateResponse>(
        { success: false, error: "Request body must be a JSON object" },
        { status: 400 }
      );
    }
    const { name, domain } = body as ApolloCreateRequest;

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json<ApolloCreateResponse>(
        { success: false, error: "name is required and must be a non-empty string" },
        { status: 400 }
      );
    }

    // Create account using Apollo API
    // API docs: https://apolloio.github.io/apollo-api-docs/#tag/Accounts/operation/create_account
    const response = await fetch("https://api.apollo.io/api/v1/accounts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "X-Api-Key": apolloApiKey,
      },
      body: JSON.stringify({
        name: name.trim(),
        domain: domain?.trim() || undefined,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Apollo API error:", response.status, errorText);

      if (response.status === 401) {
        return NextResponse.json<ApolloCreateResponse>(
          { success: false, error: "Invalid Apollo API key" },
          { status: 401 }
        );
      }
      if (response.status === 429) {
        return NextResponse.json<ApolloCreateResponse>(
          { success: false, error: "Apollo API rate limit exceeded. Please try again later." },
          { status: 429 }
        );
      }
      if (response.status === 422) {
        return NextResponse.json<ApolloCreateResponse>(
          { success: false, error: "Account with this name or domain may already exist" },
          { status: 422 }
        );
      }

      return NextResponse.json<ApolloCreateResponse>(
        { success: false, error: `Apollo API error: ${response.status}` },
        { status: response.status }
      );
    }

    const data = await response.json();

    const account: ApolloAccount = {
      id: data.account?.id || data.id,
      name: data.account?.name || data.name,
      domain: data.account?.domain || data.domain || null,
      website_url: data.account?.website_url || data.website_url || null,
    };

    return NextResponse.json<ApolloCreateResponse>({
      success: true,
      account,
    });
  } catch (error) {
    console.error("Apollo create error:", error);
    return NextResponse.json<ApolloCreateResponse>(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to create Apollo account",
      },
      { status: 500 }
    );
  }
}
