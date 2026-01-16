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
  error?: string;
}

// Parse GitHub URL to extract owner and repo name
// Example: https://github.com/govambam/planetscale-cli -> { owner: "govambam", repo: "planetscale-cli" }
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
    const { repoUrl, commitHash, parentCommitHash } = body;

    // Validate required fields
    if (!repoUrl || !commitHash || !parentCommitHash) {
      return NextResponse.json(
        {
          success: false,
          message: "Missing required fields",
          error: "repoUrl, commitHash, and parentCommitHash are all required",
        },
        { status: 400 }
      );
    }

    // Parse the GitHub URL to get owner and repo
    // CRITICAL: This extracts the FORK owner and repo, NOT the upstream
    const parsed = parseGitHubUrl(repoUrl);
    if (!parsed) {
      return NextResponse.json(
        {
          success: false,
          message: "Invalid GitHub URL format",
          error: "Expected format: https://github.com/username/repo-name",
        },
        { status: 400 }
      );
    }

    const { owner, repo } = parsed;
    const shortHash = getShortHash(commitHash);
    const branchName = `review-${shortHash}`;

    // Initialize Octokit with the GitHub token
    const octokit = new Octokit({ auth: githubToken });

    // Check if a PR already exists for this branch
    // We check if the branch already has an open PR in the FORK repository
    try {
      const { data: existingPRs } = await octokit.pulls.list({
        owner,
        repo,
        state: "open",
        head: `${owner}:${branchName}`,
      });

      if (existingPRs.length > 0) {
        return NextResponse.json({
          success: true,
          message: `A PR already exists for this commit`,
          prUrl: existingPRs[0].html_url,
          commitHash,
        });
      }
    } catch {
      // If we can't check for existing PRs, continue anyway
    }

    // Create temporary directory for cloning
    // On Vercel, we use /tmp which is the writable temp directory
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "macroscope-"));

    // Construct the authenticated clone URL
    // This ensures we can push back to the fork
    const cloneUrl = `https://${githubToken}@github.com/${owner}/${repo}.git`;

    // Initialize simple-git for the temp directory
    const git: SimpleGit = simpleGit();

    // Clone the FORKED repository (NOT the upstream)
    // We only need a shallow clone with enough history to find both commits
    await git.clone(cloneUrl, tmpDir, ["--no-single-branch"]);

    // Change to the cloned directory
    const repoGit = simpleGit(tmpDir);

    // Configure git user for commits (required for cherry-pick)
    await repoGit.addConfig("user.email", "macroscope-pr-creator@example.com");
    await repoGit.addConfig("user.name", "Macroscope PR Creator");

    // Fetch all refs to ensure we have the commits
    await repoGit.fetch(["--all"]);

    // Verify the parent commit exists
    try {
      await repoGit.revparse([parentCommitHash]);
    } catch {
      await cleanup(tmpDir);
      return NextResponse.json(
        {
          success: false,
          message: "Parent commit not found",
          error: `The parent commit ${parentCommitHash} does not exist in the repository`,
        },
        { status: 400 }
      );
    }

    // Verify the target commit exists
    try {
      await repoGit.revparse([commitHash]);
    } catch {
      await cleanup(tmpDir);
      return NextResponse.json(
        {
          success: false,
          message: "Commit not found",
          error: `The commit ${commitHash} does not exist in the repository`,
        },
        { status: 400 }
      );
    }

    // Get the original commit message for the PR title
    const commitMessage = await repoGit.raw([
      "log",
      "-1",
      "--format=%s",
      commitHash,
    ]);
    const prTitle = commitMessage.trim();

    // Create a new branch from the parent commit
    // Branch name format: review-{short-commit-hash}
    try {
      await repoGit.checkout(["-b", branchName, parentCommitHash]);
    } catch {
      // Branch might already exist locally, try to check it out
      try {
        await repoGit.checkout([branchName]);
        await repoGit.reset(["--hard", parentCommitHash]);
      } catch {
        await cleanup(tmpDir);
        return NextResponse.json(
          {
            success: false,
            message: "Failed to create review branch",
            error: `Could not create branch ${branchName} from parent commit`,
          },
          { status: 500 }
        );
      }
    }

    // Check if the target commit is a merge commit
    const parents = await repoGit.raw([
      "rev-list",
      "--parents",
      "-n",
      "1",
      commitHash,
    ]);
    const parentCount = parents.trim().split(" ").length - 1; // Subtract 1 for the commit itself
    const isMergeCommit = parentCount > 1;

    // Cherry-pick the target commit onto the new branch
    // If it's a merge commit, use -m 1 to pick the first parent's changes
    try {
      if (isMergeCommit) {
        await repoGit.raw(["cherry-pick", "-m", "1", commitHash]);
      } else {
        await repoGit.raw(["cherry-pick", commitHash]);
      }
    } catch (cherryPickError) {
      // Cherry-pick failed, likely due to merge conflicts
      // Abort the cherry-pick and return an error
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

    // Push the new branch to the FORK repository
    // CRITICAL: We push to origin which is the FORK, not upstream
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

    // Create the Pull Request using GitHub API
    // CRITICAL: The PR is created WITHIN the fork:
    // - owner: The fork owner (e.g., "govambam")
    // - repo: The fork repo name (e.g., "planetscale-cli")
    // - base: "main" - the base branch in the FORK
    // - head: the review branch we just pushed
    // This ensures the PR targets the fork itself, NOT the upstream repository
    let prUrl: string;
    try {
      const { data: pr } = await octokit.pulls.create({
        owner, // Fork owner - NOT upstream
        repo, // Fork repo - NOT upstream
        title: prTitle,
        body: `Recreated from commit \`${commitHash}\` for Macroscope review.

This PR was automatically created to facilitate code review via Macroscope.

**Original commit:** ${commitHash}
**Parent commit:** ${parentCommitHash}
${isMergeCommit ? "\n**Note:** This was a merge commit, cherry-picked with `-m 1`." : ""}`,
        head: branchName, // The branch we just pushed
        base: "main", // Base branch in the FORK (not upstream)
      });

      prUrl = pr.html_url;
    } catch (prError) {
      // Check if error is because PR already exists
      const errorMessage =
        prError instanceof Error ? prError.message : String(prError);

      if (errorMessage.includes("A pull request already exists")) {
        // Fetch the existing PR
        const { data: existingPRs } = await octokit.pulls.list({
          owner,
          repo,
          state: "open",
          head: `${owner}:${branchName}`,
        });

        if (existingPRs.length > 0) {
          await cleanup(tmpDir);
          return NextResponse.json({
            success: true,
            message: "A PR already exists for this commit",
            prUrl: existingPRs[0].html_url,
            commitHash,
          });
        }
      }

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

    // Clean up the temporary directory
    await cleanup(tmpDir);

    // Return success response
    return NextResponse.json({
      success: true,
      message: `PR created successfully in YOUR fork at ${owner}/${repo}`,
      prUrl,
      commitHash,
    });
  } catch (error) {
    // Clean up on any unexpected error
    if (tmpDir) {
      await cleanup(tmpDir);
    }

    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";

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
