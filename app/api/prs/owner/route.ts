import { NextRequest, NextResponse } from "next/server";
import { getPRByUrl, updatePROwner } from "@/lib/services/database";

// PATCH - Update PR owner
export async function PATCH(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const { prUrl, owner } = body as { prUrl: string; owner: string };

    if (!prUrl || !owner) {
      return NextResponse.json(
        { success: false, error: "prUrl and owner are required" },
        { status: 400 }
      );
    }

    // Find the PR by URL
    const pr = getPRByUrl(prUrl);
    if (!pr) {
      return NextResponse.json(
        { success: false, error: "PR not found" },
        { status: 404 }
      );
    }

    // Update the owner
    updatePROwner(pr.id, owner);

    return NextResponse.json({
      success: true,
      prId: pr.id,
      owner,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 }
    );
  }
}
