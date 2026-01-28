import { NextRequest, NextResponse } from "next/server";

interface ApolloSearchRequest {
  query: string; // Company name to search for
}

interface ApolloAccount {
  id: string;
  name: string;
  domain: string | null;
  website_url: string | null;
}

interface ApolloSearchResponse {
  success: boolean;
  accounts?: ApolloAccount[];
  error?: string;
}

interface ApolloAPISearchResponse {
  accounts: Array<{
    id: string;
    name: string;
    domain: string | null;
    website_url: string | null;
  }>;
  pagination: {
    page: number;
    per_page: number;
    total_entries: number;
    total_pages: number;
  };
}

/**
 * POST /api/apollo/search
 *
 * Searches for accounts in Apollo by company name.
 * Returns a list of matching accounts.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // Check for Apollo API key
    const apolloApiKey = process.env.APOLLO_API_KEY;
    if (!apolloApiKey) {
      return NextResponse.json<ApolloSearchResponse>(
        {
          success: false,
          error: "APOLLO_API_KEY is not configured. Please add it to your environment variables.",
        },
        { status: 500 }
      );
    }

    const body: ApolloSearchRequest = await request.json();
    const { query } = body;

    if (!query || typeof query !== "string" || query.trim().length === 0) {
      return NextResponse.json<ApolloSearchResponse>(
        { success: false, error: "query is required and must be a non-empty string" },
        { status: 400 }
      );
    }

    // Search for accounts using Apollo API
    // API docs: https://apolloio.github.io/apollo-api-docs/#tag/Accounts/operation/search_accounts
    const response = await fetch("https://api.apollo.io/v1/accounts/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "X-Api-Key": apolloApiKey,
      },
      body: JSON.stringify({
        q_organization_name: query.trim(),
        per_page: 10,
        page: 1,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Apollo API error:", response.status, errorText);

      if (response.status === 401) {
        return NextResponse.json<ApolloSearchResponse>(
          { success: false, error: "Invalid Apollo API key" },
          { status: 401 }
        );
      }
      if (response.status === 429) {
        return NextResponse.json<ApolloSearchResponse>(
          { success: false, error: "Apollo API rate limit exceeded. Please try again later." },
          { status: 429 }
        );
      }

      return NextResponse.json<ApolloSearchResponse>(
        { success: false, error: `Apollo API error: ${response.status}` },
        { status: response.status }
      );
    }

    const data: ApolloAPISearchResponse = await response.json();

    // Map Apollo response to our format
    const accounts: ApolloAccount[] = data.accounts.map((account) => ({
      id: account.id,
      name: account.name,
      domain: account.domain,
      website_url: account.website_url,
    }));

    return NextResponse.json<ApolloSearchResponse>({
      success: true,
      accounts,
    });
  } catch (error) {
    console.error("Apollo search error:", error);
    return NextResponse.json<ApolloSearchResponse>(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to search Apollo accounts",
      },
      { status: 500 }
    );
  }
}
