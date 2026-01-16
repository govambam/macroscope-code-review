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
}

// Parse GitHub URL to extract owner and repo name
// Example: https://github.com/getsentry/sentry-python -> { owner: "getsentry", repo: "sentry-python" }
function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
  const match = url.match(/^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/?$/);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
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
    const { repoUrl, commitHash: specifiedCommitHash } = body;

    // Validate required fields
    if (!repoUrl) {
      return NextResponse.json(
        {
          success: false,
          message: "Missing required fields",
          error: "repoUrl is required",
        },
        { status: 400 }
      );
    }

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

    // Initialize Octokit with the GitHub token
    const octokit = new Octokit({ auth: githubToken });

    // Step 1: Get the authenticated user (owner of the fork)
    console.log("Getting authenticated user...");
    const { data: authenticatedUser } = await octokit.users.getAuthenticated();
    const forkOwner = authenticatedUser.login;
    console.log(`Authenticated as: ${forkOwner}`);

    // Step 2: Check if fork already exists, create if not
    console.log("Checking if fork exists...");
    let forkExists = false;
    try {
      await octokit.repos.get({
        owner: forkOwner,
        repo: repoName,
      });
      forkExists = true;
      console.log("Fork already exists, using existing fork");
    } catch {
      // Fork doesn't exist, need to create it
      console.log("Fork doesn't exist, creating fork...");
    }

    if (!forkExists) {
      try {
        // Verify the upstream repo exists first
        await octokit.repos.get({
          owner: upstreamOwner,
          repo: repoName,
        });
      } catch {
        return NextResponse.json(
          {
            success: false,
            message: "Upstream repository not found",
            error: `The repository ${upstreamOwner}/${repoName} does not exist or is not accessible`,
          },
          { status: 404 }
        );
      }

      // Create the fork
      await octokit.repos.createFork({
        owner: upstreamOwner,
        repo: repoName,
      });
      console.log("Fork created, waiting for it to be ready...");

      // Wait for the fork to be ready (GitHub needs time to complete the fork)
      await wait(3000);
    }

    const forkUrl = `https://github.com/${forkOwner}/${repoName}`;

    // Step 3: Get the target commit (either specified or latest from main)
    let targetCommit: string;
    console.log("Getting target commit...");

    if (specifiedCommitHash) {
      // User specified a commit hash, verify it exists
      targetCommit = specifiedCommitHash;
      console.log(`Using specified commit: ${targetCommit}`);
      try {
        await octokit.repos.getCommit({
          owner: forkOwner,
          repo: repoName,
          ref: targetCommit,
        });
      } catch {
        // If not found in fork, try upstream (fork might not have synced yet)
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
      // Get the latest commit from main branch
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
        // Try master branch if main doesn't exist
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

    // Step 4: Get the parent commit automatically via GitHub API
    console.log("Finding parent commit...");
    let parentCommit: string;
    let isMergeCommit = false;
    let commitMessage: string;

    try {
      // First try to get commit from fork
      const { data: commitData } = await octokit.repos.getCommit({
        owner: forkOwner,
        repo: repoName,
        ref: targetCommit,
      });

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
      commitMessage = commitData.commit.message.split("\n")[0]; // First line only
      console.log(`Parent commit: ${parentCommit}`);
      console.log(`Is merge commit: ${isMergeCommit}`);
    } catch {
      // If not in fork, try upstream
      try {
        const { data: commitData } = await octokit.repos.getCommit({
          owner: upstreamOwner,
          repo: repoName,
          ref: targetCommit,
        });

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
        console.log(`Parent commit (from upstream): ${parentCommit}`);
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

    const shortHash = getShortHash(targetCommit);
    const branchName = `review-${shortHash}`;

    // Step 5: Check if a PR already exists for this branch
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
        });
      }
    } catch {
      // If we can't check for existing PRs, continue anyway
    }

    // Step 6: Clone the fork repository
    console.log("Cloning fork...");
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "macroscope-"));

    // Construct the authenticated clone URL for the FORK
    const cloneUrl = `https://x-access-token:${githubToken}@github.com/${forkOwner}/${repoName}.git`;

    const git: SimpleGit = simpleGit();
    await git.clone(cloneUrl, tmpDir, ["--no-single-branch"]);

    const repoGit = simpleGit(tmpDir);

    // Configure git user for commits (required for cherry-pick)
    await repoGit.addConfig("user.email", "macroscope-pr-creator@example.com");
    await repoGit.addConfig("user.name", "Macroscope PR Creator");

    // Add upstream remote to fetch the commit if needed
    const upstreamCloneUrl = `https://github.com/${upstreamOwner}/${repoName}.git`;
    await repoGit.addRemote("upstream", upstreamCloneUrl);

    // Fetch from both origin and upstream to ensure we have all commits
    console.log("Fetching commits...");
    await repoGit.fetch(["--all"]);

    // Step 7: Create a new branch from the parent commit
    console.log("Creating review branch...");
    try {
      await repoGit.checkout(["-b", branchName, parentCommit]);
    } catch {
      // Branch might already exist locally, try to check it out and reset
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

    // Step 8: Cherry-pick the target commit
    console.log("Cherry-picking commit...");
    try {
      if (isMergeCommit) {
        // For merge commits, use -m 1 to pick the first parent's changes
        await repoGit.raw(["cherry-pick", "-m", "1", targetCommit]);
      } else {
        await repoGit.raw(["cherry-pick", targetCommit]);
      }
    } catch (cherryPickError) {
      // Cherry-pick failed, likely due to merge conflicts
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

    // Step 9: Push the new branch to the fork
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

    // Step 10: Create the Pull Request within the fork
    // CRITICAL: The PR is created WITHIN the fork:
    // - owner: The fork owner (authenticated user)
    // - repo: The fork repo name
    // - base: "main" - the base branch in the FORK
    // - head: the review branch we just pushed
    // This ensures the PR targets the fork itself, NOT the upstream repository
    console.log("Creating pull request...");
    let prUrl: string;
    try {
      const { data: pr } = await octokit.pulls.create({
        owner: forkOwner,
        repo: repoName,
        title: commitMessage,
        body: `Recreated from commit \`${shortHash}\` for Macroscope review.

**Original commit:** ${targetCommit}
**Parent commit:** ${parentCommit}
**Original upstream:** https://github.com/${upstreamOwner}/${repoName}
${isMergeCommit ? "\n**Note:** This was a merge commit, cherry-picked with `-m 1`." : ""}`,
        head: branchName,
        base: "main",
      });

      prUrl = pr.html_url;
    } catch (prError) {
      const errorMessage =
        prError instanceof Error ? prError.message : String(prError);

      // Check if error is because PR already exists
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
          });
        }
      }

      // Try with master as base if main failed
      try {
        const { data: pr } = await octokit.pulls.create({
          owner: forkOwner,
          repo: repoName,
          title: commitMessage,
          body: `Recreated from commit \`${shortHash}\` for Macroscope review.

**Original commit:** ${targetCommit}
**Parent commit:** ${parentCommit}
**Original upstream:** https://github.com/${upstreamOwner}/${repoName}
${isMergeCommit ? "\n**Note:** This was a merge commit, cherry-picked with `-m 1`." : ""}`,
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

    // Clean up the temporary directory
    await cleanup(tmpDir);

    // Return success response
    console.log(`PR created: ${prUrl}`);
    return NextResponse.json({
      success: true,
      message: `PR created successfully in your fork at ${forkOwner}/${repoName}`,
      prUrl,
      commitHash: targetCommit,
      forkUrl,
    });
  } catch (error) {
    // Clean up on any unexpected error
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
