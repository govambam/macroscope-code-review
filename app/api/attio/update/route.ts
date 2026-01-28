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

interface AttioUpdateRequest {
  recordId: string;
  emailSequence: EmailSequence;
}

interface AttioUpdateResponse {
  success: boolean;
  error?: string;
  recordId?: string;
  recordName?: string;
}

// Attio custom attribute API slugs for the email sequence
// These must be created in Attio's Companies object before using this integration
// To create them: Attio Settings > Objects > Companies > Create attribute (type: Text)
const ATTIO_ATTRIBUTE_SLUGS = {
  macroscope_email_1_subject: "macroscope_email_1_subject",
  macroscope_email_1_body: "macroscope_email_1_body",
  macroscope_email_2_subject: "macroscope_email_2_subject",
  macroscope_email_2_body: "macroscope_email_2_body",
  macroscope_email_3_subject: "macroscope_email_3_subject",
  macroscope_email_3_body: "macroscope_email_3_body",
  macroscope_email_4_subject: "macroscope_email_4_subject",
  macroscope_email_4_body: "macroscope_email_4_body",
};

/**
 * POST /api/attio/update
 *
 * Updates an Attio company record's custom attributes with the email sequence.
 * Uses the PATCH endpoint to update specific attributes without affecting others.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const attioApiKey = process.env.ATTIO_API_KEY;
    if (!attioApiKey) {
      return NextResponse.json<AttioUpdateResponse>(
        {
          success: false,
          error: "ATTIO_API_KEY is not configured. Please add it to your environment variables.",
        },
        { status: 500 }
      );
    }

    const body = await request.json();
    if (!body || typeof body !== "object") {
      return NextResponse.json<AttioUpdateResponse>(
        { success: false, error: "Request body must be a JSON object" },
        { status: 400 }
      );
    }
    const { recordId, emailSequence } = body as AttioUpdateRequest;

    if (!recordId || typeof recordId !== "string") {
      return NextResponse.json<AttioUpdateResponse>(
        { success: false, error: "recordId is required" },
        { status: 400 }
      );
    }

    // Validate emailSequence has all 4 emails with subject and body
    const isValidEmail = (email: unknown): email is EmailEntry =>
      typeof email === "object" &&
      email !== null &&
      typeof (email as EmailEntry).subject === "string" &&
      typeof (email as EmailEntry).body === "string";

    if (
      !emailSequence ||
      !isValidEmail(emailSequence.email_1) ||
      !isValidEmail(emailSequence.email_2) ||
      !isValidEmail(emailSequence.email_3) ||
      !isValidEmail(emailSequence.email_4)
    ) {
      return NextResponse.json<AttioUpdateResponse>(
        { success: false, error: "emailSequence with all 4 emails (each with subject and body) is required" },
        { status: 400 }
      );
    }

    // Build the attribute values object
    const attributeValues: Record<string, string> = {
      [ATTIO_ATTRIBUTE_SLUGS.macroscope_email_1_subject]: emailSequence.email_1.subject,
      [ATTIO_ATTRIBUTE_SLUGS.macroscope_email_1_body]: emailSequence.email_1.body,
      [ATTIO_ATTRIBUTE_SLUGS.macroscope_email_2_subject]: emailSequence.email_2.subject,
      [ATTIO_ATTRIBUTE_SLUGS.macroscope_email_2_body]: emailSequence.email_2.body,
      [ATTIO_ATTRIBUTE_SLUGS.macroscope_email_3_subject]: emailSequence.email_3.subject,
      [ATTIO_ATTRIBUTE_SLUGS.macroscope_email_3_body]: emailSequence.email_3.body,
      [ATTIO_ATTRIBUTE_SLUGS.macroscope_email_4_subject]: emailSequence.email_4.subject,
      [ATTIO_ATTRIBUTE_SLUGS.macroscope_email_4_body]: emailSequence.email_4.body,
    };

    // Attio expects the request body format: { data: { values: { attribute_slug: value } } }
    const requestBody = {
      data: {
        values: attributeValues,
      },
    };

    console.log("Sending to Attio:", JSON.stringify(requestBody, null, 2));

    // Use PATCH to update the record's attributes
    const response = await fetch(
      `https://api.attio.com/v2/objects/companies/records/${encodeURIComponent(recordId)}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${attioApiKey}`,
        },
        body: JSON.stringify(requestBody),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Attio API error:", response.status, errorText);

      if (response.status === 401) {
        return NextResponse.json<AttioUpdateResponse>(
          { success: false, error: "Invalid Attio API key" },
          { status: 401 }
        );
      }
      if (response.status === 404) {
        return NextResponse.json<AttioUpdateResponse>(
          { success: false, error: "Company record not found in Attio" },
          { status: 404 }
        );
      }
      if (response.status === 400) {
        // This likely means the custom attributes don't exist yet
        return NextResponse.json<AttioUpdateResponse>(
          {
            success: false,
            error: "Failed to update attributes. Please ensure the macroscope_email_* attributes are created in Attio.",
          },
          { status: 400 }
        );
      }
      if (response.status === 429) {
        return NextResponse.json<AttioUpdateResponse>(
          { success: false, error: "Attio API rate limit exceeded. Please try again later." },
          { status: 429 }
        );
      }

      return NextResponse.json<AttioUpdateResponse>(
        { success: false, error: `Attio API error: ${response.status}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    console.log("Attio response:", JSON.stringify(data, null, 2));

    // Extract record name from response
    const recordName = data.data?.values?.name?.[0]?.value || "Unknown";

    return NextResponse.json<AttioUpdateResponse>({
      success: true,
      recordId: data.data?.id?.record_id || recordId,
      recordName,
    });
  } catch (error) {
    console.error("Attio update error:", error);
    return NextResponse.json<AttioUpdateResponse>(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to update Attio company",
      },
      { status: 500 }
    );
  }
}
