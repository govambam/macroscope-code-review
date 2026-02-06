import { NextRequest, NextResponse } from "next/server";

interface ApolloEmploymentHistory {
  organization_name: string;
  title: string;
  start_date: string | null;
  end_date: string | null;
  current: boolean;
}

interface ApolloPersonData {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string | null;
  emailStatus: string | null;
  title: string | null;
  linkedinUrl: string | null;
  photoUrl: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  location: string | null;
  employmentHistory: Array<{
    company: string;
    title: string;
    startDate: string | null;
    endDate: string | null;
    current: boolean;
  }>;
  organization: {
    id: string | null;
    name: string | null;
    domain: string | null;
    industry: string | null;
    employeeCount: number | null;
  } | null;
}

interface ApolloPersonResponse {
  success: boolean;
  person?: ApolloPersonData;
  error?: string;
}

/**
 * POST /api/apollo/person
 *
 * Fetches person data from Apollo by LinkedIn URL.
 * Returns employment history, email, and other profile data.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // Check for Apollo API key
    const apolloApiKey = process.env.APOLLO_API_KEY;
    if (!apolloApiKey) {
      return NextResponse.json<ApolloPersonResponse>(
        {
          success: false,
          error: "APOLLO_API_KEY is not configured",
        },
        { status: 500 }
      );
    }

    const body = await request.json();
    if (!body || typeof body !== "object") {
      return NextResponse.json<ApolloPersonResponse>(
        { success: false, error: "Request body must be a JSON object" },
        { status: 400 }
      );
    }

    const { linkedin_url } = body;

    if (!linkedin_url || typeof linkedin_url !== "string") {
      return NextResponse.json<ApolloPersonResponse>(
        { success: false, error: "linkedin_url is required" },
        { status: 400 }
      );
    }

    // Call Apollo People Match API
    const response = await fetch("https://api.apollo.io/api/v1/people/match", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "X-Api-Key": apolloApiKey,
      },
      body: JSON.stringify({
        linkedin_url: linkedin_url.trim(),
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Apollo API error:", response.status, errorText);

      if (response.status === 401) {
        return NextResponse.json<ApolloPersonResponse>(
          { success: false, error: "Invalid Apollo API key" },
          { status: 401 }
        );
      }
      if (response.status === 429) {
        return NextResponse.json<ApolloPersonResponse>(
          { success: false, error: "Apollo API rate limit exceeded" },
          { status: 429 }
        );
      }
      if (response.status === 404) {
        return NextResponse.json<ApolloPersonResponse>(
          { success: false, error: "Person not found in Apollo" },
          { status: 404 }
        );
      }

      return NextResponse.json<ApolloPersonResponse>(
        { success: false, error: `Apollo API error: ${response.status}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    const person = data.person;

    if (!person) {
      return NextResponse.json<ApolloPersonResponse>(
        { success: false, error: "Person not found" },
        { status: 404 }
      );
    }

    // Format employment history
    const employmentHistory = (person.employment_history || [])
      .map((emp: ApolloEmploymentHistory) => ({
        company: emp.organization_name || "Unknown",
        title: emp.title || "Unknown",
        startDate: formatDate(emp.start_date),
        endDate: emp.current ? "Present" : formatDate(emp.end_date),
        current: emp.current || false,
      }))
      .filter((emp: { company: string }) => emp.company !== "Unknown");

    // Build location string
    const locationParts = [person.city, person.state, person.country].filter(Boolean);
    const location = locationParts.length > 0 ? locationParts.join(", ") : null;

    // Map to our format
    const personData: ApolloPersonData = {
      id: person.id,
      firstName: person.first_name || "",
      lastName: person.last_name || "",
      fullName: person.name || `${person.first_name || ""} ${person.last_name || ""}`.trim(),
      email: person.email || null,
      emailStatus: person.email_status || null,
      title: person.title || null,
      linkedinUrl: person.linkedin_url || null,
      photoUrl: person.photo_url || null,
      city: person.city || null,
      state: person.state || null,
      country: person.country || null,
      location,
      employmentHistory,
      organization: person.organization ? {
        id: person.organization.id || null,
        name: person.organization.name || null,
        domain: person.organization.primary_domain || null,
        industry: person.organization.industry || null,
        employeeCount: person.organization.estimated_num_employees || null,
      } : null,
    };

    return NextResponse.json<ApolloPersonResponse>({
      success: true,
      person: personData,
    });
  } catch (error) {
    console.error("Apollo person lookup error:", error);
    return NextResponse.json<ApolloPersonResponse>(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to fetch person data",
      },
      { status: 500 }
    );
  }
}

/**
 * Format a date string like "2024-08-01" to "Aug 2024"
 */
function formatDate(dateStr: string | null): string | null {
  if (!dateStr) return null;

  try {
    const date = new Date(dateStr);
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${months[date.getMonth()]} ${date.getFullYear()}`;
  } catch {
    return dateStr;
  }
}
