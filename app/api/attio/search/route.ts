import { NextRequest, NextResponse } from "next/server";

interface AttioSearchRequest {
  query: string;
}

interface AttioRecord {
  id: string;
  name: string;
  domain: string | null;
}

interface AttioSearchResponse {
  success: boolean;
  records?: AttioRecord[];
  error?: string;
}

interface AttioAPIRecordValue {
  value?: string;
  domain?: string;
}

interface AttioAPIRecord {
  id: {
    record_id: string;
  };
  values: {
    name?: AttioAPIRecordValue[];
    domains?: AttioAPIRecordValue[];
  };
}

interface AttioAPIQueryResponse {
  data: AttioAPIRecord[];
}

/**
 * POST /api/attio/search
 *
 * Searches for company records in Attio by name.
 * Returns a list of matching companies.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const attioApiKey = process.env.ATTIO_API_KEY;
    if (!attioApiKey) {
      return NextResponse.json<AttioSearchResponse>(
        {
          success: false,
          error: "ATTIO_API_KEY is not configured. Please add it to your environment variables.",
        },
        { status: 500 }
      );
    }

    const body = await request.json();
    if (!body || typeof body !== "object") {
      return NextResponse.json<AttioSearchResponse>(
        { success: false, error: "Request body must be a JSON object" },
        { status: 400 }
      );
    }
    const { query } = body as AttioSearchRequest;

    if (!query || typeof query !== "string" || query.trim().length === 0) {
      return NextResponse.json<AttioSearchResponse>(
        { success: false, error: "query is required and must be a non-empty string" },
        { status: 400 }
      );
    }

    // Search for companies using Attio API
    // Uses the records query endpoint with a filter on the name attribute
    const response = await fetch("https://api.attio.com/v2/objects/companies/records/query", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${attioApiKey}`,
      },
      body: JSON.stringify({
        filter: {
          name: {
            "$contains": query.trim(),
          },
        },
        limit: 10,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Attio API error:", response.status, errorText);

      if (response.status === 401) {
        return NextResponse.json<AttioSearchResponse>(
          { success: false, error: "Invalid Attio API key" },
          { status: 401 }
        );
      }
      if (response.status === 429) {
        return NextResponse.json<AttioSearchResponse>(
          { success: false, error: "Attio API rate limit exceeded. Please try again later." },
          { status: 429 }
        );
      }

      return NextResponse.json<AttioSearchResponse>(
        { success: false, error: `Attio API error: ${response.status}` },
        { status: response.status }
      );
    }

    const data: AttioAPIQueryResponse = await response.json();

    // Map Attio response to our format
    const records: AttioRecord[] = data.data.map((record) => ({
      id: record.id.record_id,
      name: record.values.name?.[0]?.value || "Unknown",
      domain: record.values.domains?.[0]?.domain || null,
    }));

    return NextResponse.json<AttioSearchResponse>({
      success: true,
      records,
    });
  } catch (error) {
    console.error("Attio search error:", error);
    return NextResponse.json<AttioSearchResponse>(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to search Attio companies",
      },
      { status: 500 }
    );
  }
}
