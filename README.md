# Macroscope PR Creator

A Next.js web application that automatically forks GitHub repositories and recreates commits or pull requests for [Macroscope](https://macroscope.dev) code reviews.

## Overview

When you want Macroscope to review code from any public GitHub repository, this tool automates the entire workflow. It supports three main features:

**Latest Commit Mode**: Review the latest commit (or a specific commit) from any repository
- Forks the repository to your GitHub account
- Creates a new branch from the commit's parent
- Cherry-picks the target commit onto that branch
- Creates a pull request within your fork

**Recreate PR Mode**: Recreate any existing GitHub PR for review
- Paste any GitHub PR URL directly
- Automatically fetches all commits from the original PR
- Recreates the PR in your fork with all original commits preserved

**PR Analysis**: Analyze Macroscope findings with AI
- Uses Claude to identify the most impactful bugs from Macroscope reviews
- Classifies bugs by severity (critical, high, medium)
- Generates outreach emails with Attio merge fields

This gives Macroscope a clean PR to analyze, containing exactly the changes you want to review.

### Why This Exists

Macroscope reviews pull requests, but sometimes you want to review:
- Commits that were pushed directly to main
- Commits that were merged without a PR
- PRs from repositories you don't have access to
- Historical PRs that have already been merged

This tool bridges that gap by recreating any commit or PR as a reviewable PR in your own fork.

## How to Use

### Mode 1: Latest Commit

Use this mode to review commits from any repository.

1. Open the web interface at `http://localhost:3000`

2. Select the **Latest Commit** tab

3. Enter the **original repository URL** (not your fork):
   ```
   https://github.com/getsentry/sentry-python
   ```

4. Choose your commit:
   - **Default**: Leave "Specify commit" unchecked to review the latest commit on main
   - **Specific commit**: Check the box and enter a commit hash to review a particular commit

5. Click **Create Pull Request**

6. Wait for the process to complete

7. Click the PR link or copy it to your clipboard

### Mode 2: Recreate PR

Use this mode to recreate any existing GitHub PR.

1. Open the web interface at `http://localhost:3000`

2. Select the **Recreate PR** tab

3. Paste the **PR URL** you want to recreate:
   ```
   https://github.com/owner/repo/pull/123
   ```

4. Click **Create Pull Request**

5. The tool will:
   - Fetch all commits from the original PR
   - Fork the repository (if not already forked)
   - Create a branch from the correct base commit
   - Cherry-pick all PR commits in order
   - Create a new PR with a detailed description

6. Click the PR link or copy it to your clipboard

The recreated PR includes:
- Title prefixed with `[Review]`
- Link to the original PR
- Original author and PR status
- List of all commits included

### My Forks Tab

The **My Forks** tab helps you manage all your review PRs in one place:

1. Click **Refresh** to fetch all your forked repositories from GitHub
2. View a hierarchical list of forks and their review PRs
3. **Search** by repository name or PR title
4. **Bug Count**: See how many issues Macroscope found in each PR
   - Click the refresh icon on unchecked PRs to fetch the bug count
   - PRs with bugs show an orange warning icon
   - Use "Show only PRs with issues" filter to focus on PRs that need attention
5. **Bulk Delete**: Select repos or individual PRs and delete them
   - Selecting a repo selects all its PRs
   - Deleting a repo removes the entire fork from GitHub
   - Deleting individual PRs closes them and removes their branches

Data is cached locally in SQLite for quick access between sessions. On page load, forks are retrieved from the database without GitHub API calls. Click **Refresh** to sync with GitHub and update the cache.

### PR Analysis Tab

The **PR Analysis** tab uses Claude to analyze Macroscope findings and generate outreach emails:

1. Select a PR from your forks that has Macroscope review comments
2. Click **Analyze PR** to run Claude analysis on the findings
3. View the analysis results:
   - **Meaningful Bugs**: Bugs that represent real issues (not style/minor concerns)
   - **Severity Classification**: Critical, High, or Medium impact
   - **Most Impactful Bug**: The single most significant finding for outreach
4. Click **Generate Email** to create an outreach email
   - Includes Attio merge fields (`{{first_name}}`, `{{company}}`, etc.)
   - Pre-populated with the most impactful bug as the hook
   - Copy to clipboard for use in your email client

Analysis results are cached locally in SQLite, including the original PR title and URL. This means viewing a cached analysis requires no GitHub API calls - all data is retrieved instantly from the database.

## Setup Guide

### Prerequisites

- [Node.js](https://nodejs.org/) 18 or later
- [Git](https://git-scm.com/) installed and configured
- A GitHub account
- A GitHub Personal Access Token
- An Anthropic API Key (for PR Analysis feature)

### 1. Clone this Repository


### 2. Install Dependencies

```bash
npm install
```

### 3. Create a GitHub Personal Access Token

1. Go to [GitHub Settings > Developer settings > Personal access tokens > Tokens (classic)](https://github.com/settings/tokens)

2. Click **Generate new token (classic)**

3. Give it a descriptive name (e.g., "Macroscope PR Creator")

4. Select the following scope:
   - `repo` - Full control of private repositories (required for forking and creating PRs)

5. Click **Generate token**

6. Copy the token immediately (you won't see it again)

### 4. Get an Anthropic API Key (for PR Analysis)

1. Go to [Anthropic Console](https://console.anthropic.com/settings/keys)

2. Create an account or sign in

3. Click **Create Key**

4. Copy the API key (starts with `sk-ant-`)

### 5. Configure Environment Variables

Create a `.env.local` file in the project root:

```bash
cp .env.local.example .env.local
```

Edit `.env.local` and add your tokens:

```
GITHUB_TOKEN=ghp_your_token_here
ANTHROPIC_API_KEY=sk-ant-your_key_here
```

### 6. Run the Application

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## How It Works

### Latest Commit Mode

```
┌─────────────────────────────────────────────────────────────────┐
│                        User Input                               │
│  Repository: https://github.com/owner/repo                      │
│  Commit: (latest) or specific hash                              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  1. Check/Create Fork                                           │
│     - Check if github.com/YOUR_USERNAME/repo exists             │
│     - If not, fork from upstream                                │
│     - Wait for GitHub to complete the fork                      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  2. Get Commit Info                                             │
│     - Fetch target commit (latest or specified)                 │
│     - Get parent commit hash automatically                      │
│     - Detect if it's a merge commit from a PR                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  3. Git Operations (local)                                      │
│     - Clone your fork to temp directory                         │
│     - Fetch from upstream to get all commits                    │
│     - Create branch: review-{short-hash} from parent            │
│     - Cherry-pick the target commit(s)                          │
│     - Push branch to your fork                                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  4. Create Pull Request                                         │
│     - PR created in YOUR fork (not upstream)                    │
│     - Base: main, Head: review-{hash}                           │
│     - Title: Original commit message                            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Result: https://github.com/YOUR_USERNAME/repo/pull/1           │
└─────────────────────────────────────────────────────────────────┘
```

### Recreate PR Mode

```
┌─────────────────────────────────────────────────────────────────┐
│                        User Input                               │
│  PR URL: https://github.com/owner/repo/pull/123                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  1. Fetch PR Details                                            │
│     - Get PR title, author, and status                          │
│     - Get all commits from the PR                               │
│     - Determine correct base commit:                            │
│       • Merged PR: Use parent of merge commit                   │
│       • Open PR: Use original base commit                       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  2. Check/Create Fork                                           │
│     - Check if github.com/YOUR_USERNAME/repo exists             │
│     - If not, fork from upstream                                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  3. Git Operations (local)                                      │
│     - Clone your fork to temp directory                         │
│     - Fetch commits from upstream                               │
│     - Create branch: review-pr-{number} from base commit        │
│     - Cherry-pick ALL PR commits in order                       │
│     - Push branch to your fork                                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  4. Create Pull Request                                         │
│     - PR created in YOUR fork                                   │
│     - Title: [Review] Original PR title                         │
│     - Body: Links to original PR, author, commit list           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Result: https://github.com/YOUR_USERNAME/repo/pull/2           │
└─────────────────────────────────────────────────────────────────┘
```

### Smart Base Commit Detection

For merged PRs, the tool uses intelligent base commit detection:

- **Problem**: Using the PR's original base commit can cause conflicts if other commits were merged to main between PR creation and merge.
- **Solution**: For merged PRs, the tool uses the parent of the merge commit (the state of main right before the PR was merged), ensuring all commits apply cleanly.

### Technical Details

- **Framework**: Next.js 16 with App Router
- **UI**: React 19, Tailwind CSS v4
- **Git Operations**: [simple-git](https://github.com/steveukx/git-js) npm package
- **GitHub API**: [@octokit/rest](https://github.com/octokit/rest.js)
- **AI Analysis**: [Anthropic SDK](https://github.com/anthropics/anthropic-sdk-typescript) with Claude
- **Database**: SQLite via [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) for local caching

The API routes handle all operations server-side:
- `/api/create-pr` - PR creation with SSE streaming for real-time status updates
- `/api/forks` - Fork management and synchronization
- `/api/forks/check-bugs` - Count Macroscope review comments
- `/api/analyze-pr` - Claude-powered bug analysis
- `/api/generate-email` - Outreach email generation

Repositories are cloned to a temporary directory and cleaned up after the PR is created.

**Note**: GitHub Actions are automatically disabled on forked repositories to prevent workflows from running on your forks.

## Troubleshooting

### "GitHub token not configured"

Make sure you have created `.env.local` with your `GITHUB_TOKEN`. Restart the dev server after adding it.

### "Fork already exists" but PR fails

Your fork may be out of sync with upstream. The tool fetches from upstream to get the latest commits, but if there are significant issues with your fork, you may need to manually sync or delete and recreate it on GitHub.

### "Cherry-pick failed" / Merge conflicts

This happens when the commit cannot be cleanly applied to its base. Common causes:
- The commit depends on changes from other commits not included
- There are actual merge conflicts that require manual resolution
- The commit references files that don't exist at the base commit

The tool attempts to fetch commits directly from upstream if they're not available locally, but some edge cases may still fail.

### "Could not find main or master branch"

The repository uses a different default branch name. Currently, the tool only checks for `main` and `master`. If the repo uses a different branch (e.g., `develop`), this will fail.

### PR is created but empty

This can happen if:
- The commit was already on the base branch
- The cherry-pick resulted in no changes

### Token permission errors

Make sure your GitHub token has the `repo` scope. Tokens with only `public_repo` scope cannot fork private repositories or push to forks.

### Rate limiting

GitHub API has rate limits. If you're creating many PRs in quick succession, you may hit the limit. Wait a few minutes and try again.

### Large repositories take too long

Cloning large repositories can be slow. The tool fetches from upstream to ensure all commits are available. For very large repos, the first run may take longer.

### "PR not found" error

Make sure the PR URL is correct and the PR exists. Private repositories require your token to have access to that repository.

### "Anthropic API key not configured"

Make sure you have added `ANTHROPIC_API_KEY` to your `.env.local` file. Restart the dev server after adding it. The PR Analysis feature requires this key.

### "No meaningful bugs found" in analysis

The Claude analysis filters out style suggestions, minor issues, and non-bugs. If the PR only has these types of comments, the analysis may return no meaningful bugs. This is expected behavior.

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
