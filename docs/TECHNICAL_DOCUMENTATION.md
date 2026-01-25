# Technical Documentation: PR Simulation, Repository Caching & AI Analysis

This document provides in-depth technical documentation for three core features of the Macroscope Code Review tool: **PR Simulation**, **Repository Caching**, and **AI Analysis with Schema Validation**. It's intended for engineers who want to understand the architecture, implementation details, and design decisions.

---

## Table of Contents

1. [PR Simulation](#pr-simulation)
   - [Overview](#overview)
   - [Why Simulate PRs?](#why-simulate-prs)
   - [The Fork Strategy](#the-fork-strategy)
   - [Step-by-Step Flow](#step-by-step-flow)
   - [Branch Architecture](#branch-architecture)
   - [Cherry-Pick Strategy](#cherry-pick-strategy)
   - [Q&A: PR Simulation](#qa-pr-simulation)

2. [Repository Caching](#repository-caching)
   - [Overview](#caching-overview)
   - [Why Caching?](#why-caching)
   - [Git Reference Clones](#git-reference-clones)
   - [Selective Caching](#selective-caching)
   - [Concurrency Control](#concurrency-control)
   - [Cache Architecture](#cache-architecture)
   - [Q&A: Caching](#qa-caching)

3. [AI Analysis & Schema Validation](#ai-analysis--schema-validation)
   - [Overview](#analysis-overview)
   - [Analysis Pipeline](#analysis-pipeline)
   - [Schema Versions (V1 vs V2)](#schema-versions-v1-vs-v2)
   - [Dynamic Token Limits](#dynamic-token-limits)
   - [Schema Registry with Zod](#schema-registry-with-zod)
   - [Schema Validation Flow](#schema-validation-flow)
   - [Q&A: AI Analysis](#qa-ai-analysis)

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
│          └─► Extract: title, author, state, merge status                 │
│                                                                           │
│  Step 3: Fetch PR Commits                                                │
│          └─► GET /repos/{owner}/{repo}/pulls/{pr_number}/commits         │
│          └─► Build list of commits to cherry-pick                        │
│          └─► Filter out merge commits (they can't be cherry-picked)      │
│                                                                           │
│  Step 4: Find Original Base Commit                                       │
│          └─► Get parent of first PR commit                               │
│          └─► This is the exact point where the PR branched off           │
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
│  Step 8: Create Branches                                                 │
│          └─► Create base-for-pr-{N} at original base commit              │
│          └─► Create review-pr-{N} from same base commit                  │
│                                                                           │
│  Step 9: Cherry-Pick Commits                                             │
│          └─► For each commit in original PR:                             │
│              └─► git cherry-pick {sha}                                   │
│          └─► Skip merge commits                                          │
│                                                                           │
│  Step 10: Push & Create PR                                               │
│           └─► Force push both branches                                   │
│           └─► Create PR: review-pr-{N} → base-for-pr-{N}                 │
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

### Cherry-Pick Strategy

We use `git cherry-pick` to replay commits instead of merging or rebasing. Here's why:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    WHY CHERRY-PICK?                                      │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Option 1: git merge                                                     │
│  ───────────────────                                                     │
│  Problem: Merge brings in the entire branch history, not just the PR     │
│           commits. This could include unrelated changes.                 │
│                                                                          │
│  Option 2: git rebase                                                    │
│  ───────────────────                                                     │
│  Problem: Rebase rewrites commit history. We want to preserve the        │
│           exact commit SHAs for traceability.                            │
│                                                                          │
│  Option 3: git cherry-pick ✓                                             │
│  ──────────────────────────                                              │
│  Benefits:                                                               │
│   • Applies only the specific commits from the PR                        │
│   • Preserves commit messages and authorship                             │
│   • Creates new commits with traceable parent references                 │
│   • Easy to skip merge commits (which can't be cherry-picked directly)   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

**Handling Merge Commits:**

PRs often contain merge commits (e.g., "Merge branch 'main' into feature"). These cannot be cherry-picked normally:

```typescript
// Filter out merge commits
const mergeCommitCount = prCommits.filter(c => c.isMergeCommit).length;
const commitsToApply = prCommits.filter(c => !c.isMergeCommit);

// A commit is a merge commit if it has more than one parent
const isMergeCommit = (c.parents?.length || 0) > 1;
```

### Q&A: PR Simulation

**Q: Why not just clone the PR branch directly?**

A: The PR branch lives in the contributor's fork, which may:
- Be deleted after the PR is merged
- Have restricted access
- Not be available if the contributor's account is deleted

By cherry-picking the commits, we create an independent copy that doesn't depend on the original fork's existence.

**Q: What happens if the original PR has merge conflicts?**

A: The cherry-pick will fail, and we abort the operation. The user sees an error message indicating which commit couldn't be applied. This is intentional - we want to recreate the PR exactly, and conflicts indicate the base has diverged significantly.

**Q: Why use force push?**

A: We use `--force` when pushing branches because:
1. If re-simulating a PR, we need to overwrite the old branch
2. The branches are isolated (no one else is working on them)
3. It ensures we have a clean state

```typescript
await repoGit.push(["origin", branchName, "--force"]);
```

**Q: What about large PRs with hundreds of commits?**

A: We process all commits sequentially. The GitHub API returns up to 100 commits per page. For PRs with more commits, we'd need pagination (current implementation handles up to 100 commits per PR).

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
| PR Simulation | Recreate external PRs for analysis | Git cherry-pick, dual-branch architecture |
| Repository Caching | Speed up cloning | Git `--reference` flag, selective caching |
| AI Analysis | Categorize and filter bugs | Claude API, dynamic token limits |
| Schema Validation | Prevent breaking prompt changes | Zod schemas, Claude schema extraction |

All features work together: caching makes simulation fast, simulation creates the isolated environment for Macroscope review, and AI analysis extracts actionable bugs from the review comments with schema validation ensuring prompt changes don't break the pipeline.

---

*Last updated: January 2026*
