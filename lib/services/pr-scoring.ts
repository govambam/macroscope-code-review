import { PRCandidate } from "@/lib/types/discover";

export function scorePRCandidate(pr: {
  number: number;
  title: string;
  html_url: string;
  state: string;
  merged_at: string | null;
  created_at: string;
  updated_at: string;
  additions: number;
  deletions: number;
  changed_files: number;
  commits: number;
  comments: number;
  review_comments: number;
  user: { login: string; avatar_url: string } | null;
  labels: { name: string }[];
  merged?: boolean;
}): PRCandidate {
  const total_lines_changed = pr.additions + pr.deletions;
  const author = pr.user?.login || "unknown";
  const is_bot = /bot|renovate|dependabot|greenkeeper/i.test(author);

  // Complexity score (0-100)
  // Weighted: lines matter most, then files, then commits
  const linesScore = Math.min(total_lines_changed / 20, 40); // 800+ lines = max 40 points
  const filesScore = Math.min(pr.changed_files * 3, 35); // 12+ files = max 35 points
  const commitsScore = Math.min(pr.commits * 2.5, 25); // 10+ commits = max 25 points
  const complexity_score = Math.round(linesScore + filesScore + commitsScore);

  // Recency score (0-100)
  // Open PRs are most valuable, then recently merged
  let recency_score = 0;
  const merged = pr.merged_at !== null;

  if (pr.state === "open") {
    recency_score = 100;
  } else if (merged && pr.merged_at) {
    const daysAgo = (Date.now() - new Date(pr.merged_at).getTime()) / (1000 * 60 * 60 * 24);
    if (daysAgo <= 3) recency_score = 95;
    else if (daysAgo <= 7) recency_score = 85;
    else if (daysAgo <= 14) recency_score = 70;
    else if (daysAgo <= 30) recency_score = 50;
    else if (daysAgo <= 60) recency_score = 30;
    else recency_score = 15;
  } else {
    // Closed but not merged - low value
    recency_score = 5;
  }

  // Activity score (0-100)
  // More discussion often indicates complexity or controversy
  const totalComments = pr.comments + pr.review_comments;
  const activity_score = Math.min(totalComments * 5, 100);

  // Overall score - weighted combination
  // Complexity: 50%, Recency: 35%, Activity: 15%
  const overall_score = Math.round(
    complexity_score * 0.5 + recency_score * 0.35 + activity_score * 0.15
  );

  return {
    number: pr.number,
    title: pr.title,
    html_url: pr.html_url,
    state: pr.state as "open" | "closed",
    merged,
    merged_at: pr.merged_at,
    created_at: pr.created_at,
    updated_at: pr.updated_at,
    additions: pr.additions,
    deletions: pr.deletions,
    changed_files: pr.changed_files,
    commits: pr.commits,
    comments: pr.comments,
    review_comments: pr.review_comments,
    author,
    author_avatar_url: pr.user?.avatar_url || "",
    is_bot,
    labels: pr.labels.map((l) => l.name),
    total_lines_changed,
    complexity_score,
    recency_score,
    activity_score,
    overall_score,
  };
}

export function filterAndSortCandidates(
  candidates: PRCandidate[],
  options: {
    include_open?: boolean;
    include_merged?: boolean;
    merged_within_days?: number;
    min_lines_changed?: number;
    max_results?: number;
  } = {}
): PRCandidate[] {
  const {
    include_open = true,
    include_merged = true,
    merged_within_days = 30,
    min_lines_changed = 50,
    max_results = 10,
  } = options;

  const now = Date.now();
  const cutoffDate = now - merged_within_days * 24 * 60 * 60 * 1000;

  return (
    candidates
      // Filter out bots
      .filter((pr) => !pr.is_bot)
      // Filter by state
      .filter((pr) => {
        if (pr.state === "open") return include_open;
        if (pr.merged) {
          if (!include_merged) return false;
          // Check recency for merged PRs
          if (pr.merged_at) {
            return new Date(pr.merged_at).getTime() >= cutoffDate;
          }
          return false;
        }
        // Closed but not merged - exclude
        return false;
      })
      // Filter by size
      .filter((pr) => pr.total_lines_changed >= min_lines_changed)
      // Sort by overall score
      .sort((a, b) => b.overall_score - a.overall_score)
      // Limit results
      .slice(0, max_results)
  );
}
