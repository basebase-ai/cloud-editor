#!/usr/bin/env node

/**
 * Railway Container Demo
 *
 * This script demonstrates the testing toolkit with a simple public repository
 */

const { runFullTestSuite } = require("./test-runner");

async function runDemo() {
  console.log("🎬 Railway Container Demo");
  console.log("");
  console.log(
    "This demo will test the Railway container system using a public repository."
  );
  console.log("The test will:");
  console.log("  1. Deploy a container with a simple Node.js app");
  console.log("  2. Test all file operations (read, write, list, etc.)");
  console.log("  3. Test log streaming functionality");
  console.log("");

  // Use a simple, reliable public repository for demo
  const demoRepo = "https://github.com/basebase-ai/nextjs-starter";

  console.log(`🚀 Testing with repository: ${demoRepo}`);
  console.log("");

  try {
    const results = await runFullTestSuite(demoRepo, null);

    if (
      results.containerCreation?.success &&
      results.fileOperations?.success &&
      results.logStreaming?.success
    ) {
      console.log("");
      console.log("🎉 Demo completed successfully!");
      console.log("");
      console.log("🔗 Try the full UI:");
      console.log(
        `   http://localhost:3000/${
          results.containerCreation.projectId
        }?repo=${encodeURIComponent(demoRepo)}`
      );
      console.log("");
      console.log("🔧 Continue testing with:");
      console.log(
        `   npm run inspect:container ${results.containerCreation.projectId}`
      );
    } else {
      console.log("");
      console.log("💥 Demo encountered issues. Check the logs above.");
    }
  } catch (error) {
    console.error("💥 Demo failed:", error.message);
  }
}

if (require.main === module) {
  runDemo().catch(console.error);
}
