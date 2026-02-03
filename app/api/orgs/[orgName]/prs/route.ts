import { NextResponse } from "next/server";
import { getPRsForOrg } from "@/lib/services/database";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgName: string }> }
) {
  try {
    const { orgName } = await params;

    if (!orgName) {
      return NextResponse.json(
        { success: false, error: "Organization name is required" },
        { status: 400 }
      );
    }

    const rows = getPRsForOrg(orgName);

    // Group flat rows by repo
    const repoMap = new Map<
      string,
      {
        repoName: string;
        fullName: string;
        forkOwner: string;
        prs: Array<{
          id: number;
          prNumber: number;
          title: string | null;
          forkedPrUrl: string;
          originalPrUrl: string | null;
          originalPrTitle: string | null;
          hasMacroscopeBugs: boolean;
          bugCount: number | null;
          hasAnalysis: boolean;
          analysisId: number | null;
          state: string | null;
          createdAt: string;
        }>;
      }
    >();

    for (const row of rows) {
      if (!repoMap.has(row.repo_name)) {
        repoMap.set(row.repo_name, {
          repoName: row.repo_name,
          fullName: `${orgName}/${row.repo_name}`,
          forkOwner: row.fork_owner,
          prs: [],
        });
      }
      repoMap.get(row.repo_name)!.prs.push({
        id: row.pr_id,
        prNumber: row.pr_number,
        title: row.pr_title,
        forkedPrUrl: row.forked_pr_url,
        originalPrUrl: row.original_pr_url,
        originalPrTitle: row.original_pr_title,
        hasMacroscopeBugs: !!row.has_macroscope_bugs,
        bugCount: row.bug_count,
        hasAnalysis: !!row.has_analysis,
        analysisId: row.analysis_id,
        state: row.state,
        createdAt: row.created_at,
      });
    }

    const repos = Array.from(repoMap.values());
    const totalPRs = repos.reduce((sum, r) => sum + r.prs.length, 0);

    return NextResponse.json({
      success: true,
      org: orgName,
      totalPRs,
      repos,
    });
  } catch (error) {
    console.error("Org PRs error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch PRs for organization" },
      { status: 500 }
    );
  }
}
