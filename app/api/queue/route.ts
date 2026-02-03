import { NextRequest, NextResponse } from "next/server";
import {
  getPendingOperations,
  getQueueStatus,
  getQueueEntriesByIds,
  deleteQueueEntry,
  GithubOperationQueueRecord,
} from "@/lib/services/database";

/**
 * GET /api/queue
 * Get queue status and pending operations.
 *
 * Query params:
 * - ids: comma-separated list of operation IDs to fetch specific entries
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const idsParam = searchParams.get("ids");

    if (idsParam) {
      // Fetch specific operations by IDs
      const ids = idsParam.split(",").map(id => parseInt(id.trim(), 10)).filter(id => !isNaN(id));
      const operations = getQueueEntriesByIds(ids);
      return NextResponse.json({ operations });
    }

    // Get general queue status
    const status = getQueueStatus();
    const pending = getPendingOperations();

    return NextResponse.json({
      status,
      pending: pending.map(formatOperation),
    });
  } catch (error) {
    console.error("Queue status error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to get queue status" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/queue
 * Cancel a queued operation.
 *
 * Query params:
 * - id: the operation ID to cancel (must be in 'queued' status)
 */
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const idParam = searchParams.get("id");

    if (!idParam) {
      return NextResponse.json(
        { error: "id parameter is required" },
        { status: 400 }
      );
    }

    const id = parseInt(idParam, 10);
    if (isNaN(id)) {
      return NextResponse.json(
        { error: "Invalid id parameter" },
        { status: 400 }
      );
    }

    const deleted = deleteQueueEntry(id);

    if (!deleted) {
      return NextResponse.json(
        { error: "Operation not found or cannot be cancelled (already processing)" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, message: "Operation cancelled" });
  } catch (error) {
    console.error("Queue cancel error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to cancel operation" },
      { status: 500 }
    );
  }
}

/**
 * Format operation for API response (parse JSON fields).
 */
function formatOperation(op: GithubOperationQueueRecord) {
  return {
    id: op.id,
    operation_type: op.operation_type,
    payload: JSON.parse(op.payload),
    status: op.status,
    priority: op.priority,
    result: op.result ? JSON.parse(op.result) : null,
    error: op.error,
    created_at: op.created_at,
    started_at: op.started_at,
    completed_at: op.completed_at,
    created_by: op.created_by,
  };
}
