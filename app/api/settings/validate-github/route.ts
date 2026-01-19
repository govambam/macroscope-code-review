import { NextRequest, NextResponse } from "next/server";

interface ValidateGitHubRequest {
  token: string;
}

interface ValidateGitHubResponse {
  success: boolean;
  username?: string;
  error?: string;
}

/**
 * POST /api/settings/validate-github
 * Validates a GitHub token by fetching user info.
 */
export async function POST(request: NextRequest): Promise<NextResponse<ValidateGitHubResponse>> {
  try {
    const body: ValidateGitHubRequest = await request.json();
    const { token } = body;

    if (!token || !token.trim()) {
      return NextResponse.json(
        { success: false, error: "Token is required" },
        { status: 400 }
      );
    }

    // Test the token by fetching user info
    const response = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    if (!response.ok) {
      if (response.status === 401) {
        return NextResponse.json(
          { success: false, error: "Invalid token" },
          { status: 200 } // Return 200 with error in body, not 401
        );
      }
      if (response.status === 403) {
        return NextResponse.json(
          { success: false, error: "Token lacks required permissions" },
          { status: 200 }
        );
      }
      return NextResponse.json(
        { success: false, error: `GitHub API error: ${response.status}` },
        { status: 200 }
      );
    }

    const userData = await response.json();
    const username = userData.login;

    return NextResponse.json({ success: true, username });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("GitHub validation error:", errorMessage);
    return NextResponse.json(
      { success: false, error: `Validation failed: ${errorMessage}` },
      { status: 500 }
    );
  }
}
