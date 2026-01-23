# Macroscope Code Review Tool

A web application for reviewing code with [Macroscope](https://macroscope.dev). This tool helps you get Macroscope code reviews on any GitHub pull request and analyze the findings with AI to identify meaningful bugs.

---

## User Guide

This section is for Macroscope team members who want to use the tool.

### Getting Started

1. **Sign in** with your GitHub account (must be a member of the macroscope-gtm organization)
2. Choose your workflow based on where the PR is:
   - **External PR**: Use "Import PR" to simulate a PR from any public repository
   - **Internal PR**: Use "Import PR" to analyze a PR where Macroscope is already installed

### Importing a PR for Review

#### External Repositories (PR Simulation)

Use this when you want Macroscope to review a PR from a repository where Macroscope isn't installed.

1. Click **Import PR** in the top-right corner
2. Select the **Recreate PR** tab
3. Paste the GitHub PR URL (e.g., `https://github.com/owner/repo/pull/123`)
4. Click **Create Pull Request**
5. Wait for the simulation to complete (you'll see real-time progress)
6. Once done, Macroscope will automatically review the PR in your fork

**What happens behind the scenes:** The tool forks the repository to your GitHub account and recreates the PR commits, allowing Macroscope to review it.

#### Internal Repositories (Direct Analysis)

Use this when Macroscope has already reviewed a PR in one of your repositories.

1. Click **Import PR**
2. Paste the PR URL and ensure **"This is an internal PR"** is checked
3. Click **Analyze**
4. View the AI analysis of Macroscope's findings instantly

### The PR Reviews Dashboard

The main dashboard shows all your review activity:

| Column | Description |
|--------|-------------|
| **PR** | Pull request title with link to view on GitHub |
| **Bugs** | Number of issues Macroscope found (click to run analysis) |
| **Created** | When the PR was imported |
| **Updated** | Last time the PR was analyzed |
| **Owner** | Team member responsible for this PR (click to reassign) |

**Features:**
- **Search**: Filter PRs by name or repository
- **Filters**: Filter by owner (My PRs / All PRs) or type (Internal / Simulated)
- **Sort**: Sort repositories by name, date, or PR count
- **Bulk Actions**: Select multiple PRs or repos to delete
- **Refresh**: Sync with GitHub to get latest bug counts

### Analyzing Bugs

After Macroscope reviews a PR, click the **Bugs** count (or the analyze button) to:

1. **View Meaningful Bugs**: AI filters out style suggestions and minor issues
2. **See Severity Levels**: Bugs are classified as Critical, High, or Medium
3. **Find Most Impactful**: The single best bug for outreach is highlighted
4. **Generate Emails**: Create outreach emails with Attio merge fields

### Managing PR Ownership

Click any owner avatar to reassign a PR to a different team member. This helps track who is responsible for following up on each PR analysis.

### Tips & Best Practices

- **Wait for Macroscope**: After simulating a PR, wait a few minutes for Macroscope to complete its review before analyzing
- **Check Bug Count**: If bug count shows "-", Macroscope hasn't reviewed yet or found no issues
- **Use Filters**: Filter by "My PRs" to focus on your assigned reviews
- **Refresh Regularly**: Click Refresh to sync the latest bug counts from GitHub

---

## Technical Documentation

This section is for developers who want to set up, modify, or understand how the tool works.

### Tech Stack

- **Framework**: Next.js 16 with App Router
- **UI**: React 19, Tailwind CSS v4
- **Authentication**: NextAuth.js with GitHub OAuth
- **Database**: SQLite via better-sqlite3
- **Git Operations**: simple-git
- **GitHub API**: @octokit/rest
- **AI Analysis**: Anthropic SDK (Claude)

### Prerequisites

- Node.js 20 or later
- Git installed and configured
- GitHub account with Personal Access Token
- Anthropic API Key

### Local Development Setup

#### 1. Clone and Install

```bash
git clone https://github.com/govambam/macroscope-code-review.git
cd macroscope-code-review
npm install
```

#### 2. Create GitHub Personal Access Token

1. Go to [GitHub Settings > Developer settings > Personal access tokens > Tokens (classic)](https://github.com/settings/tokens)
2. Click **Generate new token (classic)**
3. Select the `repo` scope (full control of private repositories)
4. Copy the token

#### 3. Create GitHub OAuth App

1. Go to [GitHub Settings > Developer settings > OAuth Apps](https://github.com/settings/developers)
2. Click **New OAuth App**
3. Set Authorization callback URL to `http://localhost:3000/api/auth/callback/github`
4. Copy the Client ID and Client Secret

#### 4. Get Anthropic API Key

1. Go to [Anthropic Console](https://console.anthropic.com/settings/keys)
2. Create an account or sign in
3. Click **Create Key** and copy the API key

#### 5. Configure Environment Variables

```bash
cp .env.local.example .env.local
```

Edit `.env.local`:

```env
# GitHub API Token (for API operations)
GITHUB_TOKEN=ghp_your_token_here

# GitHub OAuth (for authentication)
GITHUB_CLIENT_ID=your_client_id
GITHUB_CLIENT_SECRET=your_client_secret

# Anthropic API Key
ANTHROPIC_API_KEY=sk-ant-your_key_here

# NextAuth Secret (generate with: openssl rand -base64 32)
NEXTAUTH_SECRET=your_random_secret
NEXTAUTH_URL=http://localhost:3000
```

#### 6. Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

### API Routes

| Route | Method | Description |
|-------|--------|-------------|
| `/api/create-pr` | POST | PR simulation with SSE streaming |
| `/api/analyze-pr` | POST | Analyze simulated PR findings |
| `/api/analyze-internal-pr` | POST | Analyze internal PR findings |
| `/api/forks` | GET | List all forks and PRs |
| `/api/forks` | DELETE | Delete forks or PRs |
| `/api/forks/check-bugs` | POST | Count Macroscope comments on a PR |
| `/api/users` | GET | List organization members |
| `/api/prs/owner` | PATCH | Update PR owner |
| `/api/generate-email` | POST | Generate outreach email |
| `/api/prompts` | GET/POST | Manage analysis prompts |

### Database Schema

The SQLite database stores:
- **forks**: Repository forks created by the tool
- **prs**: Pull requests tracked in each fork
- **pr_analyses**: Cached AI analysis results
- **generated_emails**: Generated outreach emails
- **prompts**: Customizable analysis prompts

### How PR Simulation Works

The PR simulation recreates external PRs using a two-branch strategy to avoid merge conflicts:

```
Your Fork
│
├── main ─────────────────────────────► (synced with upstream)
│
├── base-for-pr-123 ──────────────────► (frozen at PR's base commit)
│         │
│         └── review-pr-123 ──────────► (cherry-picked PR commits)
│
└── PR: review-pr-123 → base-for-pr-123 (clean diff)
```

**Process:**
1. Parse PR URL and fetch all commits
2. Find the true base commit (parent of first PR commit)
3. Fork the repository if needed
4. Create `base-for-pr-{N}` branch at the base commit
5. Create `review-pr-{N}` branch and cherry-pick all commits
6. Create PR from review branch to base branch

This ensures a clean diff regardless of what's been merged since.

### Deployment

The app is deployed on Railway. Key configuration:

```toml
# railway.toml
[build]
builder = "nixpacks"

[deploy]
healthcheckPath = "/api/health"
healthcheckTimeout = 300
restartPolicyType = "ON_FAILURE"
```

Environment variables needed in production:
- All `.env.local` variables
- `NEXTAUTH_URL` set to production URL

### Troubleshooting

#### "GitHub token not configured"
Ensure `GITHUB_TOKEN` is set in `.env.local` and restart the dev server.

#### "Cherry-pick failed" / Merge conflicts
The commit cannot be cleanly applied. Try:
- Deleting existing branches in your fork
- Re-running the simulation

#### "No Macroscope review found"
For internal PR analysis:
- Ensure Macroscope GitHub app is installed on the repository
- Wait for Macroscope to complete its review

#### Rate limiting
GitHub API has rate limits. Wait a few minutes if you're creating many PRs quickly.

### Development Commands

```bash
npm run dev      # Start development server
npm run build    # Build for production
npm start        # Start production server
npm run lint     # Run linter
```

---

## License

MIT
