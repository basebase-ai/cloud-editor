const fetch = require("node-fetch");

async function testHealthCheck(containerUrl) {
  console.log(`Testing health check for: ${containerUrl}`);

  try {
    const response = await fetch(`${containerUrl}/_container/health`);
    const data = await response.json();

    console.log("Health check response:");
    console.log(JSON.stringify(data, null, 2));

    if (data.overall?.healthy) {
      console.log("✅ Container is fully healthy!");
    } else {
      console.log("❌ Container is not fully healthy");
      console.log("Container API:", data.services?.containerApi?.status);
      console.log("User App:", data.services?.userApp?.status);
    }

    return data;
  } catch (error) {
    console.error("❌ Health check failed:", error.message);
    return null;
  }
}

// Test with a sample URL (replace with actual container URL)
const containerUrl = process.argv[2] || "http://localhost:3001";
testHealthCheck(containerUrl);
