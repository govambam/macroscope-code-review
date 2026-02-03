import { NextRequest, NextResponse } from "next/server";
import {
  getProspectingSessionWithStats,
  updateProspectingSession,
  deleteProspectingSession,
  getPRsForSession,
  ProspectingSessionStatus,
} from "@/lib/services/database";

/**
 * GET /api/sessions/[id]
 * Get a single session with statistics and related PRs.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: idParam } = await params;
    const id = parseInt(idParam, 10);

    if (isNaN(id)) {
      return NextResponse.json(
        { success: false, error: "Invalid session ID" },
        { status: 400 }
      );
    }

    const session = getProspectingSessionWithStats(id);

    if (!session) {
      return NextResponse.json(
        { success: false, error: "Session not found" },
        { status: 404 }
      );
    }

    const prs = getPRsForSession(id);

    return NextResponse.json({
      success: true,
      session,
      prs,
    });
  } catch (error) {
    console.error("Get session error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to get session" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/sessions/[id]
 * Update a session. Automatically updates `updated_at`.
 *
 * Body (all optional):
 * - company_name: string
 * - github_org: string | null
 * - github_repo: string | null
 * - status: 'in_progress' | 'completed'
 * - notes: string | null
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: idParam } = await params;
    const id = parseInt(idParam, 10);

    if (isNaN(id)) {
      return NextResponse.json(
        { success: false, error: "Invalid session ID" },
        { status: 400 }
      );
    }

    const body = await request.json();

    if (body === null || typeof body !== "object") {
      return NextResponse.json(
        { success: false, error: "Request body must be a JSON object" },
        { status: 400 }
      );
    }

    const { company_name, github_org, github_repo, status, notes } = body;

    // Validate status if provided
    if (status !== undefined && status !== "in_progress" && status !== "completed") {
      return NextResponse.json(
        { success: false, error: "status must be 'in_progress' or 'completed'" },
        { status: 400 }
      );
    }

    const updated = updateProspectingSession(id, {
      companyName: company_name,
      githubOrg: github_org,
      githubRepo: github_repo,
      status: status as ProspectingSessionStatus | undefined,
      notes,
    });

    if (!updated) {
      return NextResponse.json(
        { success: false, error: "Session not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Session updated",
    });
  } catch (error) {
    console.error("Update session error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to update session" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/sessions/[id]
 * Delete a session. Associated PRs are unlinked (not deleted).
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: idParam } = await params;
    const id = parseInt(idParam, 10);

    if (isNaN(id)) {
      return NextResponse.json(
        { success: false, error: "Invalid session ID" },
        { status: 400 }
      );
    }

    const deleted = deleteProspectingSession(id);

    if (!deleted) {
      return NextResponse.json(
        { success: false, error: "Session not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Session deleted",
    });
  } catch (error) {
    console.error("Delete session error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to delete session" },
      { status: 500 }
    );
  }
}
