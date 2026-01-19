import { NextRequest, NextResponse } from "next/server";
import {
  getUsers,
  createUser,
  isInitialsTaken,
  UserRecord,
} from "@/lib/services/database";

interface UsersResponse {
  success: boolean;
  users?: UserRecord[];
  error?: string;
}

interface CreateUserRequest {
  name: string;
  initials: string;
}

interface CreateUserResponse {
  success: boolean;
  userId?: number;
  error?: string;
}

/**
 * GET /api/settings/users
 * Returns all active users.
 */
export async function GET(): Promise<NextResponse<UsersResponse>> {
  try {
    const users = await getUsers(true);
    return NextResponse.json({ success: true, users });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Failed to fetch users:", errorMessage);
    return NextResponse.json(
      { success: false, error: `Failed to fetch users: ${errorMessage}` },
      { status: 500 }
    );
  }
}

/**
 * POST /api/settings/users
 * Creates a new user.
 */
export async function POST(request: NextRequest): Promise<NextResponse<CreateUserResponse>> {
  try {
    const body: CreateUserRequest = await request.json();
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

    // Check for duplicate initials
    const taken = await isInitialsTaken(initials);
    if (taken) {
      return NextResponse.json(
        { success: false, error: "These initials are already taken" },
        { status: 400 }
      );
    }

    const userId = await createUser(name.trim(), initials.toUpperCase());
    return NextResponse.json({ success: true, userId });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Failed to create user:", errorMessage);
    return NextResponse.json(
      { success: false, error: `Failed to create user: ${errorMessage}` },
      { status: 500 }
    );
  }
}
