#!/usr/bin/env node

/**
 * Test Container Creation
 *
 * This script tests the Railway container deployment process step by step.
 * Usage: node scripts/test-container-creation.js <github-repo-url> [github-token]
 */

const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));
const readline = require("readline");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";

function log(message, type = "info") {
  const timestamp = new Date().toISOString();
  const prefix =
    {
      info: "📝",
      success: "✅",
      error: "❌",
      warning: "⚠️",
      step: "🔄",
    }[type] || "📝";

  console.log(`${timestamp} ${prefix} ${message}`);
}

async function prompt(question) {
  return new Promise((resolve) => {
    rl.question(question, resolve);
  });
}

async function testContainerCreation(
  repoUrl,
  githubToken,
  userId = "test-user"
) {
  log(`Starting container creation test for: ${repoUrl}`, "step");
  log(`Using userId: ${userId}`, "info");

  try {
    // Extract project ID from repo URL
    const repoMatch = repoUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);
    if (!repoMatch) {
      throw new Error("Invalid GitHub repository URL");
    }

    const [, owner, repo] = repoMatch;
    const projectId = `${owner}-${repo.replace(".git", "")}`;

    log(`Project ID: ${projectId}`, "info");

    // Step 1: Deploy container
    log("Step 1: Deploying container to Railway...", "step");

    const deployResponse = await fetch(`${BASE_URL}/api/railway/deploy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        repoUrl,
        projectId,
        userId,
        githubToken: githubToken || undefined,
      }),
    });

    if (!deployResponse.ok) {
      const errorData = await deployResponse.json();
      throw new Error(`Deploy failed: ${errorData.error}`);
    }

    const deployData = await deployResponse.json();
    log(
      `Container deployed! Service ID: ${deployData.deployment.serviceId}`,
      "success"
    );
    log(`Deployment ID: ${deployData.deployment.deploymentId}`, "info");

    // Step 2: Poll for deployment status
    log("Step 2: Waiting for container to be ready...", "step");

    let attempts = 0;
    const maxAttempts = 30; // 5 minutes
    let deployment = deployData.deployment;

    while (attempts < maxAttempts && deployment.status !== "SUCCESS") {
      await new Promise((resolve) => setTimeout(resolve, 10000)); // Wait 10 seconds

      const queryParams = new URLSearchParams({ projectId });
      if (userId) {
        queryParams.set("userId", userId);
      }
      const statusResponse = await fetch(
        `${BASE_URL}/api/railway/deploy?${queryParams}`
      );
      if (statusResponse.ok) {
        const statusData = await statusResponse.json();
        if (statusData.service?.deployment) {
          deployment = {
            ...deployment,
            status: statusData.service.deployment.status,
            url: statusData.service.deployment.url,
          };

          log(`Status: ${deployment.status}`, "info");

          if (deployment.status === "FAILED") {
            throw new Error("Container deployment failed");
          }
        }
      }

      attempts++;
    }

    if (deployment.status !== "SUCCESS") {
      throw new Error("Deployment timeout - container did not become ready");
    }

    log(`Container is ready! URL: ${deployment.url}`, "success");

    // Step 3: Test container API
    log("Step 3: Testing container API...", "step");

    // Wait a bit more for the container API to be ready
    await new Promise((resolve) => setTimeout(resolve, 15000));

    const apiTestResponse = await fetch(`${deployment.url}/api/tools`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "checkStatus",
        params: {},
      }),
    });

    if (!apiTestResponse.ok) {
      log(
        `Container API not ready yet (${apiTestResponse.status}). This is normal for new deployments.`,
        "warning"
      );
    } else {
      const apiData = await apiTestResponse.json();
      log(`Container API is responding: ${JSON.stringify(apiData)}`, "success");
    }

    // Return deployment info for further testing
    return {
      projectId,
      userId,
      fullServiceName: `${userId}-${projectId}`,
      deployment,
      success: true,
    };
  } catch (error) {
    log(`Container creation failed: ${error.message}`, "error");
    return {
      success: false,
      error: error.message,
    };
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log(
      "Usage: node scripts/test-container-creation.js <github-repo-url> [github-token] [user-id]"
    );
    console.log("");
    console.log("Examples:");
    console.log(
      "  node scripts/test-container-creation.js https://github.com/vercel/next.js"
    );
    console.log(
      "  node scripts/test-container-creation.js https://github.com/user/private-repo gh_token_here"
    );
    console.log(
      "  node scripts/test-container-creation.js https://github.com/vercel/next.js '' frank"
    );
    process.exit(1);
  }

  const repoUrl = args[0];
  let githubToken = args[1];
  let userId =
    args[2] || `test-user-${Math.random().toString(36).substring(2, 6)}`;

  // If no token provided and repo might be private, ask for it
  if (!githubToken && repoUrl.includes("github.com")) {
    const needsToken = await prompt("Is this a private repository? (y/N): ");
    if (
      needsToken.toLowerCase() === "y" ||
      needsToken.toLowerCase() === "yes"
    ) {
      githubToken = await prompt("Enter GitHub token: ");
    }
  }

  log("🚀 Railway Container Creation Test Starting...", "step");
  log(`Base URL: ${BASE_URL}`, "info");
  log(`User ID: ${userId}`, "info");

  const result = await testContainerCreation(repoUrl, githubToken, userId);

  if (result.success) {
    log("🎉 Container creation test completed successfully!", "success");
    log("", "info");
    log("Next steps:", "info");
    log(
      `  1. Test file operations: node scripts/test-file-operations.js ${result.fullServiceName}`,
      "info"
    );
    log(
      `  2. Test log streaming: node scripts/test-log-streaming.js ${result.fullServiceName}`,
      "info"
    );
    log(
      `  3. Visit in browser: ${BASE_URL}/${
        result.projectId
      }?repo=${encodeURIComponent(repoUrl)}`,
      "info"
    );
  } else {
    log("💥 Container creation test failed!", "error");
    process.exit(1);
  }

  rl.close();
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { testContainerCreation };
