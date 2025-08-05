export async function POST(request: Request) {
  try {
    const { githubToken, repoUrl, message, files } = await request.json();

    if (!githubToken || !repoUrl || !message) {
      return new Response(
        JSON.stringify({ error: "Missing required parameters" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    if (!files || !Array.isArray(files) || files.length === 0) {
      return new Response(JSON.stringify({ error: "No files to commit" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Extract repo info from URL
    const match = repoUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);
    if (!match) {
      return new Response(
        JSON.stringify({ error: "Invalid GitHub repository URL" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const [, owner, repo] = match;
    const cleanRepoName = repo.replace(".git", "");

    // For a real implementation, this would:
    // 1. Get the current state of all changed files from WebContainer
    // 2. Create a new commit with the changes via GitHub API
    // 3. Update the repository

    try {
      // Get the repository information
      const repoResponse = await fetch(
        `https://api.github.com/repos/${owner}/${cleanRepoName}`,
        {
          headers: {
            Authorization: `Bearer ${githubToken}`,
            Accept: "application/vnd.github.v3+json",
            "User-Agent": "BaseBase-Editor",
          },
        }
      );

      if (!repoResponse.ok) {
        if (repoResponse.status === 404) {
          throw new Error("Repository not found or access denied");
        }
        throw new Error(`GitHub API error: ${repoResponse.status}`);
      }

      const repoData = await repoResponse.json();
      const defaultBranch = repoData.default_branch;

      console.log(
        `Committing to ${owner}/${cleanRepoName} on branch ${defaultBranch} with message: "${message}"`
      );
      console.log(
        `Files to commit (${files.length}):`,
        files.map((f: any) => `${f.path} (${f.status})`)
      );

      // Step 1: Get the latest commit SHA
      const branchResponse = await fetch(
        `https://api.github.com/repos/${owner}/${cleanRepoName}/git/refs/heads/${defaultBranch}`,
        {
          headers: {
            Authorization: `Bearer ${githubToken}`,
            Accept: "application/vnd.github.v3+json",
            "User-Agent": "BaseBase-Editor",
          },
        }
      );

      if (!branchResponse.ok) {
        throw new Error(`Failed to get branch info: ${branchResponse.status}`);
      }

      const branchData = await branchResponse.json();
      const latestCommitSha = branchData.object.sha;

      // Step 2: Get the current tree SHA
      const commitResponse = await fetch(
        `https://api.github.com/repos/${owner}/${cleanRepoName}/git/commits/${latestCommitSha}`,
        {
          headers: {
            Authorization: `Bearer ${githubToken}`,
            Accept: "application/vnd.github.v3+json",
            "User-Agent": "BaseBase-Editor",
          },
        }
      );

      if (!commitResponse.ok) {
        throw new Error(`Failed to get commit info: ${commitResponse.status}`);
      }

      const commitData = await commitResponse.json();
      const baseTreeSha = commitData.tree.sha;

      // Step 3: Create blobs for changed files and prepare tree entries
      const treeEntries = [];

      for (const file of files) {
        if (file.status === "deleted") {
          // For deleted files, we don't include them in the tree
          continue;
        }

        if (file.content === null) {
          console.warn(`Skipping file ${file.path} - no content provided`);
          continue;
        }

        // Create a blob for the file content
        const blobResponse = await fetch(
          `https://api.github.com/repos/${owner}/${cleanRepoName}/git/blobs`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${githubToken}`,
              Accept: "application/vnd.github.v3+json",
              "User-Agent": "BaseBase-Editor",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              content: file.content,
              encoding: "utf-8",
            }),
          }
        );

        if (!blobResponse.ok) {
          throw new Error(
            `Failed to create blob for ${file.path}: ${blobResponse.status}`
          );
        }

        const blobData = await blobResponse.json();

        treeEntries.push({
          path: file.path,
          mode: "100644", // Regular file mode
          type: "blob",
          sha: blobData.sha,
        });
      }

      // Step 4: Create a new tree
      const treeResponse = await fetch(
        `https://api.github.com/repos/${owner}/${cleanRepoName}/git/trees`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${githubToken}`,
            Accept: "application/vnd.github.v3+json",
            "User-Agent": "BaseBase-Editor",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            base_tree: baseTreeSha,
            tree: treeEntries,
          }),
        }
      );

      if (!treeResponse.ok) {
        throw new Error(`Failed to create tree: ${treeResponse.status}`);
      }

      const treeData = await treeResponse.json();

      // Step 5: Create a new commit
      const newCommitResponse = await fetch(
        `https://api.github.com/repos/${owner}/${cleanRepoName}/git/commits`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${githubToken}`,
            Accept: "application/vnd.github.v3+json",
            "User-Agent": "BaseBase-Editor",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message: message,
            tree: treeData.sha,
            parents: [latestCommitSha],
          }),
        }
      );

      if (!newCommitResponse.ok) {
        throw new Error(`Failed to create commit: ${newCommitResponse.status}`);
      }

      const newCommitData = await newCommitResponse.json();

      // Step 6: Update the branch reference
      const updateRefResponse = await fetch(
        `https://api.github.com/repos/${owner}/${cleanRepoName}/git/refs/heads/${defaultBranch}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${githubToken}`,
            Accept: "application/vnd.github.v3+json",
            "User-Agent": "BaseBase-Editor",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            sha: newCommitData.sha,
          }),
        }
      );

      if (!updateRefResponse.ok) {
        throw new Error(`Failed to update branch: ${updateRefResponse.status}`);
      }

      console.log(
        `Successfully committed ${newCommitData.sha} to ${owner}/${cleanRepoName}`
      );

      return new Response(
        JSON.stringify({
          success: true,
          commitSha: newCommitData.sha,
          commitUrl: newCommitData.html_url,
          message: "Changes committed successfully to GitHub",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    } catch (apiError) {
      console.error("GitHub API error:", apiError);
      throw new Error(
        apiError instanceof Error
          ? apiError.message
          : "Failed to access GitHub API"
      );
    }
  } catch (error) {
    console.error("Git commit error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Internal server error",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
