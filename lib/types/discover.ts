export interface PRCandidate {
  number: number;
  title: string;
  html_url: string;
  state: 'open' | 'closed';
  merged: boolean;
  merged_at: string | null;
  created_at: string;
  updated_at: string;

  // Complexity metrics from GitHub API
  additions: number;
  deletions: number;
  changed_files: number;
  commits: number;

  // Review activity
  comments: number;
  review_comments: number;

  // Metadata
  author: string;
  author_avatar_url: string;
  is_bot: boolean;
  labels: string[];

  // Computed scores (0-100 scale)
  total_lines_changed: number;
  complexity_score: number;
  recency_score: number;
  activity_score: number;
  overall_score: number;

  // LLM enhancement (only populated in advanced search)
  risk_assessment?: string;
  risk_categories?: string[]; // e.g., ['concurrency', 'auth', 'data-handling']
  files_changed?: string[];
}

export interface DiscoverRequest {
  repo_url: string; // e.g., "https://github.com/owner/repo" or "owner/repo"
  mode: 'fast' | 'advanced';
  filters?: {
    include_open?: boolean;      // default: true
    include_merged?: boolean;    // default: true
    merged_within_days?: number; // default: 30
    min_lines_changed?: number;  // default: 50
    max_results?: number;        // default: 10
  };
}

export interface DiscoverResponse {
  owner: string;
  repo: string;
  mode: 'fast' | 'advanced';
  total_prs_analyzed: number;
  candidates: PRCandidate[];
  analysis_time_ms: number;
}
