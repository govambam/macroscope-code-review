import { NextRequest, NextResponse } from "next/server";
import {
  fetchRecentPRs,
  fetchPRDetails,
  fetchPRFiles,
  parseRepoUrl,
} from "@/lib/services/github-discover";
import { scorePRCandidate, filterAndSortCandidates } from "@/lib/services/pr-scoring";
import { assessPRRisk } from "@/lib/services/pr-risk-assessment";
import { DiscoverRequest, DiscoverResponse, PRCandidate } from "@/lib/types/discover";

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    const body: DiscoverRequest = await request.json();
    const { repo_url, mode = "fast", filters = {} } = body;

    // Validate required fields
    if (!repo_url || typeof repo_url !== "string") {
      return NextResponse.json(
        { error: "repo_url is required and must be a string" },
        { status: 400 }
      );
    }

    // Validate mode if provided
    if (mode !== "fast" && mode !== "advanced") {
      return NextResponse.json(
        { error: "mode must be 'fast' or 'advanced'" },
        { status: 400 }
      );
    }

    // Parse repo URL
    const parsed = parseRepoUrl(repo_url);
    if (!parsed) {
      return NextResponse.json(
        { error: "Invalid repository URL. Use format: owner/repo or https://github.com/owner/repo" },
        { status: 400 }
      );
    }

    const { owner, repo } = parsed;

    // Fetch recent PRs (basic info)
    const prs = await fetchRecentPRs(owner, repo, 100);

    // Fetch detailed info for each PR (need additions/deletions)
    // Batch in parallel but limit concurrency
    const batchSize = 10;
    const detailedPRs: PRCandidate[] = [];

    for (let i = 0; i < Math.min(prs.length, 50); i += batchSize) {
      const batch = prs.slice(i, i + batchSize);
      const details = await Promise.all(
        batch.map((pr) =>
          fetchPRDetails(owner, repo, pr.number)
            .then((detail) => scorePRCandidate(detail))
            .catch(() => null)
        )
      );
      detailedPRs.push(...details.filter((d): d is PRCandidate => d !== null));
    }

    // Filter and sort
    let candidates = filterAndSortCandidates(detailedPRs, {
      include_open: filters.include_open ?? true,
      include_merged: filters.include_merged ?? true,
      merged_within_days: filters.merged_within_days ?? 30,
      min_lines_changed: filters.min_lines_changed ?? 50,
      max_results: filters.max_results ?? 10,
    });

    // Advanced mode: add LLM risk assessment
    if (mode === "advanced" && candidates.length > 0) {
      // Only assess top candidates to limit API calls
      const topCandidates = candidates.slice(0, Math.min(candidates.length, 5));

      const assessedCandidates = await Promise.all(
        topCandidates.map(async (candidate) => {
          try {
            // Fetch files for this PR
            const files = await fetchPRFiles(owner, repo, candidate.number);

            // Get LLM assessment
            const { assessment, categories } = await assessPRRisk(
              candidate.title,
              candidate.total_lines_changed,
              files
            );

            return {
              ...candidate,
              files_changed: files.map((f) => f.filename),
              risk_assessment: assessment,
              risk_categories: categories,
            };
          } catch (error) {
            console.error(`Failed to assess PR #${candidate.number}:`, error);
            return candidate;
          }
        })
      );

      // Replace top candidates with assessed versions, keep rest as-is
      candidates = [...assessedCandidates, ...candidates.slice(topCandidates.length)];
    }

    const response: DiscoverResponse = {
      owner,
      repo,
      mode,
      total_prs_analyzed: detailedPRs.length,
      candidates,
      analysis_time_ms: Date.now() - startTime,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Discover PRs error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to discover PRs" },
      { status: 500 }
    );
  }
}
