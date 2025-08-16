#!/usr/bin/env node

/**
 * Test File Operations
 *
 * This script tests all the container API file operations (read, write, list, search, etc.)
 * Usage: node scripts/test-file-operations.js <project-id>
 */

const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

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

async function callContainerAPI(action, params = {}, containerUrl = null) {
  try {
    const body = { action, params };
    if (containerUrl) {
      body.containerUrl = `https://${containerUrl}`;
    }

    const response = await fetch(`${BASE_URL}/api/container`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    throw new Error(`Container API call failed: ${error.message}`);
  }
}

async function testFileOperations(containerUrl) {
  log(`Testing file operations for container: ${containerUrl}`, "step");

  const tests = [
    {
      name: "Check Status",
      action: "checkStatus",
      params: {},
      validate: (result) => result && typeof result === "object",
    },
    {
      name: "List Files",
      action: "listFiles",
      params: { path: "." },
      validate: (result) => result && Array.isArray(result.files),
    },
    {
      name: "Read Package.json",
      action: "readFile",
      params: { path: "package.json" },
      validate: (result) =>
        result && result.content && result.content.includes('"name"'),
    },
    {
      name: "Search for README",
      action: "searchFiles",
      params: { pattern: "README", path: "." },
      validate: (result) => result && Array.isArray(result.matches),
    },
    {
      name: "Create Test File",
      action: "writeFile",
      params: {
        path: "test-file.txt",
        content:
          "This is a test file created by the testing script.\nLine 2\nLine 3",
      },
      validate: (result) => result && result.success === true,
    },
    {
      name: "Read Test File",
      action: "readFile",
      params: { path: "test-file.txt" },
      validate: (result) =>
        result &&
        result.content &&
        result.content.includes("This is a test file"),
    },
    {
      name: "Replace Lines in Test File",
      action: "replaceLines",
      params: {
        path: "test-file.txt",
        startLine: 2,
        endLine: 2,
        newContent: "Modified Line 2",
      },
      validate: (result) => result && result.success === true,
    },
    {
      name: "Verify Line Replacement",
      action: "readFile",
      params: { path: "test-file.txt" },
      validate: (result) =>
        result && result.content && result.content.includes("Modified Line 2"),
    },
    {
      name: "Run Simple Command",
      action: "runCommand",
      params: { command: "pwd" },
      validate: (result) => result && result.stdout,
    },
    {
      name: "Delete Test File",
      action: "deleteFile",
      params: { path: "test-file.txt" },
      validate: (result) => result && result.success === true,
    },
  ];

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    try {
      log(`Running: ${test.name}`, "step");

      const result = await callContainerAPI(
        test.action,
        test.params,
        containerUrl
      );

      if (test.validate(result)) {
        log(`✅ ${test.name}: PASSED`, "success");

        // Show sample output for some tests
        if (test.action === "listFiles" && result.files) {
          log(`   Found ${result.files.length} files/directories`, "info");
          log(
            `   Sample: ${result.files
              .slice(0, 3)
              .map((f) => f.name || f)
              .join(", ")}`,
            "info"
          );
        } else if (test.action === "readFile" && result.content) {
          const preview = result.content.substring(0, 100);
          log(
            `   Content preview: ${preview}${
              result.content.length > 100 ? "..." : ""
            }`,
            "info"
          );
        } else if (test.action === "runCommand" && result.stdout) {
          log(`   Output: ${result.stdout.trim()}`, "info");
        }

        passed++;
      } else {
        log(`❌ ${test.name}: FAILED - Invalid result format`, "error");
        log(`   Result: ${JSON.stringify(result, null, 2)}`, "error");
        failed++;
      }
    } catch (error) {
      log(`❌ ${test.name}: FAILED - ${error.message}`, "error");
      failed++;
    }

    // Small delay between tests
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  log("", "info");
  log(
    `📊 Test Results: ${passed} passed, ${failed} failed`,
    passed === tests.length ? "success" : "warning"
  );

  return {
    total: tests.length,
    passed,
    failed,
    success: failed === 0,
  };
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log("Usage: node scripts/test-file-operations.js <container-url>");
    console.log("");
    console.log("Example:");
    console.log(
      "  node scripts/test-file-operations.js test-user-nextjs-starter-dev.up.railway.app"
    );
    process.exit(1);
  }

  const containerUrl = args[0];

  log("🔧 Container File Operations Test Starting...", "step");
  log(`Container URL: ${containerUrl}`, "info");
  log(`Base URL: ${BASE_URL}`, "info");

  try {
    const result = await testFileOperations(containerUrl);

    if (result.success) {
      log("🎉 All file operations tests passed!", "success");
      process.exit(0);
    } else {
      log(`💥 ${result.failed} tests failed!`, "error");
      process.exit(1);
    }
  } catch (error) {
    log(`💥 Test suite failed: ${error.message}`, "error");
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { testFileOperations };
