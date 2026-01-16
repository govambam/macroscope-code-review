# Macroscope PR Creator

A Next.js web application that automatically forks GitHub repositories and recreates commits or pull requests for [Macroscope](https://macroscope.dev) code reviews.

## Overview

When you want Macroscope to review code from any public GitHub repository, this tool automates the entire workflow. It supports two modes:

**Latest Commit Mode**: Review the latest commit (or a specific commit) from any repository
- Forks the repository to your GitHub account
- Creates a new branch from the commit's parent
- Cherry-picks the target commit onto that branch
- Creates a pull request within your fork

**Recreate PR Mode**: Recreate any existing GitHub PR for review
- Paste any GitHub PR URL directly
- Automatically fetches all commits from the original PR
- Recreates the PR in your fork with all original commits preserved

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

## Setup Guide

### Prerequisites

- [Node.js](https://nodejs.org/) 18 or later
- [Git](https://git-scm.com/) installed and configured
- A GitHub account
- A GitHub Personal Access Token

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

### 4. Configure Environment Variables

Create a `.env.local` file in the project root:

```bash
cp .env.local.example .env.local
```

Edit `.env.local` and add your token:

```
GITHUB_TOKEN=ghp_your_token_here
```

### 5. Run the Application

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

- **Framework**: Next.js 14+ with App Router
- **Git Operations**: [simple-git](https://github.com/steveukx/git-js) npm package
- **GitHub API**: [@octokit/rest](https://github.com/octokit/rest.js)
- **Styling**: Tailwind CSS v4

The API route (`/api/create-pr`) handles all operations server-side. Repositories are cloned to a temporary directory and cleaned up after the PR is created.

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
