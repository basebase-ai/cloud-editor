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
    this.log("Waiting 15 seconds for container to start...", "info");
    await new Promise((resolve) => setTimeout(resolve, 15000));
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
        params: { path: "." },
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
        params: { path: "package.json" },
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
    const allowedNames = ["nextjs-starter", "mantine-minimal-next-template"];
    if (!allowedNames.includes(packageJson.name)) {
      throw new Error(`Unexpected package name: ${packageJson.name}`);
    }

    this.log("Basic file tools working", "success");

    // Test 3: Write a temp file
    const tmpFilePath = "tmp/e2e-tool-test.txt";
    const initialContent = ["alpha", "beta", "gamma"].join("\n");
    const writeResp = await fetch(`${BASE_URL}/api/container`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "writeFile",
        params: { path: tmpFilePath, content: initialContent },
        containerUrl: this.containerUrl,
      }),
    });
    if (!writeResp.ok)
      throw new Error(`Write file failed: ${writeResp.status}`);
    const writeResult = await writeResp.json();
    if (!writeResult.success)
      throw new Error(`Write file failed: ${writeResult.error}`);
    this.log(`Wrote ${tmpFilePath}`, "success");

    // Test 4: Read the temp file back
    const readTmpResp = await fetch(`${BASE_URL}/api/container`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "readFile",
        params: { path: tmpFilePath },
        containerUrl: this.containerUrl,
      }),
    });
    if (!readTmpResp.ok)
      throw new Error(`Read tmp file failed: ${readTmpResp.status}`);
    const readTmpResult = await readTmpResp.json();
    if (!readTmpResult.success)
      throw new Error(`Read tmp file failed: ${readTmpResult.error}`);
    if (readTmpResult.content !== initialContent)
      throw new Error("Temp file content mismatch");
    this.log(`Verified ${tmpFilePath} content`, "success");

    // Test 5: Replace a line in the temp file (line 2 -> REPLACED)
    const replaceResp = await fetch(`${BASE_URL}/api/container`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "replaceLines",
        params: {
          path: tmpFilePath,
          query: "beta",
          replacement: "REPLACED",
        },
        containerUrl: this.containerUrl,
      }),
    });
    if (!replaceResp.ok)
      throw new Error(`Replace lines failed: ${replaceResp.status}`);
    const replaceResult = await replaceResp.json();
    if (!replaceResult.success)
      throw new Error(`Replace lines failed: ${replaceResult.error}`);

    // Verify replacement
    const readAfterReplaceResp = await fetch(`${BASE_URL}/api/container`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "readFile",
        params: { path: tmpFilePath },
        containerUrl: this.containerUrl,
      }),
    });
    const readAfterReplace = await readAfterReplaceResp.json();
    if (!readAfterReplace.success)
      throw new Error(`Read after replace failed: ${readAfterReplace.error}`);
    const expectedContent = ["alpha", "REPLACED", "gamma"].join("\n");
    if (readAfterReplace.content !== expectedContent)
      throw new Error("Replace lines did not apply correctly");
    this.log(`Replaced content verified for ${tmpFilePath}`, "success");

    // Test 6: Search for the new text in tmp directory
    const searchResp = await fetch(`${BASE_URL}/api/container`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "searchFiles",
        params: { pattern: "REPLACED", path: "tmp" },
        containerUrl: this.containerUrl,
      }),
    });
    if (!searchResp.ok)
      throw new Error(`Search files failed: ${searchResp.status}`);
    const searchResult = await searchResp.json();
    if (!searchResult.success)
      throw new Error(`Search files failed: ${searchResult.error}`);
    const foundMatch = (searchResult.matches || []).some(
      (m) => m.file === tmpFilePath
    );
    if (!foundMatch) throw new Error("Search did not find the updated file");
    this.log(`Search found ${tmpFilePath}`, "success");

    // Test 7: Run a simple command
    const cmdResp = await fetch(`${BASE_URL}/api/container`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "runCommand",
        params: { command: "echo CI_E2E_OK", cwd: "." },
        containerUrl: this.containerUrl,
      }),
    });
    if (!cmdResp.ok) throw new Error(`Run command failed: ${cmdResp.status}`);
    const cmdResult = await cmdResp.json();
    if (
      !cmdResult.success ||
      !String(cmdResult.stdout || "").includes("CI_E2E_OK")
    ) {
      throw new Error(`Run command did not return expected output`);
    }
    this.log(`runCommand succeeded`, "success");

    // Test 8: Run linter (accept success true/false, just ensure response shape)
    const lintResp = await fetch(`${BASE_URL}/api/container`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "runLinter",
        params: { files: "all" },
        containerUrl: this.containerUrl,
      }),
    });
    if (!lintResp.ok) throw new Error(`Run linter failed: ${lintResp.status}`);
    const lintResult = await lintResp.json();
    if (typeof lintResult.success !== "boolean")
      throw new Error("Linter response missing success boolean");
    this.log(`runLinter responded (success=${lintResult.success})`, "success");

    // Test 9: Delete the temp file
    const delResp = await fetch(`${BASE_URL}/api/container`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "deleteFile",
        params: { path: tmpFilePath },
        containerUrl: this.containerUrl,
      }),
    });
    if (!delResp.ok) throw new Error(`Delete file failed: ${delResp.status}`);
    const delResult = await delResp.json();
    if (!delResult.success)
      throw new Error(`Delete file failed: ${delResult.error}`);

    // Verify deletion by listing tmp directory
    const listTmpResp = await fetch(`${BASE_URL}/api/container`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "listFiles",
        params: { path: "tmp" },
        containerUrl: this.containerUrl,
      }),
    });
    const listTmp = await listTmpResp.json();
    if (!listTmp.success) throw new Error(`List tmp failed: ${listTmp.error}`);
    const stillExists = (listTmp.files || []).some(
      (f) => f.name === "e2e-tool-test.txt"
    );
    if (stillExists) throw new Error("Temp file still exists after delete");
    this.log(`Deleted ${tmpFilePath}`, "success");

    // Test 10: Restart server (do last)
    const restartResp = await fetch(`${BASE_URL}/api/container`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "restartServer",
        params: {},
        containerUrl: this.containerUrl,
      }),
    });
    if (!restartResp.ok)
      throw new Error(`Restart server failed: ${restartResp.status}`);
    const restartResult = await restartResp.json();
    if (!restartResult.success)
      throw new Error(`Restart server failed: ${restartResult.error}`);
    this.log(`Restart initiated, waiting 5s...`, "info");
    await new Promise((r) => setTimeout(r, 5000));

    // Verify app is back up
    const ping = await fetch(this.containerUrl, {
      timeout: 10000,
      headers: { "User-Agent": "CloudEditor-Test/1.0" },
    });
    if (!ping.ok)
      throw new Error(`App not serving after restart: ${ping.status}`);
    this.log("All container tools verified", "success");
  }

  async testLogStreaming() {
    this.log("Testing log streaming...", "step");

    return new Promise((resolve, reject) => {
      let logCount = 0;
      let reader = null;

      const timeout = setTimeout(() => {
        if (logCount > 0) {
          this.log(`Received ${logCount} logs`, "success");
          // Close the reader before resolving
          if (reader) {
            reader.cancel();
          }
          resolve();
        } else {
          if (reader) {
            reader.cancel();
          }
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

          reader = response.body.getReader();
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
        // Skip log streaming test if we're reusing an existing service (no real deployment ID)
        if (this.deployment.deploymentId !== "existing") {
          results.push(
            await this.runTest("Log Streaming", () => this.testLogStreaming())
          );
        } else {
          this.log(
            "Skipping log streaming test (reusing existing service)",
            "info"
          );
        }
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
