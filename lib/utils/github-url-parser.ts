export interface ParsedPRUrl {
  owner: string;
  repo: string;
  prNumber: number;
  isValid: boolean;
  error?: string;
}

export interface ParsedRepo {
  owner: string;
  repo: string;
  isValid: boolean;
  error?: string;
}

export function parseGitHubPRUrl(url: string): ParsedPRUrl {
  const regex = /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/;
  const match = url.trim().match(regex);

  if (!match) {
    return {
      owner: "",
      repo: "",
      prNumber: 0,
      isValid: false,
      error: "Invalid GitHub PR URL. Format: https://github.com/owner/repo/pull/123",
    };
  }

  return {
    owner: match[1],
    repo: match[2],
    prNumber: parseInt(match[3], 10),
    isValid: true,
  };
}

export function parseGitHubRepo(input: string): ParsedRepo {
  const regex = /^([^/\s]+)\/([^/\s]+)$/;
  const match = input.trim().match(regex);

  if (!match) {
    return {
      owner: "",
      repo: "",
      isValid: false,
      error: "Invalid format. Use: owner/repo (e.g., vercel/next.js)",
    };
  }

  return {
    owner: match[1],
    repo: match[2],
    isValid: true,
  };
}
