#!/usr/bin/env node

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

async function testRailwayAPI() {
  console.log("🔍 Testing Railway API connectivity...");
  console.log(`📍 Base URL: ${BASE_URL}`);
  
  try {
    // Test the Railway test endpoint
    console.log("\n📡 Testing Railway API connection...");
    const testResponse = await fetch(`${BASE_URL}/api/railway/test?serviceId=user-td2yj8-nextjs-starter-dev`);
    
    console.log(`📊 Response status: ${testResponse.status}`);
    
    if (!testResponse.ok) {
      const errorText = await testResponse.text();
      console.error(`❌ Railway API test failed: ${errorText}`);
      return false;
    }
    
    const testData = await testResponse.json();
    console.log("✅ Railway API test successful:", testData);
    
    // Test the logs endpoint
    console.log("\n📡 Testing Railway logs endpoint...");
    const logsResponse = await fetch(`${BASE_URL}/api/railway/logs?serviceId=user-td2yj8-nextjs-starter-dev&limit=10`);
    
    console.log(`📊 Logs response status: ${logsResponse.status}`);
    
    if (!logsResponse.ok) {
      const errorText = await logsResponse.text();
      console.error(`❌ Railway logs test failed: ${errorText}`);
      return false;
    }
    
    const logsData = await logsResponse.json();
    console.log("✅ Railway logs test successful:", {
      success: logsData.success,
      total: logsData.total,
      sampleLogs: logsData.logs?.slice(0, 2) || []
    });
    
    return true;
    
  } catch (error) {
    console.error("❌ Test failed with error:", error.message);
    return false;
  }
}

async function testLogStreaming() {
  console.log("\n📡 Testing Railway log streaming...");
  
  return new Promise((resolve) => {
    let logCount = 0;
    let streamingSuccess = false;
    
    const timeout = setTimeout(() => {
      console.log(`⏰ Streaming test completed after 10 seconds`);
      console.log(`📊 Received ${logCount} log entries`);
      resolve(streamingSuccess && logCount >= 0);
    }, 10000);
    
    fetch(`${BASE_URL}/api/railway/logs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        serviceId: "user-td2yj8-nextjs-starter-dev",
      }),
    })
    .then(response => {
      if (!response.ok) {
        console.error(`❌ Log streaming request failed: ${response.status}`);
        clearTimeout(timeout);
        resolve(false);
        return;
      }
      
      console.log("✅ Log streaming connection established");
      streamingSuccess = true;
      
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      
      const readStream = async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            const chunk = decoder.decode(value);
            const lines = chunk.split('\n');
            
            for (const line of lines) {
              if (line.startsWith('data: ')) {
                try {
                  const data = JSON.parse(line.slice(6));
                  logCount++;
                  
                  if (data.type === 'log') {
                    console.log(`📝 Log ${logCount}: ${data.message?.substring(0, 100)}...`);
                  } else if (data.type === 'error') {
                    console.error(`❌ Stream error: ${data.message}`);
                  } else if (data.type === 'connected') {
                    console.log("✅ Stream connected");
                  }
                } catch (parseError) {
                  console.warn("⚠️ Failed to parse log entry:", parseError);
                }
              }
            }
          }
        } catch (error) {
          console.error("❌ Error reading stream:", error);
        }
      };
      
      readStream();
    })
    .catch(error => {
      console.error("❌ Failed to start log streaming:", error);
      clearTimeout(timeout);
      resolve(false);
    });
  });
}

async function main() {
  console.log("🚀 Railway API Test Suite");
  console.log("=" .repeat(50));
  
  const apiTest = await testRailwayAPI();
  const streamingTest = await testLogStreaming();
  
  console.log("\n📋 Test Results:");
  console.log("=" .repeat(50));
  console.log(`🔌 API Connection: ${apiTest ? "✅ PASS" : "❌ FAIL"}`);
  console.log(`📡 Log Streaming: ${streamingTest ? "✅ PASS" : "❌ FAIL"}`);
  
  if (!apiTest || !streamingTest) {
    console.log("\n🔧 Troubleshooting Tips:");
    console.log("1. Check if RAILWAY_TOKEN environment variable is set");
    console.log("2. Verify the Railway service ID is correct");
    console.log("3. Check Railway API status at https://status.railway.app");
    console.log("4. Ensure your Railway token has the necessary permissions");
    process.exit(1);
  } else {
    console.log("\n🎉 All tests passed!");
  }
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { testRailwayAPI, testLogStreaming };
