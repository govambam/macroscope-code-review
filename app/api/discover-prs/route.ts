import { NextRequest, NextResponse } from "next/server";
import {
  fetchRecentPRs,
  fetchPRDetails,
  fetchPRFiles,
  parseRepoUrl,
  areAllCommitsAfterCutoff,
  fetchOrgRecentPRs,
  calculateOrgMonthlyMetrics,
} from "@/lib/services/github-discover";
import { scorePRCandidate, filterAndSortCandidates } from "@/lib/services/pr-scoring";
import { batchScorePRsForBugLikelihood } from "@/lib/services/pr-risk-assessment";
import { loadPrompt } from "@/lib/services/prompt-loader";
import { DiscoverRequest, DiscoverResponse, PRCandidate } from "@/lib/types/discover";
import { saveOrgMetrics, deleteOrgMetrics } from "@/lib/services/database";

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    const body: DiscoverRequest = await request.json();
    const { repo_url, org, mode = "fast", filters = {} } = body;

    // Validate: must have either repo_url or org, but not both
    if (!repo_url && !org) {
      return NextResponse.json(
        { error: "Either repo_url or org is required" },
        { status: 400 }
      );
    }

    if (repo_url && org) {
      return NextResponse.json(
        { error: "Cannot specify both repo_url and org. Choose one." },
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

    let owner: string;
    let repo: string | undefined;
    let prs: Array<Awaited<ReturnType<typeof fetchRecentPRs>>[number] & { repo_owner?: string; repo_name?: string }>;
    let isOrgSearch = false;

    if (org) {
      // Org-level search
      isOrgSearch = true;
      owner = org;
      prs = await fetchOrgRecentPRs(org, 100);
    } else {
      // Repo-level search
      const parsed = parseRepoUrl(repo_url!);
      if (!parsed) {
        return NextResponse.json(
          { error: "Invalid repository URL. Use format: owner/repo or https://github.com/owner/repo" },
          { status: 400 }
        );
      }
      owner = parsed.owner;
      repo = parsed.repo;
      prs = await fetchRecentPRs(owner, repo, 100);
    }

    // Fetch detailed info for each PR (need additions/deletions)
    // Batch in parallel but limit concurrency
    const batchSize = 10;
    const detailedPRs: PRCandidate[] = [];

    for (let i = 0; i < Math.min(prs.length, 50); i += batchSize) {
      const batch = prs.slice(i, i + batchSize);
      const details = await Promise.all(
        batch.map(async (pr) => {
          try {
            const prOwner = isOrgSearch && pr.repo_owner ? pr.repo_owner : owner;
            const prRepo = isOrgSearch && pr.repo_name ? pr.repo_name : repo!;

            // Check if all commits are after the cutoff date (Jan 1, 2026)
            const commitsValid = await areAllCommitsAfterCutoff(prOwner, prRepo, pr.number);
            if (!commitsValid) {
              return null; // Skip PRs with commits before cutoff
            }

            const detail = await fetchPRDetails(prOwner, prRepo, pr.number);
            const candidate = scorePRCandidate(detail);

            // Add repo info for org-level searches
            if (isOrgSearch) {
              candidate.repo_owner = prOwner;
              candidate.repo_name = prRepo;
            }

            return candidate;
          } catch {
            return null;
          }
        })
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

    // Advanced mode: LLM-assisted reranking
    if (mode === "advanced" && candidates.length > 0) {
      try {
        // Load the discover-scoring prompt from database
        const promptTemplate = loadPrompt("discover-scoring");

        // Step 1: Filter to reasonable candidates for LLM analysis
        const eligibleForLLM = candidates
          .filter(pr => !pr.is_bot)
          .filter(pr => pr.total_lines_changed >= 50)
          .filter(pr => {
            if (pr.state === 'open') return true;
            if (pr.merged && pr.merged_at) {
              const daysAgo = (Date.now() - new Date(pr.merged_at).getTime()) / (1000 * 60 * 60 * 24);
              return daysAgo <= 30;
            }
            return false;
          })
          .sort((a, b) => b.overall_score - a.overall_score)
          .slice(0, 18);  // Take top 18 by fast score

        if (eligibleForLLM.length > 0) {
          // Step 2: Fetch files for each PR
          const prsWithFiles = await Promise.all(
            eligibleForLLM.map(async (pr) => {
              try {
                const prOwner = isOrgSearch && pr.repo_owner ? pr.repo_owner : owner;
                const prRepo = isOrgSearch && pr.repo_name ? pr.repo_name : repo!;
                const files = await fetchPRFiles(prOwner, prRepo, pr.number);
                return {
                  number: pr.number,
                  title: pr.title,
                  files: files.slice(0, 20).map(f => ({
                    filename: f.filename,
                    additions: f.additions,
                    deletions: f.deletions
                  }))
                };
              } catch (error) {
                console.error(`Failed to fetch files for PR #${pr.number}:`, error);
                return {
                  number: pr.number,
                  title: pr.title,
                  files: []
                };
              }
            })
          );

          // Filter out PRs where we couldn't get files
          const prsToScore = prsWithFiles.filter(pr => pr.files.length > 0);

          if (prsToScore.length > 0) {
            // Step 3: Batch score with LLM
            const llmScores = await batchScorePRsForBugLikelihood(
              prsToScore,
              promptTemplate
            );

            const llmScoreMap = new Map(
              llmScores.map(s => [s.pr_number, s])
            );

            // Create a map of files for each PR
            const filesMap = new Map(
              prsWithFiles.map(p => [p.number, p.files.map(f => f.filename)])
            );

            // Step 4: Combine scores and rerank
            const rerankedCandidates = eligibleForLLM.map(pr => {
              const llmResult = llmScoreMap.get(pr.number);
              const llmScore = llmResult?.bug_likelihood_score ?? 5;

              // Normalize LLM score (1-10) to 0-100 scale
              const normalizedLLMScore = llmScore * 10;

              // Combined: 40% fast heuristic + 60% LLM judgment
              const combinedScore = (pr.overall_score * 0.4) + (normalizedLLMScore * 0.6);

              return {
                ...pr,
                fast_score: pr.overall_score,
                overall_score: Math.round(combinedScore),
                bug_likelihood_score: llmScore,
                risk_assessment: llmResult?.risk_reason ?? undefined,
                risk_categories: llmResult?.risk_categories ?? [],
                files_changed: filesMap.get(pr.number) ?? []
              };
            });

            // Step 5: Sort by combined score and return top results
            candidates = rerankedCandidates
              .sort((a, b) => b.overall_score - a.overall_score)
              .slice(0, filters.max_results ?? 10);
          }
        }
      } catch (error) {
        console.error('LLM scoring failed, falling back to fast scores:', error);
        // Just use the fast-scored candidates without reranking
        candidates = candidates.slice(0, filters.max_results ?? 10);
      }
    }

    // For org-level searches, calculate and store monthly metrics
    let monthlyMetrics = undefined;
    if (isOrgSearch) {
      try {
        monthlyMetrics = await calculateOrgMonthlyMetrics(org!);

        // Store metrics in the database (will be deleted if user doesn't simulate any PRs)
        saveOrgMetrics(
          monthlyMetrics.org,
          monthlyMetrics.monthly_prs,
          monthlyMetrics.monthly_commits,
          monthlyMetrics.monthly_lines_changed,
          monthlyMetrics.period_start,
          monthlyMetrics.period_end,
          monthlyMetrics.calculated_at
        );
      } catch (error) {
        console.error('Failed to calculate org metrics:', error);
        // Continue without metrics
      }
    }

    // If no usable candidates found, delete the stored metrics
    if (isOrgSearch && candidates.length === 0) {
      deleteOrgMetrics(org!);
      monthlyMetrics = undefined;
    }

    const response: DiscoverResponse = {
      owner,
      ...(repo ? { repo } : {}),
      ...(isOrgSearch ? { org: org! } : {}),
      mode,
      total_prs_analyzed: detailedPRs.length,
      candidates,
      analysis_time_ms: Date.now() - startTime,
      ...(monthlyMetrics ? { monthly_metrics: monthlyMetrics } : {}),
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
