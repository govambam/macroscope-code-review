import { NextRequest, NextResponse } from "next/server";
import { deleteFork, deletePRById } from "@/lib/services/database";

interface DeleteRequest {
  prIds?: number[];
  forks?: Array<{ repoOwner: string; repoName: string }>;
}

interface DeleteResponse {
  success: boolean;
  deletedPRs: number[];
  deletedForks: string[];
  errors: string[];
}

/**
 * DELETE /api/db/delete
 *
 * Deletes forks and/or PRs from the database only.
 * No GitHub API calls are made. Cascade deletes handle
 * analyses and emails automatically.
 */
export async function DELETE(request: NextRequest): Promise<NextResponse> {
  try {
    const body: DeleteRequest = await request.json();
    const { prIds, forks } = body;

    if ((!prIds || prIds.length === 0) && (!forks || forks.length === 0)) {
      return NextResponse.json<DeleteResponse>(
        { success: false, deletedPRs: [], deletedForks: [], errors: ["No prIds or forks provided"] },
        { status: 400 }
      );
    }

    const deletedPRs: number[] = [];
    const deletedForks: string[] = [];
    const errors: string[] = [];

    // Delete individual PRs
    if (prIds) {
      for (const prId of prIds) {
        try {
          const deleted = deletePRById(prId);
          if (deleted) {
            deletedPRs.push(prId);
          } else {
            errors.push(`PR ${prId} not found`);
          }
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          errors.push(`Failed to delete PR ${prId}: ${msg}`);
        }
      }
    }

    // Delete entire forks (cascades to PRs, analyses, emails)
    if (forks) {
      for (const fork of forks) {
        try {
          const deleted = deleteFork(fork.repoOwner, fork.repoName);
          if (deleted) {
            deletedForks.push(`${fork.repoOwner}/${fork.repoName}`);
          } else {
            errors.push(`Fork ${fork.repoOwner}/${fork.repoName} not found`);
          }
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          errors.push(`Failed to delete fork ${fork.repoOwner}/${fork.repoName}: ${msg}`);
        }
      }
    }

    return NextResponse.json<DeleteResponse>({
      success: true,
      deletedPRs,
      deletedForks,
      errors,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json<DeleteResponse>(
      { success: false, deletedPRs: [], deletedForks: [], errors: [errorMessage] },
      { status: 500 }
    );
  }
}
