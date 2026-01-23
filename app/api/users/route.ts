import { NextResponse } from "next/server";
import { Octokit } from "@octokit/rest";

interface OrgMember {
  login: string;
  avatar_url: string;
}

// GET - Fetch organization members
export async function GET(): Promise<NextResponse> {
  try {
    const githubToken = process.env.GITHUB_TOKEN;
    if (!githubToken) {
      return NextResponse.json(
        { success: false, error: "GitHub token not configured" },
        { status: 500 }
      );
    }

    const octokit = new Octokit({ auth: githubToken });

    // Fetch members from macroscope-gtm org
    const { data: members } = await octokit.orgs.listMembers({
      org: "macroscope-gtm",
      per_page: 100,
    });

    const users: OrgMember[] = members.map((member) => ({
      login: member.login,
      avatar_url: member.avatar_url,
    }));

    return NextResponse.json({
      success: true,
      users,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 }
    );
  }
}
