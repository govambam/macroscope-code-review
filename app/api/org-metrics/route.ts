import { NextRequest, NextResponse } from "next/server";
import {
  getOrgMetrics,
  deleteOrgMetrics,
  getAllOrgMetrics,
  OrgMetricsRecord,
} from "@/lib/services/database";

/**
 * GET /api/org-metrics
 * Retrieves org metrics.
 *
 * Query params:
 * - org: (optional) specific org to get metrics for
 *
 * If org is provided, returns metrics for that org.
 * Otherwise, returns all org metrics.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const org = searchParams.get("org");

    if (org) {
      const metrics = getOrgMetrics(org);
      if (!metrics) {
        return NextResponse.json(
          { error: `No metrics found for org: ${org}` },
          { status: 404 }
        );
      }
      return NextResponse.json(metrics);
    }

    // Return all org metrics
    const allMetrics = getAllOrgMetrics();
    return NextResponse.json(allMetrics);
  } catch (error) {
    console.error("Get org metrics error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to get org metrics" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/org-metrics
 * Deletes org metrics (used when user cancels PR discovery without simulating).
 *
 * Query params:
 * - org: (required) the org to delete metrics for
 */
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const org = searchParams.get("org");

    if (!org) {
      return NextResponse.json(
        { error: "org parameter is required" },
        { status: 400 }
      );
    }

    const deleted = deleteOrgMetrics(org);

    if (!deleted) {
      return NextResponse.json(
        { message: `No metrics found for org: ${org}`, deleted: false }
      );
    }

    return NextResponse.json({
      message: `Metrics deleted for org: ${org}`,
      deleted: true,
    });
  } catch (error) {
    console.error("Delete org metrics error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete org metrics" },
      { status: 500 }
    );
  }
}
