#!/usr/bin/env node

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const TEST_REPO_URL = "https://github.com/basebase-ai/nextjs-starter";

class CloudEditorTest {
  constructor() {
    this.deployment = null;
    this.containerUrl = null;
  }

  log(message, type = "info") {
    const timestamp = new Date().toISOString();
    const prefix =
      {
        info: "ℹ️",
        success: "✅",
        error: "❌",
        warning: "⚠️",
        step: "🔧",
      }[type] || "ℹ️";

    console.log(`${prefix} [${timestamp}] ${message}`);
  }

  async runTest(name, testFn) {
    this.log(`Starting: ${name}`, "step");
    const startTime = Date.now();

    try {
      await testFn();
      const duration = Date.now() - startTime;
      this.log(`✅ ${name} passed (${duration}ms)`, "success");
      return true;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.log(`❌ ${name} failed (${duration}ms): ${error.message}`, "error");
      return false;
    }
  }

  async testDeployContainer() {
    this.log("Deploying container via cloud-editor...", "step");

    const response = await fetch(`${BASE_URL}/api/railway/deploy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        repoUrl: TEST_REPO_URL,
        githubToken: process.env.GITHUB_TOKEN || "test-token",
        userId: "test-user",
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Deployment failed: ${response.status} - ${errorText}`);
    }

    const result = await response.json();

    if (!result.success) {
      throw new Error(`Deployment failed: ${result.error}`);
    }

    this.deployment = result.deployment;
    this.containerUrl = result.deployment.url;

    this.log(`Container deployed: ${this.containerUrl}`, "success");

    // Wait a bit for container to start
    this.log("Waiting 30 seconds for container to start...", "info");
    await new Promise((resolve) => setTimeout(resolve, 30000));
  }

  async testAppServing() {
    this.log("Testing if app is being served...", "step");

    // Try to access the container directly
    const response = await fetch(this.containerUrl, {
      timeout: 10000,
      headers: { "User-Agent": "CloudEditor-Test/1.0" },
    });

    if (!response.ok) {
      throw new Error(`App not serving: ${response.status}`);
    }

    const html = await response.text();

    // Check for Next.js content
    if (!html.includes("Next.js") && !html.includes("nextjs-starter")) {
      throw new Error("App not serving expected Next.js content");
    }

    this.log("App is serving correctly", "success");
  }

  async testContainerAPI() {
    this.log("Testing container API tool calls...", "step");

    // Test 1: List files
    const listResponse = await fetch(`${BASE_URL}/api/container`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "listFiles",
        path: ".",
        containerUrl: this.containerUrl,
      }),
    });

    if (!listResponse.ok) {
      throw new Error(`List files failed: ${listResponse.status}`);
    }

    const listResult = await listResponse.json();
    if (!listResult.success) {
      throw new Error(`List files failed: ${listResult.error}`);
    }

    this.log(`Found ${listResult.files.length} files`, "success");

    // Test 2: Read package.json
    const readResponse = await fetch(`${BASE_URL}/api/container`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "readFile",
        path: "package.json",
        containerUrl: this.containerUrl,
      }),
    });

    if (!readResponse.ok) {
      throw new Error(`Read file failed: ${readResponse.status}`);
    }

    const readResult = await readResponse.json();
    if (!readResult.success) {
      throw new Error(`Read file failed: ${readResult.error}`);
    }

    const packageJson = JSON.parse(readResult.content);
    if (packageJson.name !== "nextjs-starter") {
      throw new Error(`Unexpected package name: ${packageJson.name}`);
    }

    this.log("Container API working correctly", "success");
  }

  async testLogStreaming() {
    this.log("Testing log streaming...", "step");

    return new Promise((resolve, reject) => {
      let logCount = 0;

      const timeout = setTimeout(() => {
        if (logCount > 0) {
          this.log(`Received ${logCount} logs`, "success");
          resolve();
        } else {
          reject(new Error("No logs received"));
        }
      }, 10000); // 10 second timeout

      fetch(`${BASE_URL}/api/railway/logs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serviceId: this.deployment.serviceId,
          deploymentId: this.deployment.deploymentId,
        }),
      })
        .then((response) => {
          if (!response.ok) {
            throw new Error(`Log streaming failed: ${response.status}`);
          }

          const reader = response.body.getReader();
          const decoder = new TextDecoder();

          const readStream = async () => {
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value);
                const lines = chunk.split("\n");

                for (const line of lines) {
                  if (line.startsWith("data: ")) {
                    try {
                      const data = JSON.parse(line.slice(6));

                      if (data.type === "log") {
                        logCount++;
                        if (logCount <= 3) {
                          this.log(
                            `Log ${logCount}: ${data.message?.substring(
                              0,
                              100
                            )}...`
                          );
                        }
                      }
                    } catch (parseError) {
                      // Ignore parse errors
                    }
                  }
                }
              }
            } catch (error) {
              reject(error);
            }
          };

          readStream();
        })
        .catch(reject);
    });
  }

  async run() {
    this.log("🚀 Cloud Editor Test Suite", "step");
    this.log(`📍 Base URL: ${BASE_URL}`, "info");
    this.log(`📦 Test Repo: ${TEST_REPO_URL}`, "info");

    const startTime = Date.now();
    const results = [];

    try {
      results.push(
        await this.runTest("Deploy Container", () => this.testDeployContainer())
      );

      if (results[0]) {
        // Only continue if deployment succeeded
        results.push(
          await this.runTest("App Serving", () => this.testAppServing())
        );
        results.push(
          await this.runTest("Container API", () => this.testContainerAPI())
        );
        results.push(
          await this.runTest("Log Streaming", () => this.testLogStreaming())
        );
      }
    } finally {
      // Cleanup info
      if (this.deployment) {
        this.log(`Service ID: ${this.deployment.serviceId}`, "info");
        this.log(`Deployment ID: ${this.deployment.deploymentId}`, "info");
        this.log("Clean up manually in Railway dashboard if needed", "warning");
      }
    }

    const totalDuration = Date.now() - startTime;
    const passed = results.filter((r) => r).length;
    const failed = results.filter((r) => !r).length;

    this.log("\n📋 Test Results", "step");
    this.log("=".repeat(40));
    this.log(`Total Duration: ${totalDuration}ms`);
    this.log(`Passed: ${passed}/${results.length}`);
    this.log(`Failed: ${failed}/${results.length}`);

    if (failed > 0) {
      this.log("\n🔧 Issues found with cloud-editor functionality", "warning");
      process.exit(1);
    } else {
      this.log(
        "\n🎉 All cloud-editor functionality working correctly!",
        "success"
      );
    }
  }
}

// Run the test
if (require.main === module) {
  const test = new CloudEditorTest();
  test.run().catch((error) => {
    console.error("❌ Test failed:", error);
    process.exit(1);
  });
}

module.exports = CloudEditorTest;
