# Code Review Studio

**Powered by [Macroscope](https://macroscope.dev)**

A web application for AI-powered code review analysis. This tool helps you get Macroscope code reviews on any GitHub pull request and analyze the findings with AI to identify meaningful bugs.

**Live App:** [app.codereview.studio](https://app.codereview.studio)

---

## User Guide

### Getting Started

1. **Sign in** with your GitHub account (must be a member of the macroscope-gtm organization)
2. Choose your workflow based on what you want to do:
   - **Discover PRs**: Find and simulate multiple high-value PRs from any repository
   - **Simulate PR**: Simulate a specific PR from any public repository
   - **Import PR**: Analyze a PR where Macroscope is already installed

### Importing PRs for Review

#### Discover PRs (Recommended for Prospecting)

Use this when you want to find high-value PRs to review from any GitHub repository. This is the recommended workflow for prospecting new accounts.

1. Click **Simulate PR** in the top-right corner (opens with Discover tab by default)
2. Enter a repository name (e.g., `supabase/supabase` or paste the full GitHub URL)
3. Click **Search** to analyze recent PRs
4. Review the scored candidates:
   - **Score**: Overall priority score based on complexity and recency
   - Hover over the score to see the breakdown (complexity + recency)
5. Select PRs to simulate (up to 10 at a time):
   - Click individual checkboxes, or
   - Use **Select All** to select the top candidates
6. Click **Simulate Selected** to begin bulk simulation
7. Watch the verbose status log as each PR is processed
8. Once complete, click **View PRs in Dashboard** to see your new reviews

**Filters available:**
- **Include Open PRs**: Include PRs that are still open
- **Include Merged PRs**: Include PRs that have been merged
- **Merged within days**: Only show PRs merged within the specified timeframe
- **Min lines changed**: Filter out small PRs below this threshold

**What happens behind the scenes:** The tool analyzes up to 50 recent PRs, scores them based on complexity (lines changed, files modified) and recency, then lets you batch-simulate the most promising candidates. Repositories are automatically cached during simulation for faster future operations.

#### Simulate PR (Single PR)

Use this when you have a specific PR URL you want to simulate.

1. Click **Simulate PR** and select the **Simulate PR** tab
2. Paste the GitHub PR URL (e.g., `https://github.com/owner/repo/pull/123`)
3. Click **Create Pull Request**
4. Wait for the simulation to complete (you'll see real-time progress)
5. Once done, Macroscope will automatically review the PR in your fork

**What happens behind the scenes:** The tool forks the repository to your GitHub account and recreates the PR commits, allowing Macroscope to review it.

#### Internal Repositories

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
- **Refresh**: Sync with GitHub

### Analyzing Bugs

After Macroscope reviews a PR, click the **Run** action (or **View** for PRs that have already be analyzed) to:

1. **View Meaningful Bugs**: AI filters out style suggestions and minor issues
2. **See Severity Levels**: Bugs are classified by category (Critical, High, Medium, Low, Suggestion, Style, Nitpick)
3. **Find Most Impactful**: The single best bug for outreach is highlighted with a star
4. **Generate Emails**: Create outreach emails with Attio merge fields

Behind the scenes we are using Claude Opus 4.5 to analyze the bugs found during Macroscope's review. The prompts and models used for analysis can be updated in Settings > Prompts.

#### Analysis Output (V2 Format)

The AI analysis returns structured data including:
- **Bug Counts**: Total comments processed, meaningful bugs found, outreach-ready bugs
- **Per-Comment Analysis**: Each comment is categorized with severity, explanation, impact scenario, and suggested fix
- **Summary**: Bugs grouped by severity with an overall recommendation

### Managing Prompts

The Settings page allows you to customize the AI prompts used for analysis:

1. Go to **Settings** > **Prompts** tab
2. Select a prompt to edit (e.g., "pr-analysis" or "email-generation")
3. Modify the prompt content, model, or purpose
4. Click **Validate Schema** to check compatibility before saving
5. Click **Save Changes**

#### Schema Validation

The tool validates prompt changes against expected output schemas to prevent breaking changes:

- **Validate Schema button**: Check if your prompt changes are compatible before saving
- **Required Output Schema section**: View what fields the code expects from each prompt
- **Warning Modal**: If validation detects missing fields or type changes, you'll see a warning with options to fix or force-save

This prevents accidentally removing required JSON fields that the application depends on.

### Tips & Best Practices

- **Wait for Macroscope**: After simulating a PR, wait a few minutes for Macroscope to complete its review before analyzing. You can check the PR in Github for the Macroscope review status
- **Check Bug Count**: If bug count shows "-", Macroscope hasn't reviewed yet or found no issues
- **Use Filters**: Filter by "My PRs" to focus on your assigned reviews

### Caching Repositories

For faster PR simulations, you can cache repositories on the server. This is useful for:

- **Large repositories** that take a long time to clone (e.g., supabase, kubernetes)
- **Strategic accounts** where you expect to simulate multiple PRs over time

**Automatic Caching with Discover PRs:**

When you use the **Discover PRs** feature to simulate multiple PRs, repositories are automatically cached during the simulation process. This means:
- The first PR takes longer (full clone)
- Subsequent PRs from the same repo are much faster
- No manual cache setup needed for bulk simulations

**Manual Caching:**

You can also manually add repositories to the cache list:

1. Go to **Settings** (click your avatar > Settings, or use the sidebar)
2. Scroll to the **Repository Cache** section
3. Enter the repository in `owner/repo` format (e.g., `supabase/supabase`)
4. Optionally add notes (e.g., "Strategic account - Series B")
5. Click **Add**

**What caching does:**
- The first PR simulation will clone and cache the repository
- Subsequent simulations from the same repo will be much faster
- You can see total cache size and manage cached repos in Settings

**When NOT to cache:**
- One-off PR reviews from repos you won't revisit
- Small repositories that clone quickly anyway

**Managing cache:**
- View cache size and cached repos in Settings > Repository Cache
- Remove individual repos from the cache list
- Use "Clear All Cache" to free up disk space if needed

---

## Technical Documentation

For detailed technical documentation on architecture, implementation details, API reference, and development setup, see **[Technical Documentation](docs/TECHNICAL_DOCUMENTATION.md)**.

---

## Running Locally

If you need to run the application locally for development or testing:

### Prerequisites

- Node.js 20 or later
- Git installed and configured
- GitHub account with Personal Access Token
- Anthropic API Key

### Quick Start

```bash
# Clone and install
git clone https://github.com/govambam/macroscope-code-review.git
cd macroscope-code-review
npm install

# Configure environment
cp .env.local.example .env.local
# Edit .env.local with your credentials (see Technical Documentation for details)

# Run development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

For detailed setup instructions including how to create GitHub tokens and OAuth apps, see the [Technical Documentation](docs/TECHNICAL_DOCUMENTATION.md#local-development-setup).
