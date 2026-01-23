import { NextResponse } from "next/server";
import { Octokit } from "@octokit/rest";
import { config, GITHUB_ORG } from "@/lib/config";

interface OrgMember {
  login: string;
  avatar_url: string;
}

// GET - Fetch organization members
export async function GET(): Promise<NextResponse> {
  try {
    const githubToken = config.githubToken;
    if (!githubToken) {
      return NextResponse.json(
        { success: false, error: "GitHub bot token not configured" },
        { status: 500 }
      );
    }

    const octokit = new Octokit({ auth: githubToken });

    // Fetch members from organization
    const { data: members } = await octokit.orgs.listMembers({
      org: GITHUB_ORG,
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
