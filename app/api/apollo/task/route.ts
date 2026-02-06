import { NextRequest, NextResponse } from "next/server";

interface ApolloTaskRequest {
  contact_id: string;
  type?: string;
  priority?: "high" | "medium" | "low";
  note?: string;
}

interface ApolloTaskResponse {
  success: boolean;
  taskId?: string;
  error?: string;
}

// Default assignee for signup sequence tasks
const DEFAULT_ASSIGNEE_ID = "697943fdadbc020019c93306";

/**
 * POST /api/apollo/task
 *
 * Creates a task in Apollo for a contact.
 *
 * Body:
 * - contact_id: string (required) - The Apollo contact ID
 * - type: string (optional) - Task type, defaults to "action_item"
 * - priority: "high" | "medium" | "low" (optional) - Defaults to "medium"
 * - note: string (optional) - Additional note for the task
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // Check for Apollo API key
    const apolloApiKey = process.env.APOLLO_API_KEY;
    if (!apolloApiKey) {
      return NextResponse.json<ApolloTaskResponse>(
        {
          success: false,
          error: "APOLLO_API_KEY is not configured",
        },
        { status: 500 }
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json<ApolloTaskResponse>(
        { success: false, error: "Invalid JSON in request body" },
        { status: 400 }
      );
    }
    if (!body || typeof body !== "object") {
      return NextResponse.json<ApolloTaskResponse>(
        { success: false, error: "Request body must be a JSON object" },
        { status: 400 }
      );
    }

    const { contact_id, type, priority, note } = body as ApolloTaskRequest;

    if (!contact_id || typeof contact_id !== "string") {
      return NextResponse.json<ApolloTaskResponse>(
        { success: false, error: "contact_id is required" },
        { status: 400 }
      );
    }

    // Get today's date in ISO format
    const today = new Date();
    const dueDate = today.toISOString().split("T")[0]; // YYYY-MM-DD format

    // Create task using Apollo API
    // API docs: https://apolloio.github.io/apollo-api-docs/#tag/Tasks
    const response = await fetch("https://api.apollo.io/api/v1/tasks", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "X-Api-Key": apolloApiKey,
      },
      body: JSON.stringify({
        contact_id: contact_id,
        user_id: DEFAULT_ASSIGNEE_ID,
        type: type || "action_item",
        priority: priority || "medium",
        due_date: dueDate,
        note: note || "Add to New User Signup sequence",
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Apollo create task error:", response.status, errorText);

      if (response.status === 401) {
        return NextResponse.json<ApolloTaskResponse>(
          { success: false, error: "Invalid Apollo API key" },
          { status: 401 }
        );
      }
      if (response.status === 404) {
        return NextResponse.json<ApolloTaskResponse>(
          { success: false, error: "Contact not found in Apollo" },
          { status: 404 }
        );
      }
      if (response.status === 429) {
        return NextResponse.json<ApolloTaskResponse>(
          { success: false, error: "Apollo API rate limit exceeded" },
          { status: 429 }
        );
      }

      return NextResponse.json<ApolloTaskResponse>(
        { success: false, error: `Apollo API error: ${response.status}` },
        { status: response.status }
      );
    }

    const data = await response.json();

    return NextResponse.json<ApolloTaskResponse>({
      success: true,
      taskId: data.task?.id || data.id,
    });
  } catch (error) {
    console.error("Apollo create task error:", error);
    return NextResponse.json<ApolloTaskResponse>(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to create task in Apollo",
      },
      { status: 500 }
    );
  }
}
