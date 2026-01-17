import { NextRequest, NextResponse } from "next/server";
import simpleGit, { SimpleGit } from "simple-git";
import { Octokit } from "@octokit/rest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Response type for the API
interface ApiResponse {
  success: boolean;
  prUrl?: string;
  message: string;
  commitHash?: string;
  forkUrl?: string;
  error?: string;
  commitCount?: number;
  originalPrNumber?: number;
}

// Commit info from PR
interface PrCommitInfo {
  sha: string;
  message: string;
}

// Parse GitHub repo URL to extract owner and repo name
function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
  const match = url.match(/^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/?$/);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

// Parse GitHub PR URL to extract owner, repo, and PR number
function parsePrUrl(url: string): { owner: string; repo: string; prNumber: number } | null {
  const match = url.match(/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/);
  if (!match) return null;
  return { owner: match[1], repo: match[2], prNumber: parseInt(match[3], 10) };
}

// Generate a short hash for branch naming
function getShortHash(hash: string): string {
  return hash.substring(0, 7);
}

// Clean up temporary directory
async function cleanup(tmpDir: string): Promise<void> {
  try {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  } catch {
    // Silently ignore cleanup errors
  }
}

// Wait for a specified number of milliseconds
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Ensure fork exists, create if needed
async function ensureFork(
  octokit: Octokit,
  forkOwner: string,
  upstreamOwner: string,
  repoName: string
): Promise<{ forkUrl: string; created: boolean }> {
  let forkExists = false;

  try {
    await octokit.repos.get({
      owner: forkOwner,
      repo: repoName,
    });
    forkExists = true;
    console.log("Fork already exists, using existing fork");
  } catch {
    console.log("Fork doesn't exist, creating fork...");
  }

  if (!forkExists) {
    try {
      await octokit.repos.get({
        owner: upstreamOwner,
        repo: repoName,
      });
    } catch {
      throw new Error(`The repository ${upstreamOwner}/${repoName} does not exist or is not accessible`);
    }

    await octokit.repos.createFork({
      owner: upstreamOwner,
      repo: repoName,
    });
    console.log("Fork created, waiting for it to be ready...");
    await wait(3000);
  }

  return {
    forkUrl: `https://github.com/${forkOwner}/${repoName}`,
    created: !forkExists,
  };
}

export async function POST(request: NextRequest): Promise<NextResponse<ApiResponse>> {
  let tmpDir: string | null = null;

  try {
    // Get the GitHub token from environment
    const githubToken = process.env.GITHUB_TOKEN;
    if (!githubToken) {
      return NextResponse.json(
        {
          success: false,
          message: "GitHub token not configured",
          error: "GITHUB_TOKEN environment variable is not set",
        },
        { status: 500 }
      );
    }

    // Parse request body
    const body = await request.json();
    const { repoUrl, commitHash: specifiedCommitHash, prUrl: inputPrUrl } = body;

    // Initialize Octokit with the GitHub token
    const octokit = new Octokit({ auth: githubToken });

    // Get the authenticated user (owner of the fork)
    console.log("Getting authenticated user...");
    const { data: authenticatedUser } = await octokit.users.getAuthenticated();
    const forkOwner = authenticatedUser.login;
    console.log(`Authenticated as: ${forkOwner}`);

    // Determine which mode we're in: PR URL mode or commit mode
    if (inputPrUrl) {
      // ========================================
      // PR URL MODE - Recreate an existing PR
      // ========================================
      console.log("PR URL mode detected");

      // Parse the PR URL
      const parsedPr = parsePrUrl(inputPrUrl);
      if (!parsedPr) {
        return NextResponse.json(
          {
            success: false,
            message: "Invalid PR URL format",
            error: "Expected format: https://github.com/owner/repo/pull/123",
          },
          { status: 400 }
        );
      }

      const { owner: upstreamOwner, repo: repoName, prNumber } = parsedPr;
      console.log(`Parsed PR: ${upstreamOwner}/${repoName}#${prNumber}`);

      // Fetch PR details
      console.log(`Fetching PR #${prNumber} details...`);
      let prData;
      try {
        const { data } = await octokit.pulls.get({
          owner: upstreamOwner,
          repo: repoName,
          pull_number: prNumber,
        });
        prData = data;
      } catch (prError) {
        const errorMessage = prError instanceof Error ? prError.message : String(prError);
        if (errorMessage.includes("Not Found")) {
          return NextResponse.json(
            {
              success: false,
              message: "PR not found",
              error: `Pull request #${prNumber} does not exist or is not accessible in ${upstreamOwner}/${repoName}`,
            },
            { status: 404 }
          );
        }
        throw prError;
      }

      const prTitle = prData.title;
      const prAuthor = prData.user?.login || "unknown";
      const prState = prData.state;
      const prMerged = prData.merged;
      const mergeCommitSha = prData.merge_commit_sha;

      console.log(`PR: "${prTitle}" by @${prAuthor}`);
      console.log(`Status: ${prState}${prMerged ? " (merged)" : ""}`);

      // Determine the correct base commit
      let baseCommit: string;

      if (prMerged && mergeCommitSha) {
        // PR was merged - use the commit immediately before the merge
        console.log("Fetching merge commit details...");
        try {
          const { data: mergeCommit } = await octokit.repos.getCommit({
            owner: upstreamOwner,
            repo: repoName,
            ref: mergeCommitSha,
          });

          if (mergeCommit.parents && mergeCommit.parents.length > 0) {
            // First parent is the main branch state right before this PR was merged
            baseCommit = mergeCommit.parents[0].sha;
            console.log("Using commit immediately before PR was merged as base");
          } else {
            // Fallback to original base if no parents found
            baseCommit = prData.base.sha;
            console.log("No parent found on merge commit, using original base");
          }
        } catch (mergeCommitError) {
          // Fallback to original base if we can't fetch merge commit
          console.log(`Could not fetch merge commit: ${mergeCommitError instanceof Error ? mergeCommitError.message : String(mergeCommitError)}`);
          baseCommit = prData.base.sha;
          console.log("Falling back to original base commit");
        }
      } else {
        // PR was not merged - use the original base
        baseCommit = prData.base.sha;
        console.log("PR not merged - using original base commit");
      }

      // Get all commits from the PR
      console.log("Fetching PR commits...");
      const { data: prCommitsList } = await octokit.pulls.listCommits({
        owner: upstreamOwner,
        repo: repoName,
        pull_number: prNumber,
        per_page: 100,
      });

      const prCommits: PrCommitInfo[] = prCommitsList.map(c => ({
        sha: c.sha,
        message: c.commit.message.split("\n")[0],
      }));

      console.log(`PR contains ${prCommits.length} commit(s)`);

      if (prCommits.length === 0) {
        return NextResponse.json(
          {
            success: false,
            message: "PR has no commits",
            error: "The pull request does not contain any commits to recreate",
          },
          { status: 400 }
        );
      }

      // Ensure fork exists
      console.log("Checking if fork exists...");
      const { forkUrl } = await ensureFork(octokit, forkOwner, upstreamOwner, repoName);

      // Disable GitHub Actions on the fork to prevent unnecessary workflow runs
      console.log("Disabling GitHub Actions on fork...");
      try {
        await octokit.actions.setGithubActionsPermissionsRepository({
          owner: forkOwner,
          repo: repoName,
          enabled: false,
        });
        console.log("GitHub Actions disabled - only Macroscope will run");
      } catch (actionsError) {
        // Non-critical error - continue anyway
        console.log(`Note: Could not disable Actions (continuing anyway): ${actionsError instanceof Error ? actionsError.message : String(actionsError)}`);
      }

      // Create branch name from PR number
      const branchName = `review-pr-${prNumber}`;

      // Check if a PR already exists for this branch
      console.log("Checking for existing PR...");
      try {
        const { data: existingPRs } = await octokit.pulls.list({
          owner: forkOwner,
          repo: repoName,
          state: "open",
          head: `${forkOwner}:${branchName}`,
        });

        if (existingPRs.length > 0) {
          return NextResponse.json({
            success: true,
            message: `A PR already exists for PR #${prNumber}`,
            prUrl: existingPRs[0].html_url,
            forkUrl,
            commitCount: prCommits.length,
            originalPrNumber: prNumber,
          });
        }
      } catch {
        // Continue if we can't check
      }

      // Clone the fork repository
      console.log("Cloning fork...");
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "macroscope-"));

      const cloneUrl = `https://x-access-token:${githubToken}@github.com/${forkOwner}/${repoName}.git`;

      const git: SimpleGit = simpleGit();
      await git.clone(cloneUrl, tmpDir, ["--no-single-branch"]);

      const repoGit = simpleGit(tmpDir);

      await repoGit.addConfig("user.email", "macroscope-pr-creator@example.com");
      await repoGit.addConfig("user.name", "Macroscope PR Creator");

      const upstreamCloneUrl = `https://github.com/${upstreamOwner}/${repoName}.git`;
      await repoGit.addRemote("upstream", upstreamCloneUrl);

      console.log("Fetching from upstream...");
      // Fetch all branches from upstream to ensure we have the commits
      await repoGit.fetch(["upstream", "--no-tags"]);

      // Also fetch the specific commits we need (base commit and all PR commits)
      // This ensures we have them even if they're not on any branch ref
      console.log("Fetching specific commits needed for cherry-pick...");
      const commitsToFetch = [baseCommit, ...prCommits.map(c => c.sha)];
      for (const sha of commitsToFetch) {
        try {
          await repoGit.fetch(["upstream", sha]);
        } catch {
          // Ignore errors - commit might already be available or fetchable via refs
        }
      }

      // Create branch from the PR's base commit
      console.log(`Creating review branch from base commit ${getShortHash(baseCommit)}...`);
      try {
        await repoGit.checkout(["-b", branchName, baseCommit]);
      } catch (checkoutError) {
        // Try fetching the base commit directly from upstream if checkout fails
        console.log("Base commit not found locally, trying to fetch from upstream...");
        try {
          // Fetch the merge commit and its history which should include the base
          if (mergeCommitSha) {
            await repoGit.raw(["fetch", "upstream", mergeCommitSha, "--depth=100"]);
          }
          await repoGit.checkout(["-b", branchName, baseCommit]);
        } catch {
          try {
            await repoGit.checkout([branchName]);
            await repoGit.reset(["--hard", baseCommit]);
          } catch {
            await cleanup(tmpDir);
            return NextResponse.json(
              {
                success: false,
                message: "Failed to create review branch",
                error: `Could not create branch ${branchName} from base commit ${baseCommit}. The commit may not be accessible.`,
              },
              { status: 500 }
            );
          }
        }
      }

      // Cherry-pick all PR commits in order
      console.log(`Cherry-picking ${prCommits.length} commits from PR...`);

      for (let i = 0; i < prCommits.length; i++) {
        const commit = prCommits[i];
        console.log(`Cherry-picking commit ${i + 1}/${prCommits.length}: ${commit.sha.substring(0, 7)}`);

        try {
          await repoGit.raw(["cherry-pick", commit.sha]);
        } catch (cherryPickError) {
          // Try fetching the specific commit from upstream and retry
          console.log(`Cherry-pick failed, trying to fetch commit ${commit.sha.substring(0, 7)} from upstream...`);
          try {
            await repoGit.raw(["fetch", "upstream", commit.sha]);
            await repoGit.raw(["cherry-pick", commit.sha]);
          } catch (retryError) {
            try {
              await repoGit.raw(["cherry-pick", "--abort"]);
            } catch {
              // Ignore abort errors
            }

            await cleanup(tmpDir);
            return NextResponse.json(
              {
                success: false,
                message: "Cherry-pick failed",
                error: `Failed to cherry-pick commit ${commit.sha.substring(0, 7)} (${i + 1}/${prCommits.length}): "${commit.message}". This may be due to merge conflicts or the commit not being accessible.`,
              },
              { status: 409 }
            );
          }
        }
      }

      // Push the new branch to the fork
      console.log("Pushing branch...");
      try {
        await repoGit.push(["origin", branchName, "--force"]);
      } catch (pushError) {
        await cleanup(tmpDir);
        return NextResponse.json(
          {
            success: false,
            message: "Failed to push branch",
            error: `Could not push branch to repository. Error: ${
              pushError instanceof Error ? pushError.message : String(pushError)
            }`,
          },
          { status: 500 }
        );
      }

      // Create the Pull Request with detailed description
      console.log("Creating pull request...");

      const newPrTitle = `[Review] ${prTitle}`;
      const newPrBody = `Recreated from ${inputPrUrl} for Macroscope review.

**Original PR:** #${prNumber} by @${prAuthor}
**Status:** ${prState}${prMerged ? " (merged)" : ""}

**Includes ${prCommits.length} commit(s):**
${prCommits.map(c => `- \`${c.sha.substring(0, 7)}\`: ${c.message}`).join("\n")}

**Original PR:** ${inputPrUrl}`;

      let newPrUrl: string;
      try {
        const { data: pr } = await octokit.pulls.create({
          owner: forkOwner,
          repo: repoName,
          title: newPrTitle,
          body: newPrBody,
          head: branchName,
          base: "main",
        });
        newPrUrl = pr.html_url;
      } catch (prError) {
        const errorMessage = prError instanceof Error ? prError.message : String(prError);

        if (errorMessage.includes("A pull request already exists")) {
          const { data: existingPRs } = await octokit.pulls.list({
            owner: forkOwner,
            repo: repoName,
            state: "open",
            head: `${forkOwner}:${branchName}`,
          });

          if (existingPRs.length > 0) {
            await cleanup(tmpDir);
            return NextResponse.json({
              success: true,
              message: `A PR already exists for PR #${prNumber}`,
              prUrl: existingPRs[0].html_url,
              forkUrl,
              commitCount: prCommits.length,
              originalPrNumber: prNumber,
            });
          }
        }

        // Try with master as base if main failed
        try {
          const { data: pr } = await octokit.pulls.create({
            owner: forkOwner,
            repo: repoName,
            title: newPrTitle,
            body: newPrBody,
            head: branchName,
            base: "master",
          });
          newPrUrl = pr.html_url;
        } catch {
          await cleanup(tmpDir);
          return NextResponse.json(
            {
              success: false,
              message: "Failed to create PR",
              error: `GitHub API error: ${errorMessage}`,
            },
            { status: 500 }
          );
        }
      }

      // Clean up
      await cleanup(tmpDir);

      console.log(`PR created: ${newPrUrl}`);
      return NextResponse.json({
        success: true,
        message: `PR recreated with ${prCommits.length} commits from original PR #${prNumber}`,
        prUrl: newPrUrl,
        forkUrl,
        commitCount: prCommits.length,
        originalPrNumber: prNumber,
      });

    } else if (repoUrl) {
      // ========================================
      // COMMIT MODE - Existing logic
      // ========================================

      // Parse the upstream GitHub URL to get owner and repo
      const parsed = parseGitHubUrl(repoUrl);
      if (!parsed) {
        return NextResponse.json(
          {
            success: false,
            message: "Invalid GitHub URL format",
            error: "Expected format: https://github.com/owner/repo-name",
          },
          { status: 400 }
        );
      }

      const { owner: upstreamOwner, repo: repoName } = parsed;

      // Ensure fork exists
      console.log("Checking if fork exists...");
      let forkUrl: string;
      try {
        const result = await ensureFork(octokit, forkOwner, upstreamOwner, repoName);
        forkUrl = result.forkUrl;
      } catch (forkError) {
        return NextResponse.json(
          {
            success: false,
            message: "Failed to create fork",
            error: forkError instanceof Error ? forkError.message : String(forkError),
          },
          { status: 404 }
        );
      }

      // Disable GitHub Actions on the fork to prevent unnecessary workflow runs
      console.log("Disabling GitHub Actions on fork...");
      try {
        await octokit.actions.setGithubActionsPermissionsRepository({
          owner: forkOwner,
          repo: repoName,
          enabled: false,
        });
        console.log("GitHub Actions disabled - only Macroscope will run");
      } catch (actionsError) {
        // Non-critical error - continue anyway
        console.log(`Note: Could not disable Actions (continuing anyway): ${actionsError instanceof Error ? actionsError.message : String(actionsError)}`);
      }

      // Get the target commit (either specified or latest from main)
      let targetCommit: string;
      console.log("Getting target commit...");

      if (specifiedCommitHash) {
        targetCommit = specifiedCommitHash;
        console.log(`Using specified commit: ${targetCommit}`);
        try {
          await octokit.repos.getCommit({
            owner: forkOwner,
            repo: repoName,
            ref: targetCommit,
          });
        } catch {
          try {
            await octokit.repos.getCommit({
              owner: upstreamOwner,
              repo: repoName,
              ref: targetCommit,
            });
          } catch {
            return NextResponse.json(
              {
                success: false,
                message: "Commit not found",
                error: `The commit ${targetCommit} does not exist in the repository`,
              },
              { status: 404 }
            );
          }
        }
      } else {
        console.log("Getting latest commit from main branch...");
        try {
          const { data: branch } = await octokit.repos.getBranch({
            owner: forkOwner,
            repo: repoName,
            branch: "main",
          });
          targetCommit = branch.commit.sha;
          console.log(`Latest commit on main: ${targetCommit}`);
        } catch {
          try {
            const { data: branch } = await octokit.repos.getBranch({
              owner: forkOwner,
              repo: repoName,
              branch: "master",
            });
            targetCommit = branch.commit.sha;
            console.log(`Latest commit on master: ${targetCommit}`);
          } catch {
            return NextResponse.json(
              {
                success: false,
                message: "Could not find main or master branch",
                error: "Unable to determine the default branch of the repository",
              },
              { status: 404 }
            );
          }
        }
      }

      // Detect commit type and get commit details
      console.log("Detecting commit type...");
      let parentCommit: string;
      let isMergeCommit = false;
      let commitMessage: string;
      let prCommits: PrCommitInfo[] = [];
      let originalPrNumber: number | null = null;

      // Get commit details (try fork first, then upstream)
      let commitData;
      try {
        const response = await octokit.repos.getCommit({
          owner: forkOwner,
          repo: repoName,
          ref: targetCommit,
        });
        commitData = response.data;
      } catch {
        try {
          const response = await octokit.repos.getCommit({
            owner: upstreamOwner,
            repo: repoName,
            ref: targetCommit,
          });
          commitData = response.data;
        } catch {
          return NextResponse.json(
            {
              success: false,
              message: "Could not get commit details",
              error: `Unable to fetch details for commit ${targetCommit}`,
            },
            { status: 500 }
          );
        }
      }

      if (!commitData.parents || commitData.parents.length === 0) {
        return NextResponse.json(
          {
            success: false,
            message: "Commit has no parent",
            error: "The target commit appears to be the initial commit and has no parent",
          },
          { status: 400 }
        );
      }

      parentCommit = commitData.parents[0].sha;
      isMergeCommit = commitData.parents.length > 1;
      commitMessage = commitData.commit.message.split("\n")[0];

      // If merge commit, try to find associated PR and get all commits
      if (isMergeCommit) {
        console.log("Found merge commit, looking for associated PR...");

        try {
          const { data: prs } = await octokit.repos.listPullRequestsAssociatedWithCommit({
            owner: upstreamOwner,
            repo: repoName,
            commit_sha: targetCommit,
          });

          if (prs.length > 0) {
            const mergedPr = prs.find(pr => pr.merge_commit_sha === targetCommit) || prs[0];
            originalPrNumber = mergedPr.number;
            console.log(`Found associated PR #${originalPrNumber}`);

            const { data: prCommitsList } = await octokit.pulls.listCommits({
              owner: upstreamOwner,
              repo: repoName,
              pull_number: originalPrNumber,
              per_page: 100,
            });

            if (prCommitsList.length > 0) {
              prCommits = prCommitsList.map(c => ({
                sha: c.sha,
                message: c.commit.message.split("\n")[0],
              }));

              const firstCommitSha = prCommits[0].sha;
              try {
                const { data: firstCommitData } = await octokit.repos.getCommit({
                  owner: upstreamOwner,
                  repo: repoName,
                  ref: firstCommitSha,
                });
                if (firstCommitData.parents && firstCommitData.parents.length > 0) {
                  parentCommit = firstCommitData.parents[0].sha;
                }
              } catch {
                // Keep the original parent commit
              }

              console.log(`Including ${prCommits.length} commits from PR #${originalPrNumber}`);
            }
          } else {
            console.log("No associated PR found, using single merge commit");
          }
        } catch (prError) {
          console.log(`PR detection failed: ${prError instanceof Error ? prError.message : String(prError)}`);
          console.log("Falling back to single commit mode");
        }
      } else {
        console.log("Single commit detected");
      }

      const shortHash = getShortHash(targetCommit);
      const branchName = `review-${shortHash}`;

      // Check if a PR already exists for this branch
      console.log("Checking for existing PR...");
      try {
        const { data: existingPRs } = await octokit.pulls.list({
          owner: forkOwner,
          repo: repoName,
          state: "open",
          head: `${forkOwner}:${branchName}`,
        });

        if (existingPRs.length > 0) {
          return NextResponse.json({
            success: true,
            message: `A PR already exists for this commit`,
            prUrl: existingPRs[0].html_url,
            commitHash: targetCommit,
            forkUrl,
            commitCount: prCommits.length || 1,
            originalPrNumber: originalPrNumber || undefined,
          });
        }
      } catch {
        // Continue if we can't check
      }

      // Clone the fork repository
      console.log("Cloning fork...");
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "macroscope-"));

      const cloneUrl = `https://x-access-token:${githubToken}@github.com/${forkOwner}/${repoName}.git`;

      const git: SimpleGit = simpleGit();
      await git.clone(cloneUrl, tmpDir, ["--no-single-branch"]);

      const repoGit = simpleGit(tmpDir);

      await repoGit.addConfig("user.email", "macroscope-pr-creator@example.com");
      await repoGit.addConfig("user.name", "Macroscope PR Creator");

      const upstreamCloneUrl = `https://github.com/${upstreamOwner}/${repoName}.git`;
      await repoGit.addRemote("upstream", upstreamCloneUrl);

      console.log("Fetching commits...");
      await repoGit.fetch(["--all"]);

      // Create a new branch from the parent commit
      console.log("Creating review branch...");
      try {
        await repoGit.checkout(["-b", branchName, parentCommit]);
      } catch {
        try {
          await repoGit.checkout([branchName]);
          await repoGit.reset(["--hard", parentCommit]);
        } catch {
          await cleanup(tmpDir);
          return NextResponse.json(
            {
              success: false,
              message: "Failed to create review branch",
              error: `Could not create branch ${branchName} from parent commit ${parentCommit}`,
            },
            { status: 500 }
          );
        }
      }

      // Cherry-pick commits
      if (prCommits.length > 1) {
        console.log(`Cherry-picking ${prCommits.length} commits from PR...`);

        for (let i = 0; i < prCommits.length; i++) {
          const commit = prCommits[i];
          console.log(`Cherry-picking commit ${i + 1}/${prCommits.length}: ${commit.sha.substring(0, 7)}`);

          try {
            await repoGit.raw(["cherry-pick", commit.sha]);
          } catch (cherryPickError) {
            try {
              await repoGit.raw(["cherry-pick", "--abort"]);
            } catch {
              // Ignore abort errors
            }

            await cleanup(tmpDir);
            return NextResponse.json(
              {
                success: false,
                message: "Cherry-pick failed",
                error: `Failed to cherry-pick commit ${commit.sha.substring(0, 7)} (${i + 1}/${prCommits.length}). Error: ${
                  cherryPickError instanceof Error
                    ? cherryPickError.message
                    : String(cherryPickError)
                }`,
              },
              { status: 409 }
            );
          }
        }
      } else {
        console.log("Cherry-picking commit...");
        try {
          if (isMergeCommit) {
            await repoGit.raw(["cherry-pick", "-m", "1", targetCommit]);
          } else {
            await repoGit.raw(["cherry-pick", targetCommit]);
          }
        } catch (cherryPickError) {
          try {
            await repoGit.raw(["cherry-pick", "--abort"]);
          } catch {
            // Ignore abort errors
          }

          await cleanup(tmpDir);
          return NextResponse.json(
            {
              success: false,
              message: "Cherry-pick failed",
              error: `Merge conflict or other error during cherry-pick. Error: ${
                cherryPickError instanceof Error
                  ? cherryPickError.message
                  : String(cherryPickError)
              }`,
            },
            { status: 409 }
          );
        }
      }

      // Push the new branch to the fork
      console.log("Pushing branch...");
      try {
        await repoGit.push(["origin", branchName, "--force"]);
      } catch (pushError) {
        await cleanup(tmpDir);
        return NextResponse.json(
          {
            success: false,
            message: "Failed to push branch",
            error: `Could not push branch to repository. Make sure your token has push access. Error: ${
              pushError instanceof Error ? pushError.message : String(pushError)
            }`,
          },
          { status: 500 }
        );
      }

      // Create the Pull Request
      console.log("Creating pull request...");

      let prBody: string;
      let prTitle: string;

      if (prCommits.length > 1 && originalPrNumber) {
        prTitle = commitMessage;
        prBody = `Recreated from PR #${originalPrNumber} for Macroscope review.

**Includes ${prCommits.length} commits from the original PR:**
${prCommits.map(c => `- \`${c.sha.substring(0, 7)}\`: ${c.message}`).join("\n")}

**Original upstream:** https://github.com/${upstreamOwner}/${repoName}/pull/${originalPrNumber}`;
      } else {
        prTitle = commitMessage;
        prBody = `Recreated from commit \`${shortHash}\` for Macroscope review.

**Original commit:** ${targetCommit}
**Parent commit:** ${parentCommit}
**Original upstream:** https://github.com/${upstreamOwner}/${repoName}
${isMergeCommit ? "\n**Note:** This was a merge commit, cherry-picked with `-m 1`." : ""}`;
      }

      let prUrl: string;
      try {
        const { data: pr } = await octokit.pulls.create({
          owner: forkOwner,
          repo: repoName,
          title: prTitle,
          body: prBody,
          head: branchName,
          base: "main",
        });

        prUrl = pr.html_url;
      } catch (prError) {
        const errorMessage =
          prError instanceof Error ? prError.message : String(prError);

        if (errorMessage.includes("A pull request already exists")) {
          const { data: existingPRs } = await octokit.pulls.list({
            owner: forkOwner,
            repo: repoName,
            state: "open",
            head: `${forkOwner}:${branchName}`,
          });

          if (existingPRs.length > 0) {
            await cleanup(tmpDir);
            return NextResponse.json({
              success: true,
              message: "A PR already exists for this commit",
              prUrl: existingPRs[0].html_url,
              commitHash: targetCommit,
              forkUrl,
              commitCount: prCommits.length || 1,
              originalPrNumber: originalPrNumber || undefined,
            });
          }
        }

        // Try with master as base if main failed
        try {
          const { data: pr } = await octokit.pulls.create({
            owner: forkOwner,
            repo: repoName,
            title: prTitle,
            body: prBody,
            head: branchName,
            base: "master",
          });

          prUrl = pr.html_url;
        } catch {
          await cleanup(tmpDir);
          return NextResponse.json(
            {
              success: false,
              message: "Failed to create PR",
              error: `GitHub API error: ${errorMessage}`,
            },
            { status: 500 }
          );
        }
      }

      // Clean up
      await cleanup(tmpDir);

      // Build success message
      let successMessage: string;
      if (prCommits.length > 1 && originalPrNumber) {
        successMessage = `PR created with ${prCommits.length} commits from original PR #${originalPrNumber}`;
      } else {
        successMessage = `PR created successfully in your fork at ${forkOwner}/${repoName}`;
      }

      console.log(`PR created: ${prUrl}`);
      return NextResponse.json({
        success: true,
        message: successMessage,
        prUrl,
        commitHash: targetCommit,
        forkUrl,
        commitCount: prCommits.length || 1,
        originalPrNumber: originalPrNumber || undefined,
      });

    } else {
      // No input provided
      return NextResponse.json(
        {
          success: false,
          message: "Missing required fields",
          error: "Either repoUrl or prUrl is required",
        },
        { status: 400 }
      );
    }
  } catch (error) {
    if (tmpDir) {
      await cleanup(tmpDir);
    }

    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";

    console.error("Unexpected error:", errorMessage);
    return NextResponse.json(
      {
        success: false,
        message: "An unexpected error occurred",
        error: errorMessage,
      },
      { status: 500 }
    );
  }
}
