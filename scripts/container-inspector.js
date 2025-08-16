#!/usr/bin/env node

/**
 * Container Inspector
 *
 * Interactive tool to inspect and manipulate files in a Railway container
 * Usage: node scripts/container-inspector.js <project-id>
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
  const prefix =
    {
      info: "📝",
      success: "✅",
      error: "❌",
      warning: "⚠️",
      file: "📄",
      dir: "📁",
      cmd: "💻",
    }[type] || "📝";

  console.log(`${prefix} ${message}`);
}

async function prompt(question) {
  return new Promise((resolve) => {
    rl.question(question, resolve);
  });
}

async function callContainerAPI(action, params = {}) {
  try {
    const response = await fetch(`${BASE_URL}/api/container`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, params }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    throw new Error(`Container API call failed: ${error.message}`);
  }
}

async function listFiles(path = ".") {
  try {
    const result = await callContainerAPI("listFiles", { path });

    if (result && Array.isArray(result.files)) {
      log(`Contents of ${path}:`, "dir");
      result.files.forEach((file, index) => {
        const name = typeof file === "string" ? file : file.name;
        const type =
          typeof file === "object" && file.type === "directory"
            ? "dir"
            : "file";
        log(`  ${index + 1}. ${name}`, type);
      });
      return result.files;
    } else {
      log("Invalid response from listFiles", "error");
      return [];
    }
  } catch (error) {
    log(`Failed to list files: ${error.message}`, "error");
    return [];
  }
}

async function readFile(path) {
  try {
    const result = await callContainerAPI("readFile", { path });

    if (result && result.content !== undefined) {
      log(`Content of ${path}:`, "file");
      console.log("─".repeat(50));
      console.log(result.content);
      console.log("─".repeat(50));
      return result.content;
    } else {
      log("Invalid response from readFile", "error");
      return null;
    }
  } catch (error) {
    log(`Failed to read file: ${error.message}`, "error");
    return null;
  }
}

async function writeFile(path, content) {
  try {
    const result = await callContainerAPI("writeFile", { path, content });

    if (result && result.success) {
      log(`Successfully wrote to ${path}`, "success");
      return true;
    } else {
      log("Failed to write file", "error");
      return false;
    }
  } catch (error) {
    log(`Failed to write file: ${error.message}`, "error");
    return false;
  }
}

async function runCommand(command) {
  try {
    log(`Running: ${command}`, "cmd");
    const result = await callContainerAPI("runCommand", { command });

    if (result) {
      if (result.stdout) {
        log("STDOUT:", "cmd");
        console.log(result.stdout);
      }
      if (result.stderr) {
        log("STDERR:", "warning");
        console.log(result.stderr);
      }
      log(`Exit code: ${result.exitCode || 0}`, "cmd");
      return result;
    } else {
      log("Invalid response from runCommand", "error");
      return null;
    }
  } catch (error) {
    log(`Failed to run command: ${error.message}`, "error");
    return null;
  }
}

async function searchFiles(pattern, path = ".") {
  try {
    const result = await callContainerAPI("searchFiles", { pattern, path });

    if (result && Array.isArray(result.matches)) {
      log(`Search results for "${pattern}" in ${path}:`, "file");
      result.matches.forEach((match, index) => {
        log(`  ${index + 1}. ${match}`, "file");
      });
      return result.matches;
    } else {
      log("Invalid response from searchFiles", "error");
      return [];
    }
  } catch (error) {
    log(`Failed to search files: ${error.message}`, "error");
    return [];
  }
}

async function showStatus() {
  try {
    const result = await callContainerAPI("checkStatus");

    if (result) {
      log("Container Status:", "success");
      console.log(JSON.stringify(result, null, 2));
      return result;
    } else {
      log("Failed to get status", "error");
      return null;
    }
  } catch (error) {
    log(`Failed to get status: ${error.message}`, "error");
    return null;
  }
}

function showHelp() {
  console.log("\n📋 Available Commands:");
  console.log(
    "  ls [path]           - List files in directory (default: current)"
  );
  console.log("  cat <file>          - Read file content");
  console.log("  write <file>        - Write content to file (interactive)");
  console.log("  run <command>       - Run shell command");
  console.log("  search <pattern>    - Search for files matching pattern");
  console.log("  status              - Show container status");
  console.log("  help                - Show this help");
  console.log("  exit                - Exit inspector");
  console.log("");
}

async function startInspector(projectId) {
  log(`🔍 Starting Container Inspector for project: ${projectId}`, "info");
  log(`Connected to: ${BASE_URL}`, "info");

  // Test connection
  try {
    await showStatus();
    log("✅ Container connection established", "success");
  } catch (error) {
    log("❌ Failed to connect to container - make sure it is running", "error");
    return;
  }

  showHelp();

  while (true) {
    const input = await prompt("\n🐚 container> ");
    const [command, ...args] = input.trim().split(/\s+/);

    switch (command.toLowerCase()) {
      case "ls":
        await listFiles(args[0] || ".");
        break;

      case "cat":
        if (!args[0]) {
          log("Usage: cat <file>", "warning");
        } else {
          await readFile(args[0]);
        }
        break;

      case "write":
        if (!args[0]) {
          log("Usage: write <file>", "warning");
        } else {
          log("Enter file content (press Ctrl+D when done):");
          const content = await new Promise((resolve) => {
            let data = "";
            process.stdin.on("data", (chunk) => {
              data += chunk;
            });
            process.stdin.on("end", () => {
              resolve(data);
            });
          });
          await writeFile(args[0], content.trim());

          // Reset stdin for continued use
          process.stdin.removeAllListeners("data");
          process.stdin.removeAllListeners("end");
        }
        break;

      case "run":
        if (!args[0]) {
          log("Usage: run <command>", "warning");
        } else {
          await runCommand(args.join(" "));
        }
        break;

      case "search":
        if (!args[0]) {
          log("Usage: search <pattern>", "warning");
        } else {
          await searchFiles(args[0]);
        }
        break;

      case "status":
        await showStatus();
        break;

      case "help":
        showHelp();
        break;

      case "exit":
      case "quit":
        log("👋 Goodbye!", "info");
        return;

      case "":
        // Empty input, continue
        break;

      default:
        log(`Unknown command: ${command}`, "warning");
        log('Type "help" for available commands', "info");
    }
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log("Usage: node scripts/container-inspector.js <project-id>");
    console.log("");
    console.log(
      "Interactive tool to inspect and manipulate files in a Railway container"
    );
    console.log("");
    console.log("Example:");
    console.log("  node scripts/container-inspector.js user-repo");
    console.log("");
    console.log("Environment Variables:");
    console.log(
      "  TEST_BASE_URL - Override base URL (default: http://localhost:3000)"
    );
    process.exit(1);
  }

  const projectId = args[0];

  try {
    await startInspector(projectId);
  } catch (error) {
    log(`Inspector failed: ${error.message}`, "error");
    process.exit(1);
  } finally {
    rl.close();
  }
}

if (require.main === module) {
  main().catch(console.error);
}
