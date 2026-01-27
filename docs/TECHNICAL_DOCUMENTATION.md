# Technical Documentation: Discover Mode, PR Simulation, Repository Caching & AI Analysis

This document provides in-depth technical documentation for four core features of Code Review Studio: **Discover Mode**, **PR Simulation**, **Repository Caching**, and **AI Analysis with Schema Validation**. It's intended for engineers who want to understand the architecture, implementation details, and design decisions.

---

## Table of Contents

1. [Discover Mode](#discover-mode)
   - [Overview](#discover-overview)
   - [Why Discover Mode?](#why-discover-mode)
   - [PR Scoring Algorithm](#pr-scoring-algorithm)
   - [Bulk Simulation Flow](#bulk-simulation-flow)
   - [Q&A: Discover Mode](#qa-discover-mode)

2. [PR Simulation](#pr-simulation)
   - [Overview](#overview)
   - [Why Simulate PRs?](#why-simulate-prs)
   - [The Fork Strategy](#the-fork-strategy)
   - [Simulation Strategies](#simulation-strategies)
   - [Step-by-Step Flow](#step-by-step-flow)
   - [Branch Architecture](#branch-architecture)
   - [Q&A: PR Simulation](#qa-pr-simulation)

3. [Repository Caching](#repository-caching)
   - [Overview](#caching-overview)
   - [Why Caching?](#why-caching)
   - [Git Reference Clones](#git-reference-clones)
   - [Selective Caching](#selective-caching)
   - [Auto-Caching in Bulk Simulations](#auto-caching-in-bulk-simulations)
   - [Concurrency Control](#concurrency-control)
   - [Cache Architecture](#cache-architecture)
   - [Q&A: Caching](#qa-caching)

4. [AI Analysis & Schema Validation](#ai-analysis--schema-validation)
   - [Overview](#analysis-overview)
   - [Analysis Pipeline](#analysis-pipeline)
   - [Schema Versions (V1 vs V2)](#schema-versions-v1-vs-v2)
   - [Dynamic Token Limits](#dynamic-token-limits)
   - [Schema Registry with Zod](#schema-registry-with-zod)
   - [Schema Validation Flow](#schema-validation-flow)
   - [Q&A: AI Analysis](#qa-ai-analysis)

---

## Discover Mode

### Discover Overview

Discover Mode enables users to find high-value pull requests from any GitHub repository without knowing specific PR URLs. It analyzes recent PRs, scores them based on complexity and recency, and allows batch simulation of multiple PRs at once.

### Why Discover Mode?

**The Problem:** Finding good PRs to demonstrate Macroscope's value is time-consuming:
1. Manually browsing GitHub repositories for interesting PRs
2. Evaluating each PR's complexity and relevance
3. Simulating PRs one at a time

**The Solution:** Automated PR discovery and batch processing:
1. Enter any repository name
2. Get a scored list of high-value PR candidates
3. Select and simulate multiple PRs in one operation

```
┌─────────────────────────────────────────────────────────────────────────┐
│                       DISCOVER MODE FLOW                                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  INPUT                        ANALYSIS                    OUTPUT         │
│  ─────                        ────────                    ──────         │
│                                                                          │
│  ┌─────────────┐              ┌─────────────┐            ┌────────────┐ │
│  │ Repository  │              │ Fetch up to │            │ Scored     │ │
│  │ URL/Name    │ ──────────►  │ 50 recent   │ ────────►  │ candidates │ │
│  │             │              │ PRs         │            │ (top 10)   │ │
│  └─────────────┘              └─────────────┘            └────────────┘ │
│                                      │                          │        │
│                                      ▼                          ▼        │
│                               ┌─────────────┐            ┌────────────┐ │
│                               │ Score each  │            │ User       │ │
│                               │ PR by:      │            │ selects    │ │
│                               │ • Complexity│            │ PRs to     │ │
│                               │ • Recency   │            │ simulate   │ │
│                               └─────────────┘            └────────────┘ │
│                                                                 │        │
│                                                                 ▼        │
│                                                          ┌────────────┐ │
│                                                          │ Batch      │ │
│                                                          │ simulation │ │
│                                                          │ with SSE   │ │
│                                                          │ status     │ │
│                                                          └────────────┘ │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### PR Scoring Algorithm

Each PR is scored on two dimensions: **complexity** (50%) and **recency** (50%).

```
┌─────────────────────────────────────────────────────────────────────────┐
│                       PR SCORING ALGORITHM                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  COMPLEXITY SCORE (0-100)                                               │
│  ────────────────────────                                               │
│                                                                          │
│  Based on lines changed:                                                │
│  • < 50 lines:     Very low (0-20)                                      │
│  • 50-200 lines:   Low (20-40)                                          │
│  • 200-500 lines:  Medium (40-60)                                       │
│  • 500-1000 lines: High (60-80)                                         │
│  • > 1000 lines:   Very high (80-100)                                   │
│                                                                          │
│  Formula: min(100, (total_lines_changed / 10))                          │
│                                                                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  RECENCY SCORE (0-100)                                                  │
│  ─────────────────────                                                  │
│                                                                          │
│  Based on PR age (merged PRs use merge date, open PRs use created date):│
│  • < 1 day old:    100                                                  │
│  • 7 days old:     ~75                                                  │
│  • 14 days old:    ~50                                                  │
│  • 30 days old:    ~25                                                  │
│  • > 60 days old:  0                                                    │
│                                                                          │
│  Formula: max(0, 100 - (days_old * 100 / 60))                           │
│                                                                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  OVERALL SCORE                                                          │
│  ─────────────                                                          │
│                                                                          │
│  overall_score = (complexity_score + recency_score) / 2                 │
│                                                                          │
│  Why weight equally?                                                     │
│  • Complexity matters: More code = more potential bugs                  │
│  • Recency matters: Recent PRs = active development = better outreach   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

**Filtering options:**

```typescript
interface DiscoverFilters {
  include_open?: boolean;      // Include open PRs (default: true)
  include_merged?: boolean;    // Include merged PRs (default: true)
  merged_within_days?: number; // Only merged PRs within N days (default: 30)
  min_lines_changed?: number;  // Minimum lines changed (default: 50)
  max_results?: number;        // Maximum candidates to return (default: 10)
}
```

### Bulk Simulation Flow

When users select multiple PRs for simulation, we process them sequentially with real-time status updates via Server-Sent Events (SSE):

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    BULK SIMULATION ARCHITECTURE                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  CLIENT                              SERVER                              │
│  ──────                              ──────                              │
│                                                                          │
│  ┌────────────┐                                                         │
│  │ User       │                                                         │
│  │ selects    │                                                         │
│  │ 5 PRs      │                                                         │
│  └─────┬──────┘                                                         │
│        │                                                                 │
│        ▼                                                                 │
│  ┌────────────┐      POST /api/create-pr       ┌────────────┐          │
│  │ For each   │─────────────────────────────► │ Simulate   │          │
│  │ PR URL:    │      (with cacheRepo: true)    │ PR #1      │          │
│  │            │ ◄───────────────────────────── │            │          │
│  │ • Start    │      SSE: status updates       └────────────┘          │
│  │ • Listen   │                                      │                  │
│  │ • Display  │                                      ▼                  │
│  │            │                                ┌────────────┐          │
│  │            │ ◄───────────────────────────── │ Simulate   │          │
│  │            │      SSE: status updates       │ PR #2      │          │
│  │            │                                └────────────┘          │
│  │            │                                      │                  │
│  │   ...      │                                     ...                 │
│  │            │                                      │                  │
│  │            │                                      ▼                  │
│  │            │                                ┌────────────┐          │
│  │            │ ◄───────────────────────────── │ Simulate   │          │
│  │            │      SSE: result event         │ PR #5      │          │
│  └────────────┘                                └────────────┘          │
│        │                                                                 │
│        ▼                                                                 │
│  ┌────────────┐                                                         │
│  │ Show       │                                                         │
│  │ completion │                                                         │
│  │ summary    │                                                         │
│  └────────────┘                                                         │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

**Key implementation details:**

1. **Sequential Processing**: PRs are simulated one at a time to avoid overwhelming the server and to provide clear status feedback.

2. **Auto-Caching**: Each simulation request includes `cacheRepo: true`, ensuring the repository is cached after the first PR simulation.

3. **SSE Event Parsing**: The client properly parses SSE events with `data:` prefix and double-newline separation:

```typescript
// Process complete SSE events
const events = buffer.split("\n\n");
buffer = events.pop() || "";

for (const event of events) {
  const dataMatch = event.match(/^data: (.+)$/m);
  if (!dataMatch) continue;

  const data = JSON.parse(dataMatch[1]);
  if (data.eventType === "status") {
    // Display status message
  } else if (data.eventType === "result") {
    // Handle completion
  }
}
```

4. **Error Handling**: Non-SSE responses (e.g., 500 errors) are detected and handled gracefully:

```typescript
if (!response.ok) {
  const errorText = await response.text();
  // Try to parse JSON error, fallback to status code
}
```

5. **Selection Limits**: Maximum 10 PRs can be selected at once to prevent excessive load.

### Q&A: Discover Mode

**Q: Why limit to 50 PRs analyzed?**

A: Fetching detailed PR information (additions, deletions, files) requires individual API calls. Analyzing 50 PRs strikes a balance between coverage and API rate limits. Most repositories have their best candidates in the most recent PRs anyway.

**Q: Why score by complexity AND recency?**

A:
- **Complexity alone** would favor massive refactoring PRs that are often less interesting for bug discovery
- **Recency alone** would include trivial one-line fixes
- **Combined** gives us recent, substantial PRs that are most likely to have interesting bugs

**Q: Why sequential simulation instead of parallel?**

A: Several reasons:
1. **Resource management**: Git clone operations are resource-intensive
2. **Clear status feedback**: Users can see exactly which PR is being processed
3. **Error isolation**: If one PR fails, others still succeed
4. **Caching benefits**: First PR caches the repo, making subsequent PRs faster

**Q: What happens if simulation fails for one PR?**

A: The bulk simulation continues with remaining PRs. Failures are logged in the status display and summarized at completion. Users can retry failed PRs individually.

---

## PR Simulation

### Overview

PR Simulation recreates pull requests from any public GitHub repository into our organization's fork. This allows Macroscope to analyze the PR's code changes without requiring access to the original repository's CI/CD or review infrastructure.

### Why Simulate PRs?

**The Problem:** Macroscope needs to review code changes from external repositories, but:
1. We can't run our analysis bot on repositories we don't control
2. We can't add webhooks or GitHub Apps to external repos
3. We need a controlled environment where our bot has write access

**The Solution:** We create an isolated "simulation" of the PR:
1. Fork the repository to our organization (`macroscope-gtm`)
2. Recreate the exact commits from the original PR
3. Open a new PR in our fork that mirrors the original
4. Run Macroscope analysis on this simulated PR

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         PR SIMULATION FLOW                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   UPSTREAM REPO                          OUR FORK                        │
│   (supabase/supabase)                    (macroscope-gtm/supabase)       │
│                                                                          │
│   ┌─────────────┐                        ┌─────────────┐                │
│   │ Original PR │                        │ Simulated   │                │
│   │   #12345    │ ──── recreate ────►    │    PR #1    │                │
│   │             │                        │             │                │
│   │ commits:    │                        │ commits:    │                │
│   │  • abc123   │                        │  • abc123   │ (cherry-picked)│
│   │  • def456   │                        │  • def456   │ (cherry-picked)│
│   └─────────────┘                        └─────────────┘                │
│                                                 │                        │
│                                                 ▼                        │
│                                          ┌─────────────┐                │
│                                          │ Macroscope  │                │
│                                          │  Analysis   │                │
│                                          └─────────────┘                │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### The Fork Strategy

We fork repositories to the `macroscope-gtm` GitHub organization rather than a personal account. Here's why:

1. **Centralized Management**: All forks live in one organization
2. **Bot Access**: Our bot (`macroscope-gtm-bot`) has write access to all repos in the org
3. **GitHub Actions**: We disable Actions on forks to prevent unintended CI runs

```typescript
// Fork to organization instead of personal account
await octokit.repos.createFork({
  owner: upstreamOwner,
  repo: repoName,
  organization: "macroscope-gtm",  // Key: fork to org, not personal
});
```

**Why disable GitHub Actions?**

```typescript
await octokit.actions.setGithubActionsPermissionsRepository({
  owner: forkOwner,
  repo: repoName,
  enabled: false,  // Prevents CI from running on our simulated PRs
});
```

Forked repos inherit the original's workflow files. Without disabling Actions:
- Our simulated PRs could trigger expensive CI runs
- We'd consume the upstream project's Action minutes (on public forks)
- Failed CI could confuse our review process

### Step-by-Step Flow

Here's what happens when you click "Simulate PR" for a GitHub PR URL:

```
┌──────────────────────────────────────────────────────────────────────────┐
│                    10-STEP PR SIMULATION PROCESS                          │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  Step 1: Validate Configuration                                          │
│          └─► Check GITHUB_BOT_TOKEN is set                               │
│                                                                           │
│  Step 2: Parse & Fetch PR                                                │
│          └─► GET /repos/{owner}/{repo}/pulls/{pr_number}                 │
│          └─► Extract: title, author, state, merge status, merge_commit   │
│                                                                           │
│  Step 3: Select Simulation Strategy                                      │
│          └─► If MERGED: Try merge commit parents strategy                │
│          └─► If OPEN (or merged failed): Try PR head fetch strategy      │
│          └─► If both fail: Fall back to cherry-pick strategy             │
│                                                                           │
│  Step 4: Fetch Required Data                                             │
│          └─► For merge-commit: Fetch merge commit to get parents         │
│          └─► For pr-head-fetch: Fetch PR ref and base branch ref         │
│          └─► For cherry-pick: Fetch all PR commits, find true base       │
│                                                                           │
│  Step 5: Check/Create Fork                                               │
│          └─► Check if macroscope-gtm/{repo} exists                       │
│          └─► If not, create fork via API                                 │
│          └─► Wait 3 seconds for GitHub to process                        │
│                                                                           │
│  Step 6: Configure Fork                                                  │
│          └─► Disable GitHub Actions                                      │
│                                                                           │
│  Step 7: Clone Repository                                                │
│          └─► If cached: fast clone using --reference                     │
│          └─► If not cached: full clone to temp directory                 │
│          └─► Add upstream remote for fetching original commits           │
│                                                                           │
│  Step 8: Create Branches (varies by strategy)                            │
│          └─► Direct strategies: Create branches at base/head commits     │
│          └─► Cherry-pick: Create branches, then cherry-pick commits      │
│                                                                           │
│  Step 9: Push Branches                                                   │
│          └─► Force push base-for-pr-{N} branch                           │
│          └─► Force push review-pr-{N} branch                             │
│                                                                           │
│  Step 10: Create PR & Save                                               │
│           └─► Create PR: review-pr-{N} → base-for-pr-{N}                 │
│           └─► Include strategy info in PR description                    │
│           └─► Save to database for tracking                              │
│                                                                           │
└──────────────────────────────────────────────────────────────────────────┘
```

### Branch Architecture

This is one of the most important architectural decisions. We create **two branches**, not one:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        BRANCH ARCHITECTURE                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  WRONG APPROACH (causes conflicts):                                      │
│  ─────────────────────────────────                                       │
│                                                                          │
│  main ──●──●──●──●──●──●──●──●──●──●  (contains merged PR)              │
│                    ╲                                                     │
│                     ╲──●──●──●  review-pr-123 (our cherry-picked commits)│
│                                                                          │
│  Problem: If the original PR was already merged to main, our branch      │
│           will show conflicts or duplicate changes in the diff.          │
│                                                                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  CORRECT APPROACH (clean diff):                                          │
│  ────────────────────────────────                                        │
│                                                                          │
│  main ──●──●──●──●──●──●──●──●──●──●  (we ignore this)                  │
│                                                                          │
│  Original PR's parent commit                                             │
│            │                                                             │
│            ▼                                                             │
│       base-for-pr-123 ──●  (frozen at original base)                    │
│                          ╲                                               │
│                           ╲──●──●──●  review-pr-123 (cherry-picked)     │
│                                                                          │
│  The PR is: review-pr-123 → base-for-pr-123                             │
│  This gives us the EXACT same diff as the original PR!                  │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

**Why this matters:**

The original PR might already be merged into `main`. If we create our review branch and PR against `main`:
- The diff would be empty (changes already in main)
- Or show weird conflicts from intervening commits

By creating our own `base-for-pr-{N}` branch at the exact commit where the original PR started, we get a pristine reproduction of the original diff.

```typescript
// Find the TRUE base: parent of first commit in the PR
const { data: firstCommitData } = await octokit.repos.getCommit({
  owner: upstreamOwner,
  repo: repoName,
  ref: firstPrCommitSha,
});
const baseCommit = firstCommitData.parents[0].sha;

// Create BOTH branches from this base
await repoGit.checkout(["-b", baseBranchName, baseCommit]);  // base-for-pr-123
await repoGit.checkout(["-b", branchName, baseCommit]);      // review-pr-123
```

### Simulation Strategies

The PR simulation system uses three strategies to recreate PRs, selected based on the PR state and what information is available. The system prioritizes strategies that preserve the exact state of the original PR.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    STRATEGY SELECTION PRIORITY                           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  1. MERGED PRs → Merge Commit Parents Strategy                           │
│     ─────────────────────────────────────────                            │
│     • Fetch the merge commit SHA from the PR                             │
│     • Extract Parent 0 (base) and Parent 1 (PR head) from merge commit   │
│     • Create branches directly at these commits                          │
│     • Result: Exact state at merge time preserved                        │
│                                                                          │
│     Also handles SQUASH MERGES:                                          │
│     • Detected when merge commit has only 1 parent                       │
│     • Uses base branch head and squash commit                            │
│                                                                          │
│  2. OPEN PRs → Direct PR Head Fetch Strategy                             │
│     ─────────────────────────────────────────                            │
│     • Fetch using refs/pull/{number}/head                                │
│     • Use base branch head as the base commit                            │
│     • Create branches directly without cherry-picking                    │
│     • Result: Current PR state preserved exactly                         │
│                                                                          │
│  3. FALLBACK → Cherry-Pick Strategy                                      │
│     ──────────────────────────────────                                   │
│     • Only used if strategies 1 and 2 fail                               │
│     • Fetch all PR commits from GitHub API                               │
│     • Find true base (parent of first PR commit)                         │
│     • Cherry-pick each non-merge commit sequentially                     │
│     • Result: PR recreated commit-by-commit                              │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

**Why multiple strategies?**

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    STRATEGY COMPARISON                                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Strategy              Pros                         Cons                 │
│  ────────              ────                         ────                 │
│                                                                          │
│  Merge Commit          • Exact merged state         • Only works for     │
│  Parents               • Fast (no cherry-pick)        merged PRs         │
│                        • Handles squash merges      • Needs merge commit │
│                                                       SHA                │
│                                                                          │
│  PR Head Fetch         • Works for open PRs         • May include        │
│                        • Fast (no cherry-pick)        changes not in     │
│                        • Current state preserved      original PR        │
│                                                                          │
│  Cherry-Pick           • Always works               • Slower             │
│                        • Works even if PR           • May fail on        │
│                          branch deleted               conflicts          │
│                                                     • Skips merge        │
│                                                       commits            │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

**Implementation:**

```typescript
// Strategy priority selection
let useDirectStrategy = false;
let directBaseCommit: string | undefined;
let directHeadCommit: string | undefined;
let strategyName: string = "cherry-pick";

if (isPRMerged && mergeCommitSha) {
  // MERGED PR: Use merge commit parent strategy
  const mergeCommit = await octokit.repos.getCommit({ ref: mergeCommitSha });

  if (mergeCommit.parents.length >= 2) {
    // Standard merge commit
    directBaseCommit = mergeCommit.parents[0].sha;  // base branch
    directHeadCommit = mergeCommit.parents[1].sha;  // PR head
    useDirectStrategy = true;
    strategyName = "merge-commit";
  } else if (mergeCommit.parents.length === 1) {
    // Squash merge - single parent
    directBaseCommit = mergeCommit.parents[0].sha;
    directHeadCommit = mergeCommitSha;
    useDirectStrategy = true;
    strategyName = "squash-merge";
  }
}

// For OPEN PRs (or if merged strategy failed), try fetching PR head
if (!useDirectStrategy) {
  try {
    const prRef = await octokit.git.getRef({ ref: `pull/${prNumber}/head` });
    directHeadCommit = prRef.object.sha;

    const baseRef = await octokit.git.getRef({ ref: `heads/${baseBranch}` });
    directBaseCommit = baseRef.object.sha;

    useDirectStrategy = true;
    strategyName = "pr-head-fetch";
  } catch {
    // Fall back to cherry-pick
  }
}
```

**Cherry-Pick Fallback Details:**

When cherry-pick is used, we handle merge commits specially:

```typescript
// Filter out merge commits (they can't be cherry-picked directly)
const mergeCommitCount = prCommits.filter(c => c.isMergeCommit).length;
const commitsToApply = prCommits.filter(c => !c.isMergeCommit);

// A commit is a merge commit if it has more than one parent
const isMergeCommit = (c.parents?.length || 0) > 1;

// Cherry-pick each commit
for (const commit of commitsToApply) {
  await git.raw(["cherry-pick", commit.sha]);
}
```

### Q&A: PR Simulation

**Q: Why are there multiple simulation strategies?**

A: Different PR states require different approaches:
- **Merged PRs**: The merge commit contains the exact state at merge time. Using merge commit parents is the most accurate way to recreate the PR.
- **Open PRs**: The PR head ref (`refs/pull/N/head`) gives us the current state without needing to cherry-pick.
- **Fallback**: Cherry-pick is used when the above strategies aren't available (e.g., merge commit deleted, PR branch force-pushed).

**Q: Why is merge commit parents preferred for merged PRs?**

A: The merge commit's parents represent:
- Parent 0: The exact state of the base branch at merge time
- Parent 1: The exact state of the PR branch at merge time

This gives us a perfect reproduction of what was reviewed and merged, even if commits were rebased or squashed before merging.

**Q: What happens if the original PR has merge conflicts?**

A: With the direct strategies (merge-commit, pr-head-fetch), conflicts don't occur because we're using the exact commits. With cherry-pick fallback, the operation will fail and the user sees an error message indicating which commit couldn't be applied.

**Q: Why use force push?**

A: We use `--force` when pushing branches because:
1. If re-simulating a PR, we need to overwrite the old branch
2. The branches are isolated (no one else is working on them)
3. It ensures we have a clean state

```typescript
await repoGit.push(["origin", branchName, "--force"]);
```

**Q: How are squash merges handled?**

A: Squash merges are detected when the merge commit has only one parent (the base branch). In this case:
- directBaseCommit = the single parent (base branch state)
- directHeadCommit = the merge commit SHA itself (contains all squashed changes)

**Q: What about large PRs with hundreds of commits?**

A: With direct strategies, commit count doesn't matter - we just use the base and head commits. For cherry-pick fallback, we process commits sequentially (GitHub API returns up to 100 commits per page).

**Q: Can this handle PRs from private repositories?**

A: Only if our bot token has read access to the private repository. For truly private repos without access, the simulation will fail at the "Fetch PR" step.

---

## Repository Caching

### Caching Overview

Repository caching stores git repositories on disk to speed up subsequent PR simulations. Instead of cloning a multi-gigabyte repository from scratch each time, we maintain a local copy and use git's `--reference` flag for fast clones.

### Why Caching?

**The Problem:**

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    CLONE TIMES WITHOUT CACHING                           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Repository              Size        Clone Time                          │
│  ─────────────────────────────────────────────────                       │
│  supabase/supabase       ~2 GB       3-5 minutes                         │
│  facebook/react          ~500 MB     1-2 minutes                         │
│  kubernetes/kubernetes   ~3 GB       5-8 minutes                         │
│                                                                          │
│  For each PR simulation, we'd wait several minutes just for cloning!     │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

**The Solution:** Keep repositories cached on disk and use reference clones.

### Git Reference Clones

Git's `--reference` flag is the core technology behind our caching system:

```bash
# Normal clone (slow - downloads everything)
git clone https://github.com/supabase/supabase.git

# Reference clone (fast - reuses local objects)
git clone --reference /data/repos/supabase/supabase \
          https://github.com/supabase/supabase.git \
          /tmp/working-dir
```

**How `--reference` works:**

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    HOW GIT --REFERENCE WORKS                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  WITHOUT --reference:                                                    │
│  ────────────────────                                                    │
│                                                                          │
│  GitHub ──────────────────────────────────────────► /tmp/working-dir    │
│          (download all objects: 2GB)                 .git/objects/      │
│                                                      (2GB on disk)      │
│                                                                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  WITH --reference:                                                       │
│  ─────────────────                                                       │
│                                                                          │
│  GitHub ─────────► /tmp/working-dir                                     │
│  (download only    .git/objects/                                        │
│   new objects:     (small - only new objects)                           │
│   ~10MB)                  │                                             │
│                           │ references                                  │
│                           ▼                                             │
│                    /data/repos/supabase/supabase                        │
│                    .git/objects/                                        │
│                    (2GB - already on disk)                              │
│                                                                          │
│  The working clone REFERENCES the cached repo's objects instead of      │
│  downloading them again. Only new/missing objects are fetched.          │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

**Implementation:**

```typescript
async function cloneToWorkDir(owner, repo, githubToken) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "macroscope-"));

  // Check if we have a cached reference repo
  if (isRepoClonedLocally(owner, repo)) {
    const refPath = getRepoCachePath(owner, repo);
    console.log(`[GIT CACHE] Fast clone using reference repo`);

    // Fast clone: reuse objects from reference
    await git.clone(cloneUrl, tmpDir, [
      "--no-single-branch",
      "--reference", refPath,  // <-- The magic flag
      "--progress"
    ]);
  } else {
    // No cache - regular slow clone
    await git.clone(cloneUrl, tmpDir, ["--no-single-branch", "--progress"]);
  }

  return tmpDir;
}
```

### Selective Caching

We don't cache every repository - that would consume too much disk space. Instead, we use a "cache list" to selectively cache important repositories:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    SELECTIVE CACHING MODEL                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  DATABASE (cache list)           DISK (actual cached repos)             │
│  ─────────────────────           ───────────────────────────            │
│                                                                          │
│  ┌──────────────────────┐        /data/repos/                           │
│  │ cached_repos table   │        ├── macroscope-gtm/                    │
│  │                      │        │   └── supabase/     (2.1 GB)         │
│  │ • supabase/supabase  │◄──────►│       └── .git/                      │
│  │ • vercel/next.js     │        │                                      │
│  │ • facebook/react     │        └── (next.js not cloned yet)           │
│  └──────────────────────┘                                               │
│                                                                          │
│  The cache list says WHAT should be cached.                             │
│  The disk shows WHAT is actually cached.                                │
│                                                                          │
│  A repo can be:                                                          │
│   • In list + On disk    → Cached and ready (fast clones)               │
│   • In list + Not on disk → Marked for caching (will cache on next use) │
│   • Not in list + On disk → Orphaned (from old simulations)             │
│   • Not in list + Not disk → Not cached (always slow clone)             │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

**The check before caching:**

```typescript
async function ensureReferenceRepo(owner, repo, githubToken) {
  // Only cache repos that are in the cache list
  if (!shouldCacheRepo(owner, repo)) {
    console.log(`[GIT CACHE] Skip: ${owner}/${repo} not in cache list`);
    return false;  // Don't cache, use slow clone
  }

  // Repo is in cache list - ensure it's cloned/updated
  if (isRepoClonedLocally(owner, repo)) {
    console.log(`[GIT CACHE] Hit: Updating reference repo`);
    await git.fetch(["--all", "--tags", "--prune"]);
  } else {
    console.log(`[GIT CACHE] Miss: Cloning reference repo`);
    await git.clone(cloneUrl, repoPath, ["--no-single-branch"]);
  }

  return true;
}
```

### Auto-Caching in Bulk Simulations

When using Discover Mode to simulate multiple PRs, caching happens automatically. This is a key optimization for the bulk simulation workflow:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    AUTO-CACHING IN BULK SIMULATIONS                      │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  User selects 5 PRs from supabase/supabase                              │
│                                                                          │
│  PR #1: First simulation                                                 │
│  ───────────────────────                                                 │
│  • cacheRepo: true sent with request                                    │
│  • Repo not in cache → full clone (~3 min for large repos)              │
│  • Repo added to cache list automatically                               │
│  • Reference repo stored on disk                                        │
│                                                                          │
│  PR #2-5: Subsequent simulations                                        │
│  ───────────────────────────────                                        │
│  • cacheRepo: true sent with request                                    │
│  • Repo found in cache → fast reference clone (~10 sec)                 │
│  • Only new objects downloaded                                          │
│                                                                          │
│  RESULT: 5 PRs simulated much faster than 5 individual simulations      │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

**Implementation in bulk simulation:**

```typescript
// Each PR in the batch is simulated with cacheRepo: true
const response = await fetch("/api/create-pr", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    prUrl,
    cacheRepo: true,  // Always cache during bulk operations
  }),
});
```

**Benefits of auto-caching:**

1. **Progressive speedup**: First PR is slow, subsequent PRs are fast
2. **No manual setup**: Users don't need to pre-configure the cache list
3. **Persistent benefit**: Cached repos remain for future sessions
4. **Automatic for strategic accounts**: If you're bulk-simulating, the repo is probably important

### Concurrency Control

When multiple users simulate PRs for the same repository simultaneously, we need to prevent race conditions:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    CONCURRENCY PROBLEMS                                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  PROBLEM 1: Race condition on same repo                                  │
│  ───────────────────────────────────────                                 │
│                                                                          │
│  User A ──► Clone supabase to cache ──┐                                 │
│                                        ├──► CONFLICT!                   │
│  User B ──► Clone supabase to cache ──┘                                 │
│                                                                          │
│  Both try to write to /data/repos/macroscope-gtm/supabase               │
│                                                                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  PROBLEM 2: Resource exhaustion                                          │
│  ──────────────────────────────                                          │
│                                                                          │
│  User A ──► Clone repo1 (2GB)                                           │
│  User B ──► Clone repo2 (3GB)     ├──► Server runs out of memory/CPU    │
│  User C ──► Clone repo3 (1GB)     │                                     │
│  User D ──► Clone repo4 (2GB) ────┘                                     │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

**Solution 1: Per-Repository Mutex Locks**

```typescript
// In-memory mutex map
const repoLocks = new Map<string, Promise<void>>();

async function acquireRepoLock(owner: string, repo: string): Promise<() => void> {
  const key = `${owner}/${repo}`;

  // Wait for any existing lock to be released
  while (repoLocks.has(key)) {
    await repoLocks.get(key);
  }

  // Create new lock
  let releaseLock: () => void;
  const lockPromise = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });
  repoLocks.set(key, lockPromise);

  // Return release function
  return () => {
    repoLocks.delete(key);
    releaseLock!();
  };
}
```

**Solution 2: Global Clone Semaphore**

Limits total concurrent clone operations across all repos:

```typescript
const MAX_CONCURRENT_CLONES = 3;
let activeClones = 0;
const cloneQueue: Array<() => void> = [];

async function acquireGlobalCloneSemaphore(): Promise<() => void> {
  if (activeClones < MAX_CONCURRENT_CLONES) {
    activeClones++;
    return () => {
      activeClones--;
      const next = cloneQueue.shift();
      if (next) next();  // Wake up next waiting clone
    };
  }

  // Wait in queue for a slot
  await new Promise<void>((resolve) => {
    cloneQueue.push(resolve);
  });

  activeClones++;
  return () => {
    activeClones--;
    const next = cloneQueue.shift();
    if (next) next();
  };
}
```

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    CONCURRENCY CONTROL FLOW                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Request ──► Acquire Repo Lock ──► Acquire Global Semaphore ──► Clone   │
│                    │                        │                            │
│                    │                        │                            │
│              [waits if same            [waits if 3                       │
│               repo is being             clones already                   │
│               cloned]                   running]                         │
│                    │                        │                            │
│                    ▼                        ▼                            │
│              Clone completes ──► Release Semaphore ──► Release Lock     │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Cache Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    CACHE DIRECTORY STRUCTURE                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  /data/                            (persistent volume on Railway)        │
│  ├── pr-creator.db                 (SQLite database)                    │
│  │   └── cached_repos table        (list of repos to cache)             │
│  │                                                                       │
│  └── repos/                        (cached git repositories)            │
│      └── {owner}/                                                        │
│          └── {repo}/                                                     │
│              └── .git/             (bare-ish clone with all branches)   │
│                  ├── objects/      (git objects - the big stuff)        │
│                  ├── refs/         (branch/tag references)              │
│                  └── config        (remote URLs, etc.)                  │
│                                                                          │
│  /tmp/macroscope-{random}/         (temporary working directories)      │
│  └── .git/                         (working clone for a PR simulation)  │
│      └── objects/info/alternates   (points to reference repo)           │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

**Why separate temp directories?**

Each PR simulation gets its own temp directory (`/tmp/macroscope-{random}/`). This prevents:
- Race conditions between concurrent simulations
- Leftover state from previous operations
- File locking issues

```typescript
// Each request gets isolated temp directory
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "macroscope-"));

// After simulation completes, clean up
fs.rmSync(tmpDir, { recursive: true, force: true });
```

### Q&A: Caching

**Q: Why not cache all repositories automatically?**

A: Disk space is finite. A single large repository like `kubernetes/kubernetes` is ~3GB. If we cached every repo we ever simulated a PR for, we'd quickly exhaust our storage. The selective caching approach lets users explicitly choose which repos are important enough to cache.

**Q: How does git know to use the reference repo's objects?**

A: When cloning with `--reference`, git creates a file at `.git/objects/info/alternates` in the new clone that points to the reference repo's objects directory:

```bash
$ cat /tmp/macroscope-xyz/.git/objects/info/alternates
/data/repos/macroscope-gtm/supabase/.git/objects
```

Git checks this "alternates" file when looking up objects, so it finds them in the reference repo without downloading again.

**Q: What if the reference repo becomes corrupted?**

A: The working clone still has its own objects for anything new. If the reference is deleted or corrupted:
- Existing working clones continue to work
- New clones will fail to resolve referenced objects
- Solution: Delete and re-clone the reference repo

**Q: Why use a semaphore instead of just mutex locks?**

A: Mutex locks prevent the same repo from being cloned twice simultaneously, but don't limit total resource usage. The semaphore (`MAX_CONCURRENT_CLONES = 3`) ensures we don't overwhelm the server with too many concurrent git operations, regardless of which repos are being cloned.

**Q: How do you update credentials when tokens rotate?**

A: Before each fetch operation on the cache, we update the remote URL:

```typescript
// Update remote URL in case token was rotated
await git.remote(["set-url", "origin", cloneUrl]);
await git.fetch(["--all", "--tags", "--prune"]);
```

This ensures the cached repo always uses the current token, even if it was originally cloned with an older token.

**Q: What happens if a clone fails halfway through?**

A: We clean up partial clones to prevent corrupted state:

```typescript
try {
  await git.clone(cloneUrl, repoPath, ["--no-single-branch"]);
} catch (error) {
  // Clean up partial clone on failure
  if (fs.existsSync(repoPath)) {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
  throw error;
}
```

---

## AI Analysis & Schema Validation

### Analysis Overview

After Macroscope reviews a PR, we use Claude (Opus 4.5) to analyze the review comments and identify meaningful bugs. The AI filters out style suggestions, nitpicks, and minor issues to surface the bugs that matter most for developer outreach.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      AI ANALYSIS PIPELINE                                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  MACROSCOPE REVIEW                   AI ANALYSIS                        │
│  ─────────────────                   ───────────                        │
│                                                                          │
│  ┌─────────────────┐                 ┌─────────────────┐                │
│  │ 15 review       │                 │ Categorized     │                │
│  │ comments on PR  │ ───► Claude ───►│ results:        │                │
│  │                 │                 │                 │                │
│  │ • nitpicks      │                 │ • 2 critical    │                │
│  │ • style issues  │                 │ • 3 high        │                │
│  │ • bugs          │                 │ • 1 medium      │                │
│  │ • suggestions   │                 │ • 9 filtered    │                │
│  └─────────────────┘                 └─────────────────┘                │
│                                             │                            │
│                                             ▼                            │
│                                      ┌─────────────────┐                │
│                                      │ Best Bug for    │                │
│                                      │ Outreach: #3    │                │
│                                      │ (critical bug   │                │
│                                      │  with clear fix)│                │
│                                      └─────────────────┘                │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Analysis Pipeline

The analysis flow spans multiple components:

```typescript
// 1. Fetch Macroscope comments from the PR
const macroscopeComments = reviewComments.filter(
  (comment) => comment.user?.login === "macroscopeapp[bot]"
);

// 2. Run AI analysis using the configured prompt
const analysisResult = await analyzePR({
  forkedPrUrl: prUrl,
  originalPrUrl: originalUrl,
});

// 3. Save to database with schema version tracking
const analysisId = saveAnalysis(prId, hasBugs, JSON.stringify(result), {
  totalCommentsProcessed: result.total_comments_processed,
  meaningfulBugsCount: result.meaningful_bugs_count,
  outreachReadyCount: result.outreach_ready_count,
  bestBugIndex: result.best_bug_for_outreach_index,
  summaryJson: JSON.stringify(result.summary),
  schemaVersion: 2,  // Track which format was used
});
```

**Key files:**
- `lib/services/pr-analyzer.ts` - Core analysis logic
- `lib/services/anthropic.ts` - Claude API wrapper
- `app/api/analyze-pr/route.ts` - API endpoint for simulated PRs
- `app/api/analyze-internal-pr/route.ts` - API endpoint for internal PRs

### Schema Versions (V1 vs V2)

The analysis output schema has evolved over time. We maintain backwards compatibility:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    SCHEMA VERSION COMPARISON                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  V1 (Original)                      V2 (Current)                        │
│  ─────────────                      ────────────                        │
│                                                                          │
│  {                                  {                                   │
│    meaningful_bugs_found: true,       total_comments_processed: 15,    │
│    total_macroscope_bugs_found: 5,    meaningful_bugs_count: 6,        │
│    bugs_found: [...]                  outreach_ready_count: 4,         │
│  }                                    best_bug_for_outreach_index: 3,  │
│                                       all_comments: [{                  │
│                                         index: 0,                       │
│                                         category: "bug_critical",       │
│                                         title: "SQL Injection",         │
│                                         explanation: "...",             │
│                                         explanation_short: "...",       │
│                                         impact_scenario: "...",         │
│                                         code_suggestion: "...",         │
│                                         is_meaningful_bug: true,        │
│                                         outreach_ready: true,           │
│                                       }, ...],                          │
│                                       summary: {                        │
│                                         bugs_by_severity: {...},        │
│                                         non_bugs: {...},                │
│                                         recommendation: "..."           │
│                                       }                                 │
│                                     }                                   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

**Type guards for version detection:**

```typescript
export function isV2AnalysisResult(result: unknown): result is PRAnalysisResultV2 {
  return (
    typeof result === "object" &&
    result !== null &&
    "all_comments" in result &&
    "summary" in result &&
    "total_comments_processed" in result
  );
}

export function isV1AnalysisResult(result: unknown): result is PRAnalysisResultV1 {
  return (
    typeof result === "object" &&
    result !== null &&
    "meaningful_bugs_found" in result &&
    !("all_comments" in result)
  );
}
```

### Dynamic Token Limits

Large PRs with many comments can produce responses that exceed Claude's default output limits. We dynamically calculate `max_tokens` based on comment count:

```typescript
function calculateMaxTokens(commentCount: number): number {
  // Estimate ~500 tokens per comment analysis
  const estimatedTokensPerComment = 500;
  const baseTokens = 2000;  // For summary and structure
  const maxTokensCap = 16384;  // Claude's max output

  const calculated = baseTokens + commentCount * estimatedTokensPerComment;
  return Math.min(calculated, maxTokensCap);
}
```

**Truncation detection:**

```typescript
function isCompleteJSON(str: string): boolean {
  const trimmed = str.trim();
  // Quick check: complete JSON ends with } or ]
  if (!trimmed.endsWith("}") && !trimmed.endsWith("]")) {
    return false;
  }
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

// In the API call
const response = await anthropic.messages.create({
  model: promptModel,
  max_tokens: calculateMaxTokens(commentCount),
  // ...
});

if (!isCompleteJSON(responseText)) {
  throw new Error("Response was truncated. Try with fewer comments.");
}
```

### Schema Registry with Zod

We use Zod to define and validate expected output schemas. This enables:
1. Type-safe schema definitions
2. Runtime validation
3. Auto-generated documentation
4. Compatibility checking

```typescript
// lib/schemas/prompt-schemas.ts

import { z } from "zod";

// Schema for individual comment analysis
const analysisCommentSchema = z.object({
  index: z.number(),
  macroscope_comment_text: z.string(),
  file_path: z.string(),
  line_number: z.number().nullable(),
  category: z.enum([
    "bug_critical", "bug_high", "bug_medium", "bug_low",
    "suggestion", "style", "nitpick",
  ]),
  title: z.string(),
  explanation: z.string(),
  explanation_short: z.string().nullable(),
  impact_scenario: z.string().nullable(),
  code_suggestion: z.string().nullable(),
  is_meaningful_bug: z.boolean(),
  outreach_ready: z.boolean(),
  outreach_skip_reason: z.string().nullable(),
});

// Schema for PR Analysis output (V2)
export const prAnalysisSchema = z.object({
  total_comments_processed: z.number(),
  meaningful_bugs_count: z.number(),
  outreach_ready_count: z.number(),
  best_bug_for_outreach_index: z.number().nullable(),
  all_comments: z.array(analysisCommentSchema),
  summary: z.object({
    bugs_by_severity: z.object({
      critical: z.number(),
      high: z.number(),
      medium: z.number(),
      low: z.number(),
    }),
    non_bugs: z.object({
      suggestions: z.number(),
      style: z.number(),
      nitpicks: z.number(),
    }),
    recommendation: z.string(),
  }),
});

// Map prompt names to schemas
export const promptSchemas: Record<string, z.ZodSchema> = {
  "pr-analysis": prAnalysisSchema,
  "email-generation": emailGenerationSchema,
};
```

### Schema Validation Flow

When users edit prompts, we validate their changes against the expected schema:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    SCHEMA VALIDATION FLOW                                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  User edits prompt                                                       │
│        │                                                                 │
│        ▼                                                                 │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐               │
│  │ Click       │────►│ POST to     │────►│ Claude      │               │
│  │ "Validate   │     │ /api/prompts│     │ extracts    │               │
│  │  Schema"    │     │ /validate-  │     │ schema from │               │
│  │             │     │ schema      │     │ prompt text │               │
│  └─────────────┘     └─────────────┘     └─────────────┘               │
│                                                 │                        │
│                                                 ▼                        │
│                            ┌─────────────────────────────┐              │
│                            │ Compare extracted schema    │              │
│                            │ against Zod-defined schema: │              │
│                            │                             │              │
│                            │ • Missing required fields?  │              │
│                            │ • Type mismatches?          │              │
│                            │ • Renamed fields?           │              │
│                            └─────────────────────────────┘              │
│                                          │                              │
│                       ┌──────────────────┴──────────────────┐          │
│                       │                                      │          │
│                       ▼                                      ▼          │
│              ┌─────────────┐                        ┌─────────────┐    │
│              │ Compatible  │                        │ Incompatible│    │
│              │ ───────────►│                        │ ───────────►│    │
│              │ Save prompt │                        │ Show warning│    │
│              │ normally    │                        │ modal       │    │
│              └─────────────┘                        └─────────────┘    │
│                                                            │            │
│                                          ┌─────────────────┴─────┐     │
│                                          │                       │     │
│                                          ▼                       ▼     │
│                                   ┌───────────┐          ┌───────────┐ │
│                                   │ "Go Back  │          │ "Save     │ │
│                                   │  & Edit"  │          │  Anyway"  │ │
│                                   └───────────┘          └───────────┘ │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**Validation API endpoint:**

```typescript
// app/api/prompts/validate-schema/route.ts

export async function POST(request: NextRequest) {
  const { promptType, promptContent } = await request.json();

  // Get expected schema from registry
  const expectedSchema = getPromptSchema(promptType);
  if (!expectedSchema) {
    return NextResponse.json({ compatible: true, warnings: ["No schema defined"] });
  }

  // Use Claude to extract and compare schemas
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    messages: [{
      role: "user",
      content: `Compare the schema defined in this prompt against the expected schema...

Expected Schema:
${schemaToDescription(expectedSchema)}

Prompt to validate:
${promptContent}

Identify:
- Missing required fields
- Type mismatches
- Renamed fields
- Breaking changes`
    }]
  });

  // Return validation result
  return NextResponse.json({
    compatible: !hasBreakingChanges,
    missing_fields: [...],
    type_mismatches: [...],
    summary: "..."
  });
}
```

**Schema info endpoint:**

```typescript
// app/api/prompts/schema-info/route.ts

export async function GET(request: NextRequest) {
  const promptType = request.nextUrl.searchParams.get("type");
  const schemaInfo = getPromptSchemaInfo(promptType);

  return NextResponse.json({
    type: promptType,
    hasSchema: true,
    requiredFields: ["total_comments_processed", "meaningful_bugs_count", ...],
    allFieldPaths: ["summary.bugs_by_severity.critical", ...],
    schemaTree: `
      total_comments_processed: number
      meaningful_bugs_count: number
      all_comments: [
        {
          index: number
          category: enum(bug_critical | bug_high | ...)
          ...
        }
      ]
      summary: {
        bugs_by_severity: { critical: number, ... }
        ...
      }
    `
  });
}
```

### Q&A: AI Analysis

**Q: Why use Claude to extract the schema instead of parsing the prompt directly?**

A: Prompts define schemas in natural language (e.g., "Return a JSON object with fields..."). There's no standard format, and the schema may be specified across multiple sections with examples. Claude can understand the intent and extract the effective schema regardless of how it's written.

**Q: What happens if validation fails during save?**

A: The user sees a warning modal explaining what's wrong (missing fields, type changes). They can either:
1. Go back and fix the prompt
2. Force-save anyway (with a scary red button labeled "Save Anyway (Dangerous)")

This allows expert users to bypass validation when they know what they're doing, while protecting against accidental breaking changes.

**Q: How do you handle prompts that don't have a defined schema?**

A: The schema registry only defines schemas for prompts where we have specific code expectations (like `pr-analysis`). For prompts without defined schemas, validation is skipped and the user can save freely.

**Q: Why track schema_version in the database?**

A: When displaying old analysis results, we need to know which format to expect. The `schema_version` column (1 or 2) tells the frontend how to render the data:
- V1: Simple bug list display
- V2: Rich categorized display with severity badges

**Q: What if the AI returns truncated JSON?**

A: We detect truncation before attempting to parse:
1. Check if the response ends with `}` or `]`
2. Try to parse as JSON
3. If either fails, throw an error with a helpful message

The frontend shows "Response was truncated" and suggests retrying with fewer comments.

---

## Summary

| Feature | Purpose | Key Technology |
|---------|---------|----------------|
| Discover Mode | Find and batch-simulate high-value PRs | PR scoring algorithm, SSE streaming |
| PR Simulation | Recreate external PRs for analysis | Git cherry-pick, dual-branch architecture |
| Repository Caching | Speed up cloning | Git `--reference` flag, auto-caching |
| AI Analysis | Categorize and filter bugs | Claude API, dynamic token limits |
| Schema Validation | Prevent breaking prompt changes | Zod schemas, Claude schema extraction |

All features work together: Discover Mode helps find the best PRs to review, caching makes simulation fast (especially for bulk operations), simulation creates the isolated environment for Macroscope review, and AI analysis extracts actionable bugs from the review comments with schema validation ensuring prompt changes don't break the pipeline.

---

## Development Setup

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
# GitHub Bot Token (for macroscope-gtm-bot account)
# All forks and PRs are created under the macroscope-gtm organization
GITHUB_BOT_TOKEN=ghp_your_bot_token_here

# GitHub OAuth (for user authentication)
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

### Development Commands

```bash
npm run dev      # Start development server
npm run build    # Build for production
npm start        # Start production server
npm run lint     # Run linter
```

---

## API Reference

### API Routes

| Route | Method | Description |
|-------|--------|-------------|
| `/api/discover-prs` | POST | Discover and score PRs from a repository |
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
| `/api/prompts/versions` | GET | Get prompt version history |
| `/api/prompts/versions/revert` | POST | Revert to a previous prompt version |
| `/api/prompts/schema-info` | GET | Get expected output schema for a prompt type |
| `/api/prompts/validate-schema` | POST | Validate prompt against expected schema |
| `/api/cache` | GET/POST/DELETE | Manage repository cache list |
| `/api/cache/clear` | POST | Clear all cached repositories |

### Database Schema

The SQLite database stores:
- **forks**: Repository forks created by the tool
- **prs**: Pull requests tracked in each fork
- **pr_analyses**: Cached AI analysis results (supports V1 and V2 schema formats)
- **generated_emails**: Generated outreach emails
- **prompts**: Customizable analysis prompts with version history
- **prompt_versions**: Historical versions of each prompt for rollback
- **cached_repos**: List of repositories to cache for faster cloning

---

## Deployment

### Railway Deployment

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

---

## Troubleshooting

### "GitHub token not configured"
Ensure `GITHUB_BOT_TOKEN` is set in `.env.local` and restart the dev server.

### "Cherry-pick failed" / Merge conflicts
The commit cannot be cleanly applied. This typically only happens with the cherry-pick fallback strategy. The merge-commit and pr-head-fetch strategies don't have this issue. Try:
- Deleting existing branches in your fork
- Re-running the simulation

### "No Macroscope review found"
For internal PR analysis:
- Ensure Macroscope GitHub app is installed on the repository
- Wait for Macroscope to complete its review

### Rate limiting
GitHub API has rate limits. Wait a few minutes if you're creating many PRs quickly.

---

*Last updated: January 2026*
