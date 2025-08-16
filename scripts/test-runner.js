#!/usr/bin/env node

/**
 * Comprehensive Test Runner
 *
 * This script runs all the Railway container tests in sequence
 * Usage: node scripts/test-runner.js <github-repo-url> [github-token]
 */

const { testContainerCreation } = require("./test-container-creation");
const { testFileOperations } = require("./test-file-operations");
const { testLogStreaming } = require("./test-log-streaming");

const readline = require("readline");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function log(message, type = "info") {
  const timestamp = new Date().toISOString();
  const prefix =
    {
      info: "📝",
      success: "✅",
      error: "❌",
      warning: "⚠️",
      step: "🔄",
      suite: "🧪",
    }[type] || "📝";

  console.log(`${timestamp} ${prefix} ${message}`);
}

async function prompt(question) {
  return new Promise((resolve) => {
    rl.question(question, resolve);
  });
}

async function runFullTestSuite(
  repoUrl,
  githubToken,
  userId = `test-user-${Math.random().toString(36).substring(2, 6)}`
) {
  log("🚀 Starting comprehensive Railway container test suite...", "suite");
  log(`User ID: ${userId}`, "info");

  const results = {
    containerCreation: null,
    fileOperations: null,
    logStreaming: null,
    startTime: new Date(),
    endTime: null,
  };

  try {
    // Test 1: Container Creation
    log("=".repeat(60), "suite");
    log("TEST SUITE 1: Container Creation", "suite");
    log("=".repeat(60), "suite");

    results.containerCreation = await testContainerCreation(
      repoUrl,
      githubToken,
      userId
    );

    if (!results.containerCreation.success) {
      log("💥 Container creation failed - aborting remaining tests", "error");
      return results;
    }

    const fullServiceName = results.containerCreation.fullServiceName;

    // Wait a bit for container to fully initialize
    log("⏳ Waiting 30 seconds for container to fully initialize...", "step");
    await new Promise((resolve) => setTimeout(resolve, 30000));

    // Test 2: File Operations
    log("=".repeat(60), "suite");
    log("TEST SUITE 2: File Operations", "suite");
    log("=".repeat(60), "suite");

    results.fileOperations = await testFileOperations(fullServiceName);

    // Test 3: Log Streaming
    log("=".repeat(60), "suite");
    log("TEST SUITE 3: Log Streaming", "suite");
    log("=".repeat(60), "suite");

    results.logStreaming = await testLogStreaming(fullServiceName);
  } catch (error) {
    log(`💥 Test suite failed with error: ${error.message}`, "error");
    results.error = error.message;
  }

  results.endTime = new Date();
  return results;
}

function printSummary(results) {
  const duration = results.endTime
    ? (results.endTime - results.startTime) / 1000
    : 0;

  log("=".repeat(60), "suite");
  log("TEST SUITE SUMMARY", "suite");
  log("=".repeat(60), "suite");

  log(`Total Duration: ${duration.toFixed(1)} seconds`, "info");
  log("", "info");

  // Container Creation
  if (results.containerCreation) {
    const status = results.containerCreation.success
      ? "✅ PASSED"
      : "❌ FAILED";
    log(
      `1. Container Creation: ${status}`,
      results.containerCreation.success ? "success" : "error"
    );
    if (results.containerCreation.success) {
      log(`   Project ID: ${results.containerCreation.projectId}`, "info");
      log(
        `   Container URL: ${results.containerCreation.deployment.url}`,
        "info"
      );
    } else {
      log(`   Error: ${results.containerCreation.error}`, "error");
    }
  }

  // File Operations
  if (results.fileOperations) {
    const status = results.fileOperations.success ? "✅ PASSED" : "❌ FAILED";
    log(
      `2. File Operations: ${status}`,
      results.fileOperations.success ? "success" : "error"
    );
    log(
      `   Tests: ${results.fileOperations.passed}/${results.fileOperations.total} passed`,
      "info"
    );
  } else {
    log(
      "2. File Operations: ⏭️ SKIPPED (container creation failed)",
      "warning"
    );
  }

  // Log Streaming
  if (results.logStreaming) {
    const status = results.logStreaming.success ? "✅ PASSED" : "❌ FAILED";
    log(
      `3. Log Streaming: ${status}`,
      results.logStreaming.success ? "success" : "error"
    );
  } else {
    log("3. Log Streaming: ⏭️ SKIPPED (container creation failed)", "warning");
  }

  log("", "info");

  const allPassed =
    results.containerCreation?.success &&
    results.fileOperations?.success &&
    results.logStreaming?.success;

  if (allPassed) {
    log(
      "🎉 ALL TESTS PASSED! Railway container system is working correctly.",
      "success"
    );

    log("", "info");
    log("🔗 Next Steps:", "suite");
    log(
      `   • Visit: http://localhost:3000/${results.containerCreation.projectId}`,
      "info"
    );
    log(
      `   • Container URL: ${results.containerCreation.deployment.url}`,
      "info"
    );
    log(`   • Try the full UI with chat and file editing!`, "info");
  } else {
    log("💥 SOME TESTS FAILED! Please check the errors above.", "error");
  }

  return allPassed;
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log(
      "Usage: node scripts/test-runner.js <github-repo-url> [github-token] [user-id]"
    );
    console.log("");
    console.log("This script runs the complete Railway container test suite:");
    console.log("  1. Container Creation & Deployment");
    console.log("  2. File Operations (read, write, list, search, etc.)");
    console.log("  3. Log Streaming (historical & real-time)");
    console.log("");
    console.log("Examples:");
    console.log(
      "  node scripts/test-runner.js https://github.com/vercel/next.js"
    );
    console.log(
      "  node scripts/test-runner.js https://github.com/user/private-repo gh_token_here"
    );
    console.log(
      "  node scripts/test-runner.js https://github.com/vercel/next.js '' frank"
    );
    console.log("");
    console.log("Environment Variables:");
    console.log(
      "  TEST_BASE_URL - Override base URL (default: http://localhost:3000)"
    );
    process.exit(1);
  }

  const repoUrl = args[0];
  let githubToken = args[1];
  let userId =
    args[2] || `test-user-${Math.random().toString(36).substring(2, 6)}`;

  // Interactive token input for private repos
  if (!githubToken && repoUrl.includes("github.com")) {
    const needsToken = await prompt("Is this a private repository? (y/N): ");
    if (
      needsToken.toLowerCase() === "y" ||
      needsToken.toLowerCase() === "yes"
    ) {
      githubToken = await prompt("Enter GitHub token: ");
    }
  }

  log("🧪 Railway Container Comprehensive Test Suite", "suite");
  log(`Repository: ${repoUrl}`, "info");
  log(
    `Base URL: ${process.env.TEST_BASE_URL || "http://localhost:3000"}`,
    "info"
  );
  if (githubToken) {
    log("GitHub Token: ✅ Provided", "info");
  }
  log("", "info");

  // Confirm before starting
  const confirm = await prompt(
    "Start test suite? This will create a Railway container. (Y/n): "
  );
  if (confirm.toLowerCase() === "n" || confirm.toLowerCase() === "no") {
    log("Test suite cancelled by user", "warning");
    rl.close();
    process.exit(0);
  }

  const results = await runFullTestSuite(repoUrl, githubToken, userId);
  const success = printSummary(results);

  rl.close();
  process.exit(success ? 0 : 1);
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { runFullTestSuite };
