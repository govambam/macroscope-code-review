import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  createProspectingSession,
  getAllProspectingSessions,
  ProspectingSessionStatus,
  ProspectorWorkflowType,
} from "@/lib/services/database";

/**
 * GET /api/sessions
 * List all prospecting sessions with statistics.
 *
 * Query params:
 * - search: filter by company name (partial match)
 * - status: filter by status ('in_progress' | 'completed')
 * - createdBy: filter by creator username
 * - sortBy: 'updated_at' (default) | 'created_at' | 'company_name'
 * - sortOrder: 'desc' (default) | 'asc'
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search") || undefined;
    const status = searchParams.get("status") as ProspectingSessionStatus | null;
    const createdBy = searchParams.get("createdBy") || undefined;
    const sortByParam = searchParams.get("sortBy");
    const sortBy = (["updated_at", "created_at", "company_name"].includes(sortByParam ?? "") ? sortByParam : null) as "updated_at" | "created_at" | "company_name" | null;
    const sortOrderParam = searchParams.get("sortOrder");
    const sortOrder = (sortOrderParam === "asc" || sortOrderParam === "desc" ? sortOrderParam : null) as "asc" | "desc" | null;

    const sessions = getAllProspectingSessions({
      search,
      status: status || undefined,
      createdBy,
      sortBy: sortBy || undefined,
      sortOrder: sortOrder || undefined,
    });

    return NextResponse.json({
      success: true,
      sessions,
      total: sessions.length,
    });
  } catch (error) {
    console.error("List sessions error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to list sessions" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/sessions
 * Create a new prospecting session.
 *
 * Body:
 * - company_name: string (required)
 * - github_org?: string
 * - github_repo?: string
 * - notes?: string
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const createdBy = session?.user?.name || session?.user?.email || "unknown";

    const body = await request.json();
    const { company_name, github_org, github_repo, notes, workflow_type, apollo_account_id } = body;

    if (!company_name || typeof company_name !== "string" || !company_name.trim()) {
      return NextResponse.json(
        { success: false, error: "company_name is required" },
        { status: 400 }
      );
    }

    // Validate workflow_type if provided
    const validWorkflowTypes = ['pr-analysis', 'signup-outreach'];
    const workflowType = validWorkflowTypes.includes(workflow_type) ? workflow_type as ProspectorWorkflowType : 'pr-analysis';

    const id = createProspectingSession(company_name.trim(), createdBy, {
      githubOrg: typeof github_org === "string" ? github_org.trim() || null : null,
      githubRepo: typeof github_repo === "string" ? github_repo.trim() || null : null,
      notes: typeof notes === "string" ? notes.trim() || null : null,
      workflowType,
      apolloAccountId: typeof apollo_account_id === "string" ? apollo_account_id.trim() || null : null,
    });

    return NextResponse.json({
      success: true,
      id,
      message: "Session created",
    });
  } catch (error) {
    console.error("Create session error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to create session" },
      { status: 500 }
    );
  }
}
