# How "Recreate PR" Works

This document explains the internal workings of the Recreate PR feature, which takes any GitHub pull request URL and recreates it in your fork for Macroscope code review.

## Overview

When you paste a PR URL like `https://github.com/owner/repo/pull/123`, the app performs these high-level steps:

1. **Fetch PR metadata** from GitHub's API
2. **Determine the recreation strategy** (merge commit strategy vs cherry-pick)
3. **Fork the repository** (if you don't already have one)
4. **Clone your fork** to a temporary directory
5. **Create base and review branches** using the appropriate strategy
6. **Push branches** and create a new PR in your fork

The key innovation is using **two different strategies** depending on whether the PR is merged or open.

---

## Two Recreation Strategies

### Strategy 1: Merge Commit Parents (for Merged PRs)

For PRs that have been merged, we use the **merge commit parent strategy**. This is more reliable because it uses the exact commits that GitHub already knows work together.

**How it works:**

When GitHub merges a PR, it creates a merge commit with exactly two parents:
- **Parent 0**: The state of the base branch (e.g., `main`) at the moment of merge
- **Parent 1**: The final commit of the PR branch (the PR's head)

We use these parents directly to create our branches:

```typescript
if (prMerged && mergeCommitSha) {
  const { data: mergeCommitData } = await octokit.repos.getCommit({
    owner: upstreamOwner,
    repo: repoName,
    ref: mergeCommitSha,
  });

  if (mergeCommitData.parents && mergeCommitData.parents.length >= 2) {
    // Parent 0 = base branch state at merge time
    // Parent 1 = PR's final commit (head of PR branch)
    mergeBaseCommit = mergeCommitData.parents[0].sha;
    mergeHeadCommit = mergeCommitData.parents[1].sha;
    useMergeCommitStrategy = true;
  }
}
```

**Visual explanation:**

```
main:     A --- B --- C --- M (merge commit)
                \         /
PR branch:       X --- Y --- Z

Merge commit M has two parents:
  - Parent 0 = C (base branch state at merge time)
  - Parent 1 = Z (PR's final state)

We create:
  - base-for-pr-123 branch at commit C
  - review-pr-123 branch at commit Z
```

**Why this works better:**

- **No cherry-picking** means no potential for conflicts
- The diff between the two branches is **exactly** what was reviewed in the original PR
- We're using commits that GitHub already validated work together

### Strategy 2: Cherry-Pick (for Open PRs)

For PRs that haven't been merged yet, we fall back to the **cherry-pick strategy** since there's no merge commit to reference.

**How it works:**

1. Find the base commit (parent of the first PR commit)
2. Create a branch at that base commit
3. Cherry-pick each commit from the PR onto that branch

```typescript
// Find the true base commit
const firstPrCommitSha = prCommitsList[0].sha;
const { data: firstCommitData } = await octokit.repos.getCommit({
  owner: upstreamOwner,
  repo: repoName,
  ref: firstPrCommitSha,
});
baseCommit = firstCommitData.parents[0].sha;

// Cherry-pick each commit
for (const commit of commitsToApply) {
  await repoGit.raw(["cherry-pick", commit.sha]);
}
```

---

## Step-by-Step Process

### Step 1: Parse and Fetch PR Details

The process starts by parsing the PR URL to extract the owner, repository name, and PR number:

```typescript
function parsePrUrl(url: string): { owner: string; repo: string; prNumber: number } | null {
  const match = url.match(/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/);
  if (!match) return null;
  return { owner: match[1], repo: match[2], prNumber: parseInt(match[3], 10) };
}
```

Then we fetch the PR details using GitHub's API:

```typescript
const { data: prData } = await octokit.pulls.get({
  owner: upstreamOwner,
  repo: repoName,
  pull_number: prNumber,
});

const prTitle = prData.title;
const prAuthor = prData.user?.login || "unknown";
const prState = prData.state;           // "open" or "closed"
const prMerged = prData.merged;         // true if merged
const mergeCommitSha = prData.merge_commit_sha;  // SHA of the merge commit (if merged)
```

---

### Step 2: Determine the Strategy

Based on whether the PR is merged and has a valid merge commit, we choose our strategy:

```typescript
let useMergeCommitStrategy = false;
let mergeBaseCommit: string | null = null;
let mergeHeadCommit: string | null = null;

if (prMerged && mergeCommitSha) {
  try {
    const { data: mergeCommitData } = await octokit.repos.getCommit({
      owner: upstreamOwner,
      repo: repoName,
      ref: mergeCommitSha,
    });

    if (mergeCommitData.parents && mergeCommitData.parents.length >= 2) {
      // Standard merge: Parent 0 = base branch, Parent 1 = PR head
      mergeBaseCommit = mergeCommitData.parents[0].sha;
      mergeHeadCommit = mergeCommitData.parents[1].sha;
      useMergeCommitStrategy = true;
    } else if (mergeCommitData.parents && mergeCommitData.parents.length === 1) {
      // Squash/rebase merge: use parent as base, merge commit as head
      mergeBaseCommit = mergeCommitData.parents[0].sha;
      mergeHeadCommit = mergeCommitSha;
      useMergeCommitStrategy = true;
    }
  } catch {
    // Fall back to cherry-pick strategy
  }
}
```

**When each strategy is used:**

| Condition | Strategy Used |
|-----------|---------------|
| Merged PR (standard merge - 2 parents) | Merge Commit Parents |
| Merged PR (squash/rebase merge - 1 parent) | Merge Commit Parents |
| Open PR | Cherry-Pick |
| Merge commit fetch fails | Cherry-Pick |

---

### Step 3: Fetch PR Commits

We get all commits from the PR (needed for cherry-pick strategy and for commit count info):

```typescript
const { data: prCommitsList } = await octokit.pulls.listCommits({
  owner: upstreamOwner,
  repo: repoName,
  pull_number: prNumber,
  per_page: 100,
});

const prCommits: PrCommitInfo[] = prCommitsList.map(c => ({
  sha: c.sha,
  message: c.commit.message.split("\n")[0],  // First line only
  isMergeCommit: (c.parents?.length || 0) > 1,  // Has multiple parents = merge commit
}));
```

#### Handling Merge Commits Within PRs

Some PRs contain merge commits (e.g., when the author merged `main` into their branch to resolve conflicts). These are filtered out for the cherry-pick strategy:

```typescript
const commitsToApply = prCommits.filter(c => !c.isMergeCommit);
```

---

### Step 4: Fork the Repository

Before we can create a PR, we need a fork of the repository:

```typescript
// Check if fork already exists
try {
  await octokit.repos.get({
    owner: forkOwner,
    repo: repoName,
  });
  // Fork exists, we can reuse it
} catch {
  // Fork doesn't exist, create one
  await octokit.repos.createFork({
    owner: upstreamOwner,
    repo: repoName,
    organization: GITHUB_ORG,  // Fork to organization
  });

  // Wait for GitHub to finish creating the fork
  await wait(3000);
}
```

We also disable GitHub Actions on the fork to prevent workflows from running:

```typescript
await octokit.actions.setGithubActionsPermissionsRepository({
  owner: forkOwner,
  repo: repoName,
  enabled: false,
});
```

---

### Step 5: Clone the Repository

We clone your fork to a temporary directory on the server:

```typescript
// Create a temporary directory
tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "macroscope-"));

// Clone with authentication token embedded in URL
const cloneUrl = `https://x-access-token:${githubToken}@github.com/${forkOwner}/${repoName}.git`;
await git.clone(cloneUrl, tmpDir, ["--no-single-branch"]);
```

The `--no-single-branch` flag ensures we get all branches, not just the default one.

#### Setting Up Remotes

After cloning, we add the upstream (original) repository as a remote:

```typescript
const repoGit = simpleGit(tmpDir);

// Configure git user for commits
await repoGit.addConfig("user.email", GITHUB_BOT_EMAIL);
await repoGit.addConfig("user.name", GITHUB_BOT_NAME);

// Add upstream remote
const upstreamCloneUrl = `https://github.com/${upstreamOwner}/${repoName}.git`;
await repoGit.addRemote("upstream", upstreamCloneUrl);

// Fetch from upstream
await repoGit.fetch(["upstream", "--no-tags"]);
```

---

### Step 6: Create Branches

This step differs significantly based on the strategy.

#### Merge Commit Strategy (Merged PRs)

We create branches directly from the merge commit parents - no cherry-picking needed:

```typescript
const baseBranchName = `base-for-pr-${prNumber}`;
const branchName = `review-pr-${prNumber}`;

// Create base branch at merge base (parent 0 of merge commit)
await repoGit.checkout(["-b", baseBranchName, mergeBaseCommit]);

// Create review branch at merge head (parent 1 of merge commit = PR's final state)
await repoGit.checkout(["-b", branchName, mergeHeadCommit]);
```

**Result:** Two branches that, when compared, show the exact diff of the original PR.

#### Cherry-Pick Strategy (Open PRs)

We create a base branch and a review branch, then cherry-pick commits onto the review branch:

```typescript
const baseBranchName = `base-for-pr-${prNumber}`;
const branchName = `review-pr-${prNumber}`;

// Create base branch at the base commit
await repoGit.checkout(["-b", baseBranchName, baseCommit]);

// Create review branch from the same base
await repoGit.checkout(["-b", branchName, baseCommit]);

// Cherry-pick each commit
for (const commit of commitsToApply) {
  await repoGit.raw(["cherry-pick", commit.sha]);
}
```

##### What Cherry-Pick Does

When you run `git cherry-pick abc1234`, Git:

1. Finds commit `abc1234`
2. Calculates the diff between that commit and its parent
3. Applies that diff to your current branch
4. Creates a new commit with the same message (but different SHA)

**Visual example:**

```
Before cherry-pick:
base:        A---B---C  (your branch is at C)
PR branch:   A---D---E  (you want to apply E)

After cherry-picking E:
base:        A---B---C---E'  (E' has same changes as E, different parent)
```

##### Handling Cherry-Pick Failures

Cherry-picks can fail due to merge conflicts. If this happens, we abort and report the error:

```typescript
try {
  await repoGit.raw(["cherry-pick", commit.sha]);
} catch {
  try {
    await repoGit.raw(["cherry-pick", "--abort"]);
  } catch {
    // Ignore abort errors
  }
  await cleanup(tmpDir);
  sendError("Cherry-pick failed", `Failed to apply commit ${commit.sha}`);
  return;
}
```

---

### Step 7: Push and Create PR

After branches are created, we push them to your fork:

```typescript
// Push both branches
await repoGit.push(["origin", baseBranchName, "--force"]);
await repoGit.push(["origin", branchName, "--force"]);
```

We use `--force` because if you're re-running this for the same PR, the branches might already exist with different commits.

Finally, we create the pull request from the review branch to the base branch:

```typescript
const { data: pr } = await octokit.pulls.create({
  owner: forkOwner,
  repo: repoName,
  title: `[Review] ${prTitle}`,
  body: newPrBody,
  head: branchName,      // review-pr-123
  base: baseBranchName,  // base-for-pr-123
});
```

**Important:** The PR is created from the review branch to our custom base branch (not `main`). This ensures the diff shows only the PR's changes, not conflicts with other merged content.

---

## Cleanup

After the PR is created (or if an error occurs), we clean up the temporary directory:

```typescript
async function cleanup(tmpDir: string): Promise<void> {
  try {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  } catch {
    // Silently ignore cleanup errors
  }
}
```

---

## Real-Time Status Updates

The API uses Server-Sent Events (SSE) to stream status updates to the frontend in real-time:

```typescript
const stream = new ReadableStream({
  async start(controller) {
    const sendStatus = (status: StatusMessage) => {
      const data = JSON.stringify({
        eventType: "status",
        statusType: status.type,
        step: status.step,
        totalSteps: status.totalSteps,
        message: status.message,
      });
      controller.enqueue(encoder.encode(`data: ${data}\n\n`));
    };

    // ... perform operations, calling sendStatus() at each step
  }
});

return new Response(stream, {
  headers: {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
  },
});
```

This allows the UI to show progress like "Step 7/10: Cherry-picking commit 3/5..." instead of just showing a loading spinner.

---

## Strategy Comparison

| Aspect | Merge Commit Strategy | Cherry-Pick Strategy |
|--------|----------------------|---------------------|
| **Used for** | Merged PRs | Open PRs |
| **Reliability** | Always succeeds | Can fail with conflicts |
| **How it works** | Uses merge commit parents directly | Reconstructs by applying commits |
| **Commit history** | Single state snapshot | Recreates individual commits |
| **Diff accuracy** | Exact match to original PR | Exact match (if successful) |

---

## Edge Cases

### Squash and Rebase Merges

When a PR is squash-merged or rebase-merged, the merge commit has only 1 parent (not 2). We handle this by using:
- **Parent 0** as the base (the state of main before the merge)
- **The merge commit itself** as the head (it contains all the PR changes)

This works because squash commits contain the entire PR diff in a single commit.

### Force-Pushed Branches

If the PR branch was force-pushed after merge, the merge commit's Parent 1 still points to the correct commit that was actually merged, not the current state of the (possibly deleted) branch.

### PRs with Merge Commits

If a PR contains merge commits (e.g., the author merged `main` into their branch), these commits are filtered out during cherry-picking because:
1. Cherry-pick doesn't know which parent to use
2. They often contain changes that are already in the base

---

## Summary

The Recreate PR feature works by:

1. **Fetching PR metadata** to understand the PR state and commits
2. **Choosing the optimal strategy**:
   - **Merged PRs**: Use merge commit parents directly (guaranteed success)
   - **Open PRs**: Use cherry-pick to reconstruct the PR
3. **Creating/reusing a fork** in your organization
4. **Creating two branches**: a base branch and a review branch
5. **Creating a PR** from review branch to base branch for clean diff

The key insight is that for merged PRs, we don't need to reconstruct the commits - we can simply reference the exact commits that GitHub already has. The merge commit serves as a permanent record of both the base state and the PR state at the moment of merge, making it a reliable source for our simulation.
