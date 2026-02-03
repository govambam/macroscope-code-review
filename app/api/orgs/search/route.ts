import { NextResponse } from "next/server";
import { searchOrgsWithPRCounts } from "@/lib/services/database";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q");

    if (!q || !q.trim()) {
      return NextResponse.json(
        { success: false, error: "Query parameter 'q' is required" },
        { status: 400 }
      );
    }

    const results = searchOrgsWithPRCounts(q.trim());

    return NextResponse.json({
      success: true,
      orgs: results.map((r) => ({ org: r.org, prCount: r.pr_count })),
    });
  } catch (error) {
    console.error("Org search error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to search organizations" },
      { status: 500 }
    );
  }
}
