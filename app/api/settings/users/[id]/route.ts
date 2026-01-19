import { NextRequest, NextResponse } from "next/server";
import {
  getUserById,
  updateUser,
  deactivateUser,
  isInitialsTaken,
} from "@/lib/services/database";

interface UpdateUserRequest {
  name: string;
  initials: string;
}

interface UserResponse {
  success: boolean;
  error?: string;
}

/**
 * PUT /api/settings/users/[id]
 * Updates a user.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse<UserResponse>> {
  try {
    const { id: idStr } = await params;
    const id = parseInt(idStr, 10);

    if (isNaN(id)) {
      return NextResponse.json(
        { success: false, error: "Invalid user ID" },
        { status: 400 }
      );
    }

    const body: UpdateUserRequest = await request.json();
    const { name, initials } = body;

    // Validate required fields
    if (!name || !name.trim()) {
      return NextResponse.json(
        { success: false, error: "Name is required" },
        { status: 400 }
      );
    }

    if (!initials || initials.length < 2 || initials.length > 3) {
      return NextResponse.json(
        { success: false, error: "Initials must be 2-3 characters" },
        { status: 400 }
      );
    }

    // Check if user exists
    const existingUser = await getUserById(id);
    if (!existingUser) {
      return NextResponse.json(
        { success: false, error: "User not found" },
        { status: 404 }
      );
    }

    // Check for duplicate initials (excluding current user)
    const taken = await isInitialsTaken(initials, id);
    if (taken) {
      return NextResponse.json(
        { success: false, error: "These initials are already taken" },
        { status: 400 }
      );
    }

    const updated = await updateUser(id, name.trim(), initials.toUpperCase());
    if (!updated) {
      return NextResponse.json(
        { success: false, error: "Failed to update user" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Failed to update user:", errorMessage);
    return NextResponse.json(
      { success: false, error: `Failed to update user: ${errorMessage}` },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/settings/users/[id]
 * Soft deletes (deactivates) a user.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse<UserResponse>> {
  try {
    const { id: idStr } = await params;
    const id = parseInt(idStr, 10);

    if (isNaN(id)) {
      return NextResponse.json(
        { success: false, error: "Invalid user ID" },
        { status: 400 }
      );
    }

    // Check if user exists
    const existingUser = await getUserById(id);
    if (!existingUser) {
      return NextResponse.json(
        { success: false, error: "User not found" },
        { status: 404 }
      );
    }

    const deactivated = await deactivateUser(id);
    if (!deactivated) {
      return NextResponse.json(
        { success: false, error: "Failed to remove user" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Failed to remove user:", errorMessage);
    return NextResponse.json(
      { success: false, error: `Failed to remove user: ${errorMessage}` },
      { status: 500 }
    );
  }
}
