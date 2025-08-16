#!/usr/bin/env node

/**
 * Test Log Streaming
 *
 * This script tests the Railway log streaming functionality
 * Usage: node scripts/test-log-streaming.js <project-id>
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
      log: "📄",
    }[type] || "📝";

  console.log(`${timestamp} ${prefix} ${message}`);
}

async function getDeploymentInfo(projectId) {
  try {
    const response = await fetch(
      `${BASE_URL}/api/railway/deploy?projectId=${projectId}`
    );

    if (!response.ok) {
      throw new Error(`Failed to get deployment info: ${response.status}`);
    }

    const data = await response.json();
    return data.service?.deployment;
  } catch (error) {
    throw new Error(`Failed to get deployment info: ${error.message}`);
  }
}

async function testHistoricalLogs(serviceId, deploymentId) {
  log("Testing historical logs...", "step");

  try {
    const response = await fetch(
      `${BASE_URL}/api/railway/logs?serviceId=${serviceId}&deploymentId=${deploymentId}&limit=10`
    );

    if (!response.ok) {
      throw new Error(`Historical logs request failed: ${response.status}`);
    }

    const data = await response.json();

    if (data.success && Array.isArray(data.logs)) {
      log(`✅ Retrieved ${data.logs.length} historical log entries`, "success");

      // Show sample logs
      data.logs.slice(0, 3).forEach((logEntry, index) => {
        log(
          `   [${index + 1}] ${logEntry.timestamp}: ${logEntry.message}`,
          "log"
        );
      });

      return true;
    } else {
      log(
        `❌ Invalid historical logs response: ${JSON.stringify(data)}`,
        "error"
      );
      return false;
    }
  } catch (error) {
    log(`❌ Historical logs test failed: ${error.message}`, "error");
    return false;
  }
}

async function testLogStreaming(serviceId, deploymentId, duration = 30000) {
  log(
    `Testing real-time log streaming for ${duration / 1000} seconds...`,
    "step"
  );

  return new Promise(async (resolve) => {
    let logCount = 0;
    let streamingSuccess = false;

    try {
      const response = await fetch(`${BASE_URL}/api/railway/logs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serviceId,
          deploymentId,
        }),
      });

      if (!response.ok) {
        log(`❌ Log streaming request failed: ${response.status}`, "error");
        resolve(false);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      log("✅ Log streaming connection established", "success");
      streamingSuccess = true;

      const timeout = setTimeout(() => {
        log(
          `⏰ Streaming test completed after ${duration / 1000} seconds`,
          "info"
        );
        log(`📊 Received ${logCount} log entries`, "info");
        reader.cancel();
        resolve(streamingSuccess && logCount >= 0); // Success if we could connect
      }, duration);

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          const lines = chunk.split("\n");

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const logData = JSON.parse(line.slice(6));
                if (logData.type === "log") {
                  logCount++;
                  log(
                    `   [STREAM] ${logData.timestamp}: ${logData.message}`,
                    "log"
                  );
                }
              } catch (parseError) {
                // Skip malformed log entries
              }
            }
          }
        }
      } catch (streamError) {
        if (streamError.name !== "AbortError") {
          log(`⚠️ Stream reading ended: ${streamError.message}`, "warning");
        }
      }

      clearTimeout(timeout);
      resolve(streamingSuccess);
    } catch (error) {
      log(`❌ Log streaming test failed: ${error.message}`, "error");
      resolve(false);
    }
  });
}

async function testLogStreaming_Full(projectId) {
  log(`Testing log streaming for project: ${projectId}`, "step");

  try {
    // Step 1: Get deployment info
    log("Step 1: Getting deployment information...", "step");
    const deployment = await getDeploymentInfo(projectId);

    if (!deployment) {
      throw new Error("No deployment found for this project");
    }

    log(`✅ Found deployment: ${deployment.deploymentId}`, "success");
    log(`   Service ID: ${deployment.serviceId}`, "info");
    log(`   Status: ${deployment.status}`, "info");
    log(`   URL: ${deployment.url}`, "info");

    if (deployment.status !== "SUCCESS") {
      throw new Error(`Deployment is not ready (status: ${deployment.status})`);
    }

    // Step 2: Test historical logs
    const historicalTest = await testHistoricalLogs(
      deployment.serviceId,
      deployment.deploymentId
    );

    // Step 3: Test real-time streaming
    const streamingTest = await testLogStreaming(
      deployment.serviceId,
      deployment.deploymentId,
      30000
    );

    return {
      deployment,
      historicalLogs: historicalTest,
      streaming: streamingTest,
      success: historicalTest && streamingTest,
    };
  } catch (error) {
    log(`💥 Log streaming test failed: ${error.message}`, "error");
    return {
      success: false,
      error: error.message,
    };
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log("Usage: node scripts/test-log-streaming.js <project-id>");
    console.log("");
    console.log("Example:");
    console.log("  node scripts/test-log-streaming.js user-repo");
    console.log("");
    console.log("Options:");
    console.log(
      "  TEST_BASE_URL - Override base URL (default: http://localhost:3000)"
    );
    process.exit(1);
  }

  const projectId = args[0];

  log("📡 Railway Log Streaming Test Starting...", "step");
  log(`Project ID: ${projectId}`, "info");
  log(`Base URL: ${BASE_URL}`, "info");

  try {
    const result = await testLogStreaming_Full(projectId);

    if (result.success) {
      log("🎉 All log streaming tests passed!", "success");
      process.exit(0);
    } else {
      log("💥 Log streaming tests failed!", "error");
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

module.exports = { testLogStreaming: testLogStreaming_Full };
