# Macroscope PR Creator

A Next.js web application that automatically forks GitHub repositories and recreates commits as pull requests for [Macroscope](https://macroscope.dev) code reviews.

## Overview

When you want Macroscope to review a specific commit from any public GitHub repository, this tool automates the entire workflow:

1. Forks the repository to your GitHub account (if not already forked)
2. Creates a new branch from the commit's parent
3. Cherry-picks the target commit onto that branch
4. Creates a pull request within your fork

This gives Macroscope a clean PR to analyze, containing exactly the changes from that single commit.

### Why This Exists

Macroscope reviews pull requests, but sometimes you want to review commits that were pushed directly to main or merged without a PR. This tool bridges that gap by recreating any commit as a reviewable PR in your own fork.

## How to Use

1. Open the web interface at `http://localhost:3000`

2. Enter the **original repository URL** (not your fork):
   ```
   https://github.com/getsentry/sentry-python
   ```

3. Choose your commit:
   - **Default**: Leave "Specify commit" unchecked to review the latest commit on main
   - **Specific commit**: Check the box and enter a commit hash to review a particular commit

4. Click **Create Pull Request**

5. Wait for the process to complete (typically 10-30 seconds)

6. Click the PR link or copy it to your clipboard

## Setup Guide

### Prerequisites

- [Node.js](https://nodejs.org/) 18 or later
- [Git](https://git-scm.com/) installed and configured
- A GitHub account
- A GitHub Personal Access Token

### 1. Clone the Repository

```bash
git clone <repository-url>
cd macroscope-code-review
```

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
│     - Get original commit message                               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  3. Git Operations (local)                                      │
│     - Clone your fork to temp directory                         │
│     - Create branch: review-{short-hash} from parent            │
│     - Cherry-pick the target commit                             │
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

### Technical Details

- **Framework**: Next.js 14+ with App Router
- **Git Operations**: [simple-git](https://github.com/steveukx/git-js) npm package
- **GitHub API**: [@octokit/rest](https://github.com/octokit/rest.js)
- **Styling**: Tailwind CSS

The API route (`/api/create-pr`) handles all operations server-side. Repositories are cloned to a temporary directory and cleaned up after the PR is created.

## Troubleshooting

### "GitHub token not configured"

Make sure you have created `.env.local` with your `GITHUB_TOKEN`. Restart the dev server after adding it.

### "Fork already exists" but PR fails

Your fork may be out of sync with upstream. The tool adds upstream as a remote and fetches from both, but if there are significant divergences, you may need to manually sync your fork on GitHub.

### "Cherry-pick failed" / Merge conflicts

This happens when the commit cannot be cleanly applied to its parent. Common causes:
- The commit depends on changes from other commits
- The commit is a complex merge commit

For merge commits, the tool automatically uses `cherry-pick -m 1` to pick the first parent's changes.

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

Cloning large repositories can be slow. The tool uses `--no-single-branch` to ensure all branches are available, which adds to clone time. For very large repos, the first run may take longer.

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
