# Macroscope Code Review Tool

A Next.js web application for reviewing code with [Macroscope](https://macroscope.dev). This tool helps you get Macroscope code reviews on any GitHub pull request or commit, and analyze the findings with AI.

## Overview

This tool supports two main workflows:

### 1. PR Simulation (for external repositories)
When you want Macroscope to review code from a repository where you can't install the Macroscope GitHub app, this tool simulates the PR in your own fork:
- Forks the repository to your GitHub account
- Recreates the PR commits in your fork
- Creates a new PR that Macroscope can review

### 2. Internal PR Analysis (for your own repositories)
When you have repositories with Macroscope already installed, you can directly analyze PRs that Macroscope has already reviewed:
- Paste any PR URL from a repo with Macroscope installed
- Instantly analyze the Macroscope findings with Claude
- No forking or simulation required

Both workflows lead to AI-powered analysis that identifies meaningful bugs and generates outreach emails.

## Features

- **Simulate PR**: Recreate any GitHub PR in your fork for Macroscope review
- **Simulate Commit**: Review individual commits (latest or specific hash)
- **Analyze Internal PRs**: Analyze PRs from repos where Macroscope is already installed
- **AI Bug Analysis**: Claude identifies the most impactful bugs from Macroscope reviews
- **Email Generation**: Generate outreach emails with Attio merge fields
- **Fork Management**: View, search, and manage all your review PRs in one place

## How to Use

### Simulating a PR (External Repositories)

Use this when you want Macroscope to review a PR from a repository where you can't install the Macroscope app.

1. Open the web interface at `http://localhost:3000`
2. Click **Simulate PR** to open the creation modal
3. Select the **Recreate PR** tab
4. Paste the GitHub PR URL:
   ```
   https://github.com/owner/repo/pull/123
   ```
5. Click **Create Pull Request**
6. Wait for the simulation to complete (you'll see real-time progress)
7. Once complete, Macroscope will automatically review the PR in your fork

### Analyzing Internal PRs (Your Repositories)

Use this when Macroscope has already reviewed a PR in one of your repositories.

1. Open the web interface at `http://localhost:3000`
2. Click **Analyze PR**
3. Paste the PR URL and ensure **"This is an internal PR"** is checked
4. Click **Analyze**
5. View the AI analysis of Macroscope's findings

### My Repos Tab

The **My Repos** section shows all your review activity:

- **Simulated PRs**: Forks created by the PR simulation feature
- **Internal PRs**: PRs from your own repos that you've analyzed (marked with "Internal" badge)
- **Bug Counts**: See how many issues Macroscope found in each PR
- **Quick Actions**: Run analysis or view cached results directly from the list
- **Bulk Delete**: Select and delete repos or individual PRs

Data is cached locally in SQLite for instant loading. Click **Refresh** to sync with GitHub.

### PR Analysis

After Macroscope reviews a PR, run the AI analysis to:

1. **Identify Meaningful Bugs**: Filter out style suggestions and minor issues
2. **Classify by Severity**: Critical, High, or Medium impact
3. **Find Most Impactful**: Highlight the single best bug for outreach
4. **Generate Emails**: Create outreach emails with Attio merge fields

## How PR Simulation Works

The PR simulation feature recreates external PRs in your fork using a carefully designed process that avoids merge conflicts.

### The Challenge

When recreating a PR that has already been merged:
- The fork's `main` branch contains the merged commits
- Cherry-picking the same commits onto `main` would create conflicts
- The original PR's base commit may be outdated

### The Solution: Two-Branch Strategy

The tool creates two branches to ensure a clean PR:

```
Original Repository (upstream)
│
├── main ──────────────────────────────────────► (contains merged PR)
│         │
│         └── PR #123 commits: A → B → C
│                    │
│                    └── base commit (parent of first PR commit)
│
Your Fork
│
├── main ──────────────────────────────────────► (synced, contains merged PR)
│
├── base-for-pr-123 ──────────────────────────► (created at base commit)
│         │
│         └── review-pr-123 ──────────────────► (cherry-picked commits A → B → C)
│
└── PR: review-pr-123 → base-for-pr-123 (clean diff, no conflicts)
```

### Step-by-Step Process

1. **Parse PR URL**: Extract owner, repo, and PR number

2. **Fetch PR Details**: Get title, author, state, and all commits via GitHub API

3. **Find True Base Commit**:
   - Get the first commit in the PR
   - Use its parent as the base (the exact state before the PR started)
   - This ensures commits apply cleanly regardless of what's been merged since

4. **Check/Create Fork**:
   - Check if you already have a fork
   - If not, create one and wait for GitHub to process it

5. **Disable GitHub Actions**: Prevent workflows from running on your fork

6. **Clone Repository**: Clone your fork to a temporary directory

7. **Fetch Upstream Commits**: Add upstream remote and fetch all needed commits

8. **Create Base Branch**:
   - Create `base-for-pr-{N}` at the true base commit
   - This branch represents the state of the repo before the PR

9. **Create Review Branch**:
   - Create `review-pr-{N}` from the same base commit
   - Cherry-pick all PR commits (excluding merge commits) onto this branch

10. **Push Both Branches**: Push to your fork with force (handles re-simulations)

11. **Create Pull Request**:
    - PR goes from `review-pr-{N}` to `base-for-pr-{N}`
    - This creates a clean diff with exactly the PR's changes
    - No conflicts from other merged commits

### Why This Works

- **Isolated Base**: The base branch is frozen at the pre-PR state
- **Clean Diff**: PR only shows the actual changes from the original PR
- **Re-runnable**: Force push allows re-simulating the same PR
- **Merge Commits Skipped**: Only actual code changes are included

## Setup Guide

### Prerequisites

- [Node.js](https://nodejs.org/) 18 or later
- [Git](https://git-scm.com/) installed and configured
- A GitHub account with a Personal Access Token
- An Anthropic API Key (for AI analysis)

### 1. Install Dependencies

```bash
npm install
```

### 2. Create a GitHub Personal Access Token

1. Go to [GitHub Settings > Developer settings > Personal access tokens > Tokens (classic)](https://github.com/settings/tokens)
2. Click **Generate new token (classic)**
3. Select the `repo` scope (full control of private repositories)
4. Copy the token

### 3. Get an Anthropic API Key

1. Go to [Anthropic Console](https://console.anthropic.com/settings/keys)
2. Create an account or sign in
3. Click **Create Key**
4. Copy the API key

### 4. Configure Environment Variables

```bash
cp .env.local.example .env.local
```

Edit `.env.local`:

```
GITHUB_TOKEN=ghp_your_token_here
ANTHROPIC_API_KEY=sk-ant-your_key_here
```

### 5. Run the Application

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Technical Details

- **Framework**: Next.js 16 with App Router
- **UI**: React 19, Tailwind CSS v4
- **Git Operations**: [simple-git](https://github.com/steveukx/git-js)
- **GitHub API**: [@octokit/rest](https://github.com/octokit/rest.js)
- **AI Analysis**: [Anthropic SDK](https://github.com/anthropics/anthropic-sdk-typescript) with Claude
- **Database**: SQLite via [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)

### API Routes

| Route | Description |
|-------|-------------|
| `/api/create-pr` | PR simulation with SSE streaming |
| `/api/analyze-pr` | Analyze simulated PR findings |
| `/api/analyze-internal-pr` | Analyze internal PR findings |
| `/api/forks` | Fork management and sync |
| `/api/forks/check-bugs` | Count Macroscope comments |
| `/api/generate-email` | Generate outreach emails |
| `/api/prompts` | Manage analysis prompts |

## Troubleshooting

### "GitHub token not configured"
Create `.env.local` with your `GITHUB_TOKEN` and restart the dev server.

### "Cherry-pick failed" / Merge conflicts
The commit cannot be cleanly applied. This can happen if:
- The commit depends on other commits not in the PR
- There are actual conflicts requiring manual resolution
- Files referenced don't exist at the base commit

### "No Macroscope review found"
For internal PR analysis, ensure:
- The Macroscope GitHub app is installed on the repository
- Macroscope has actually reviewed the PR (check for review comments)

### PR simulation creates conflicts
This shouldn't happen with the two-branch strategy. If it does:
- Try deleting the existing branches in your fork
- Re-run the simulation

### Rate limiting
GitHub API has rate limits. Wait a few minutes and try again if you're creating many PRs quickly.

## Development

```bash
# Run development server
npm run dev

# Build for production
npm run build

# Start production server
npm start

# Run linter
npm run lint
```

## License

MIT
