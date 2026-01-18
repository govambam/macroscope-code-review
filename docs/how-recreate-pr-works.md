# How "Recreate PR" Works

This document explains the internal workings of the Recreate PR feature, which takes any GitHub pull request URL and recreates it in your fork for Macroscope code review.

## Overview

When you paste a PR URL like `https://github.com/owner/repo/pull/123`, the app performs these high-level steps:

1. **Fetch PR metadata** from GitHub's API
2. **Determine the correct base commit** (where to start the branch)
3. **Fork the repository** (if you don't already have one)
4. **Clone your fork** to a temporary directory
5. **Create a new branch** from the base commit
6. **Cherry-pick each commit** from the original PR
7. **Push the branch** and create a new PR in your fork

Let's dive into each step.

---

## Step 1: Parse and Fetch PR Details

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

## Step 2: Determine the Base Commit

This is one of the trickiest parts. The "base commit" is the point in history where we'll create our new branch. We need to choose it carefully to ensure all cherry-picks apply cleanly.

### For Merged PRs

When a PR has been merged, using the original base commit can cause problems. Why? Because other commits may have been merged to `main` between when the PR was opened and when it was merged. Those commits could conflict with the PR's changes.

**Solution:** Use the parent of the merge commit as the base. This represents the exact state of `main` right before the PR was merged.

```typescript
if (prMerged && mergeCommitSha) {
  // Get the merge commit details
  const { data: mergeCommit } = await octokit.repos.getCommit({
    owner: upstreamOwner,
    repo: repoName,
    ref: mergeCommitSha,
  });

  // The first parent of a merge commit is the branch that was merged INTO (main)
  // The second parent is the branch that was merged FROM (the PR branch)
  if (mergeCommit.parents && mergeCommit.parents.length > 0) {
    baseCommit = mergeCommit.parents[0].sha;
  }
}
```

**Visual explanation:**

```
main:    A---B---C---D---M  (M is the merge commit)
                    \   /
PR branch:           E-F   (commits from the PR)

If we use the original base (A), commits E and F might conflict with B, C, D.
If we use M's first parent (D), we're starting from right before the merge.
```

### For Open PRs

For PRs that haven't been merged yet, we use the original base commit since there's no merge commit to reference:

```typescript
} else {
  baseCommit = prData.base.sha;
}
```

---

## Step 3: Fetch PR Commits

Next, we get all commits from the PR:

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

### Handling Merge Commits

Some PRs contain merge commits (e.g., when the author merged `main` into their branch to resolve conflicts). These are problematic for cherry-picking because:

1. Cherry-pick doesn't know which parent to use
2. They often contain changes that are already in the base

**Solution:** Filter out merge commits:

```typescript
const commitsToApply = prCommits.filter(c => !c.isMergeCommit);
```

We detect merge commits by checking if they have more than one parent:

```typescript
isMergeCommit: (c.parents?.length || 0) > 1
```

---

## Step 4: Fork the Repository

Before we can create a PR, we need a fork of the repository under your GitHub account:

```typescript
// Check if fork already exists
try {
  await octokit.repos.get({
    owner: forkOwner,  // Your GitHub username
    repo: repoName,
  });
  // Fork exists, we can reuse it
} catch {
  // Fork doesn't exist, create one
  await octokit.repos.createFork({
    owner: upstreamOwner,
    repo: repoName,
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

## Step 5: Clone the Repository

We clone your fork to a temporary directory on the server:

```typescript
// Create a temporary directory
tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "macroscope-"));

// Clone with authentication token embedded in URL
const cloneUrl = `https://x-access-token:${githubToken}@github.com/${forkOwner}/${repoName}.git`;
await git.clone(cloneUrl, tmpDir, ["--no-single-branch"]);
```

The `--no-single-branch` flag ensures we get all branches, not just the default one.

### Setting Up Remotes

After cloning, we need to add the upstream (original) repository as a remote so we can fetch commits from it:

```typescript
const repoGit = simpleGit(tmpDir);

// Configure git user for commits
await repoGit.addConfig("user.email", "macroscope-pr-creator@example.com");
await repoGit.addConfig("user.name", "Macroscope PR Creator");

// Add upstream remote
const upstreamCloneUrl = `https://github.com/${upstreamOwner}/${repoName}.git`;
await repoGit.addRemote("upstream", upstreamCloneUrl);

// Fetch from upstream
await repoGit.fetch(["upstream", "--no-tags"]);
```

---

## Step 6: Create the Review Branch

We create a new branch starting from the base commit:

```typescript
const branchName = `review-pr-${prNumber}`;

await repoGit.checkout(["-b", branchName, baseCommit]);
```

This creates a new branch called `review-pr-123` (for PR #123) starting at the base commit we determined earlier.

---

## Step 7: Cherry-Pick Commits

This is the core of the recreation process. **Cherry-picking** takes a commit from one branch and applies its changes to another branch, creating a new commit with the same changes but a different parent.

```typescript
for (let i = 0; i < commitsToApply.length; i++) {
  const commit = commitsToApply[i];

  try {
    await repoGit.raw(["cherry-pick", commit.sha]);
  } catch {
    // If cherry-pick fails, try fetching the commit first
    await repoGit.raw(["fetch", "upstream", commit.sha]);
    await repoGit.raw(["cherry-pick", commit.sha]);
  }
}
```

### What Cherry-Pick Does

When you run `git cherry-pick abc1234`, Git:

1. Finds commit `abc1234`
2. Calculates the diff between that commit and its parent
3. Applies that diff to your current branch
4. Creates a new commit with the same message (but different SHA)

**Visual example:**

```
Before cherry-pick:
main:        A---B---C  (your branch is at C)
PR branch:   A---D---E  (you want to apply E)

After cherry-picking E:
main:        A---B---C---E'  (E' has same changes as E, different parent)
```

### Handling Cherry-Pick Failures

Cherry-picks can fail for several reasons:
- **Merge conflicts**: The changes can't be applied cleanly
- **Missing commits**: The commit isn't available locally

If a cherry-pick fails, we abort it and report the error:

```typescript
try {
  await repoGit.raw(["cherry-pick", commit.sha]);
} catch {
  // Try to abort the failed cherry-pick
  try {
    await repoGit.raw(["cherry-pick", "--abort"]);
  } catch {
    // Ignore abort errors
  }

  // Clean up and report error
  await cleanup(tmpDir);
  sendError("Cherry-pick failed", `Failed to apply commit ${commit.sha}`);
  return;
}
```

---

## Step 8: Push and Create PR

After all commits are cherry-picked, we push the branch to your fork:

```typescript
await repoGit.push(["origin", branchName, "--force"]);
```

We use `--force` because if you're re-running this for the same PR, the branch might already exist with different commits.

Finally, we create the pull request using GitHub's API:

```typescript
const { data: pr } = await octokit.pulls.create({
  owner: forkOwner,
  repo: repoName,
  title: `[Review] ${prTitle}`,
  body: `Recreated from ${inputPrUrl} for Macroscope review.

**Original PR:** #${prNumber} by @${prAuthor}
**Status:** ${prState}${prMerged ? " (merged)" : ""}

**Includes ${commitsToApply.length} commit(s):**
${commitsToApply.map(c => `- \`${c.sha.substring(0, 7)}\`: ${c.message}`).join("\n")}`,
  head: branchName,
  base: "main",
});
```

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

## Summary

The Recreate PR feature works by:

1. **Fetching PR metadata** to understand what commits to include
2. **Smart base commit detection** using merge commit parents for merged PRs
3. **Filtering out merge commits** that can't be cherry-picked
4. **Creating/reusing a fork** in your GitHub account
5. **Cherry-picking each commit** to recreate the PR's changes
6. **Creating a new PR** in your fork for Macroscope to review

The key insight is that we're not just copying the PR - we're reconstructing it by applying the same changes in a clean environment, which is why cherry-picking is essential.
