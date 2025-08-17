const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

const BASE_URL = "http://localhost:3001";

async function testSearchFix() {
  console.log("🧪 Testing fixed search functionality...\n");

  // First, create a test file with "Vibe Together" button
  console.log('📝 Creating test file with "Vibe Together" button...');

  try {
    const writeResponse = await fetch(`${BASE_URL}/_container/write_file`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: "test-page.tsx",
        content: `import { Button } from '@mantine/core';

export default function Home() {
  return (
    <main>
      <Button variant="filled">Vibe Together</Button>
    </main>
  );
}`,
      }),
    });

    const writeResult = await writeResponse.json();
    if (writeResult.success) {
      console.log("✅ Test file created successfully");
    } else {
      console.log("❌ Failed to create test file:", writeResult);
      return;
    }
  } catch (error) {
    console.log("❌ Error creating test file:", error.message);
    return;
  }

  // Test case-insensitive search
  const searchTests = [
    {
      name: 'Search for "vibe together" (lowercase)',
      pattern: "vibe together",
      expected: true,
    },
    {
      name: 'Search for "Vibe Together" (title case)',
      pattern: "Vibe Together",
      expected: true,
    },
    {
      name: 'Search for "VIBE TOGETHER" (uppercase)',
      pattern: "VIBE TOGETHER",
      expected: true,
    },
    {
      name: 'Search for "button" (should find)',
      pattern: "button",
      expected: true,
    },
    {
      name: 'Search for "nonexistent" (should not find)',
      pattern: "nonexistent",
      expected: false,
    },
  ];

  console.log("\n📝 Testing search functionality...");

  for (const test of searchTests) {
    try {
      console.log(`\n🔍 Testing: ${test.name}`);

      const response = await fetch(`${BASE_URL}/_container/search_files`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pattern: test.pattern,
          path: ".",
        }),
      });

      const result = await response.json();

      if (result.success) {
        const found = result.matches && result.matches.length > 0;
        if (found === test.expected) {
          console.log(
            `✅ ${test.name}: PASSED (found ${result.matches.length} matches)`
          );
          if (found) {
            console.log(
              `   Found in: ${result.matches.map((m) => m.file).join(", ")}`
            );
          }
        } else {
          console.log(
            `❌ ${test.name}: FAILED (expected ${test.expected}, got ${found})`
          );
          console.log(`   Result:`, JSON.stringify(result, null, 2));
        }
      } else {
        console.log(`❌ ${test.name}: ERROR - ${result.error}`);
      }
    } catch (error) {
      console.log(`❌ ${test.name}: ERROR - ${error.message}`);
    }
  }

  // Clean up
  console.log("\n🧹 Cleaning up test file...");
  try {
    const deleteResponse = await fetch(`${BASE_URL}/_container/delete_file`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "test-page.tsx" }),
    });

    const deleteResult = await deleteResponse.json();
    if (deleteResult.success) {
      console.log("✅ Test file cleaned up");
    } else {
      console.log("⚠️ Could not clean up test file:", deleteResult);
    }
  } catch (error) {
    console.log("⚠️ Error cleaning up:", error.message);
  }
}

// Run the test
testSearchFix()
  .then(() => {
    console.log("\n🎉 Search functionality test completed!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("💥 Test error:", error);
    process.exit(1);
  });
