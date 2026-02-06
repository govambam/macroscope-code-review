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
  contactId: string | null; // Apollo contact ID if they exist as a contact
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
  contactCreated?: boolean;
  error?: string;
}

/**
 * POST /api/apollo/person
 *
 * Fetches person data from Apollo by LinkedIn URL using People Match API.
 * Optionally creates a contact in Apollo if they don't exist.
 *
 * Body:
 * - linkedin_url: string (required) - The LinkedIn profile URL
 * - create_contact: boolean (optional) - If true, creates contact if not found
 * - email: string (optional) - Email for contact creation
 * - first_name: string (optional) - First name for contact creation
 * - last_name: string (optional) - Last name for contact creation
 * - organization_name: string (optional) - Company name for contact creation
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

    const { linkedin_url, create_contact, email, first_name, last_name, organization_name } = body;

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
      console.error("Apollo People Match API error:", response.status, errorText);

      // If person not found and create_contact is true, try to create them
      if (response.status === 404 && create_contact) {
        return await createContact(apolloApiKey, {
          email,
          first_name,
          last_name,
          linkedin_url,
          organization_name,
        });
      }

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

      return NextResponse.json<ApolloPersonResponse>(
        { success: false, error: `Apollo API error: ${response.status}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    const person = data.person;

    if (!person) {
      // Person not found, optionally create contact
      if (create_contact) {
        return await createContact(apolloApiKey, {
          email,
          first_name,
          last_name,
          linkedin_url,
          organization_name,
        });
      }
      return NextResponse.json<ApolloPersonResponse>(
        { success: false, error: "Person not found in Apollo" },
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
      contactId: person.contact_id || null,
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

    // If person found but no contact_id and create_contact is true, create the contact
    if (!person.contact_id && create_contact && person.email) {
      const contactResult = await createContactFromPerson(apolloApiKey, person);
      if (contactResult.contactId) {
        personData.contactId = contactResult.contactId;
        return NextResponse.json<ApolloPersonResponse>({
          success: true,
          person: personData,
          contactCreated: true,
        });
      }
    }

    return NextResponse.json<ApolloPersonResponse>({
      success: true,
      person: personData,
      contactCreated: false,
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
    // Check for invalid date
    if (isNaN(date.getTime())) {
      return dateStr;
    }
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${months[date.getMonth()]} ${date.getFullYear()}`;
  } catch {
    return dateStr;
  }
}

/**
 * Create a contact in Apollo from basic info
 */
async function createContact(
  apiKey: string,
  info: {
    email?: string;
    first_name?: string;
    last_name?: string;
    linkedin_url?: string;
    organization_name?: string;
  }
): Promise<NextResponse<ApolloPersonResponse>> {
  if (!info.email) {
    return NextResponse.json<ApolloPersonResponse>(
      { success: false, error: "Email is required to create a contact" },
      { status: 400 }
    );
  }

  try {
    const response = await fetch("https://api.apollo.io/api/v1/contacts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "X-Api-Key": apiKey,
      },
      body: JSON.stringify({
        email: info.email,
        first_name: info.first_name || undefined,
        last_name: info.last_name || undefined,
        linkedin_url: info.linkedin_url || undefined,
        organization_name: info.organization_name || undefined,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Apollo create contact error:", response.status, errorText);
      return NextResponse.json<ApolloPersonResponse>(
        { success: false, error: `Failed to create contact: ${response.status}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    const contact = data.contact;

    return NextResponse.json<ApolloPersonResponse>({
      success: true,
      person: {
        id: contact.id,
        contactId: contact.id,
        firstName: contact.first_name || info.first_name || "",
        lastName: contact.last_name || info.last_name || "",
        fullName: contact.name || `${info.first_name || ""} ${info.last_name || ""}`.trim(),
        email: contact.email || info.email,
        emailStatus: contact.email_status || null,
        title: contact.title || null,
        linkedinUrl: contact.linkedin_url || info.linkedin_url || null,
        photoUrl: contact.photo_url || null,
        city: contact.city || null,
        state: contact.state || null,
        country: contact.country || null,
        location: null,
        employmentHistory: [],
        organization: contact.organization ? {
          id: contact.organization.id || null,
          name: contact.organization.name || null,
          domain: contact.organization.primary_domain || null,
          industry: contact.organization.industry || null,
          employeeCount: contact.organization.estimated_num_employees || null,
        } : null,
      },
      contactCreated: true,
    });
  } catch (error) {
    console.error("Apollo create contact error:", error);
    return NextResponse.json<ApolloPersonResponse>(
      { success: false, error: "Failed to create contact in Apollo" },
      { status: 500 }
    );
  }
}

/**
 * Create a contact from an existing person record
 */
async function createContactFromPerson(
  apiKey: string,
  person: {
    id: string;
    email?: string;
    first_name?: string;
    last_name?: string;
    linkedin_url?: string;
    organization?: { name?: string };
  }
): Promise<{ contactId: string | null }> {
  if (!person.email) {
    return { contactId: null };
  }

  try {
    const response = await fetch("https://api.apollo.io/api/v1/contacts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "X-Api-Key": apiKey,
      },
      body: JSON.stringify({
        email: person.email,
        first_name: person.first_name || undefined,
        last_name: person.last_name || undefined,
        linkedin_url: person.linkedin_url || undefined,
        organization_name: person.organization?.name || undefined,
      }),
    });

    if (!response.ok) {
      console.error("Apollo create contact from person error:", response.status);
      return { contactId: null };
    }

    const data = await response.json();
    return { contactId: data.contact?.id || null };
  } catch (error) {
    console.error("Apollo create contact from person error:", error);
    return { contactId: null };
  }
}
