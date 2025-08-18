const express = require("express");
const cors = require("cors");
const fs = require("fs/promises"); // Changed to fs.promises for async operations
const fsSync = require("fs"); // For synchronous operations in endpoint handlers
const path = require("path");
const { exec } = require("child_process");
const { createProxyMiddleware } = require("http-proxy-middleware");
// Use built-in fetch (available in Node.js 18+) or fallback to node-fetch
let fetch;
if (typeof globalThis.fetch === 'function') {
  fetch = globalThis.fetch;
} else {
  // Fallback for older Node.js versions
  fetch = require("node-fetch");
}

const app = express();
const PORT = process.env.PORT || 3001; // Railway will set PORT to public port
const WORKSPACE_DIR = "/workspace";
// If Railway sets PORT=3000, user app needs to use different port to avoid conflict
const USER_APP_PORT = process.env.PORT === "3000" ? 3001 : 3000;

app.use(cors());
app.use(express.json());

// ==========================================
// CONTAINER API ROUTES (/_container/*)
// ==========================================

// Test endpoint to check Next.js app directly
app.get("/_container/test-nextjs", async (req, res) => {
  try {
    const response = await fetch(`http://localhost:${USER_APP_PORT}`, {
      method: "GET",
      timeout: 5000,
    });

    res.json({
      success: true,
      statusCode: response.status,
      statusText: response.statusText,
      responding: response.ok,
      url: `http://localhost:${USER_APP_PORT}`,
    });
  } catch (error) {
    res.json({
      success: false,
      error: error.message,
      url: `http://localhost:${USER_APP_PORT}`,
    });
  }
});

// Health check endpoint
app.get("/_container/health", async (req, res) => {
  try {
    const containerHealth = {
      success: true,
      status: "healthy",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      logBufferSize: logBuffer.length,
    };

    // Check if the user app (Next.js) is responding
    let userAppHealth = null;
    try {
      const userAppResponse = await fetch(`http://localhost:${USER_APP_PORT}`, {
        method: "GET",
        timeout: 5000, // 5 second timeout
      });

      userAppHealth = {
        status: userAppResponse.ok ? "healthy" : "unhealthy",
        statusCode: userAppResponse.status,
        responding: true,
      };
    } catch (error) {
      userAppHealth = {
        status: "unhealthy",
        responding: false,
        error: error.message,
      };
    }

    // Overall health depends on both services
    const overallHealthy =
      containerHealth.success &&
      userAppHealth.responding &&
      userAppHealth.statusCode === 200;

    res.json({
      ...containerHealth,
      overall: {
        healthy: overallHealthy,
        status: overallHealthy ? "ready" : "starting",
      },
      services: {
        containerApi: containerHealth,
        userApp: userAppHealth,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
      overall: {
        healthy: false,
        status: "error",
      },
    });
  }
});

// Read file
app.post("/_container/read_file", (req, res) => {
  try {
    const { path: filePath } = req.body;
    if (!filePath) {
      return res.json({ success: false, error: "Missing file path" });
    }

    const fullPath = path.join(WORKSPACE_DIR, filePath);
    const content = fsSync.readFileSync(fullPath, "utf8");
    res.json({ success: true, content });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// Write file
app.post("/_container/write_file", (req, res) => {
  try {
    const { path: filePath, content } = req.body;
    if (!filePath || content === undefined) {
      return res.json({
        success: false,
        error: "Missing file path or content",
      });
    }

    const fullPath = path.join(WORKSPACE_DIR, filePath);

    // Ensure directory exists
    const dir = path.dirname(fullPath);
    fsSync.mkdirSync(dir, { recursive: true });

    fsSync.writeFileSync(fullPath, content, "utf8");
    res.json({ success: true });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// List files
app.post("/_container/list_files", (req, res) => {
  try {
    const { path: dirPath = "." } = req.body;
    const fullPath = path.join(WORKSPACE_DIR, dirPath);

    const files = fsSync.readdirSync(fullPath).map((file) => {
      const filePath = path.join(fullPath, file);
      const stats = fsSync.statSync(filePath);
      return {
        name: file,
        type: stats.isDirectory() ? "directory" : "file",
        size: stats.size,
        modified: stats.mtime.toISOString(),
      };
    });

    res.json({ success: true, files });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// Run command
app.post("/_container/run_command", (req, res) => {
  try {
    const { command, cwd = "." } = req.body;
    if (!command) {
      return res.json({ success: false, error: "Missing command" });
    }

    const workingDir = path.join(WORKSPACE_DIR, cwd);

    exec(command, { cwd: workingDir }, (error, stdout, stderr) => {
      res.json({
        success: !error,
        stdout,
        stderr,
        error: error?.message,
      });
    });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// Restart server (restart the user's app process)
app.post("/_container/restart_server", (req, res) => {
  try {
    // Kill existing user app process and restart
    exec('pkill -f "npm.*dev\\|npm.*start"', () => {
      // Wait a moment then restart
      setTimeout(() => {
        const startCommand =
          process.env.USER_APP_START_COMMAND || "npm run dev";
        exec(startCommand, { cwd: WORKSPACE_DIR }, () => {});
      }, 1000);
    });

    res.json({ success: true, message: "Server restart initiated" });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// Search for files containing text
app.post("/_container/search_files", async (req, res) => {
  try {
    const { pattern, path: searchPath = "." } = req.body;

    if (!pattern) {
      return res.json({ success: false, error: "Pattern is required" });
    }

    console.log(
      `[Container API] search_files endpoint called with pattern: ${pattern}, path: ${searchPath}`
    );

    // Use the async searchFiles function for content-based search
    const result = await searchFiles(pattern, [searchPath]);

    res.json(result);
  } catch (error) {
    console.error(`[Container API] search_files endpoint error:`, error);
    res.json({ success: false, error: error.message });
  }
});

// Run linter
app.post("/_container/run_linter", (req, res) => {
  try {
    const { files = "all" } = req.body;

    // Try to run the linter (assuming ESLint is configured)
    const command = `npm run lint ${files === "all" ? "" : files}`;

    exec(command, { cwd: WORKSPACE_DIR }, (error, stdout, stderr) => {
      if (error) {
        // Parse the output for linting errors and warnings
        const output = stdout + stderr;
        const lines = output.split("\n");

        const errors = [];
        const warnings = [];

        for (const line of lines) {
          if (line.includes("error") || line.includes("Error")) {
            errors.push(line.trim());
          } else if (line.includes("warning") || line.includes("Warning")) {
            warnings.push(line.trim());
          }
        }

        res.json({
          success: false,
          errors,
          warnings,
          message: `Linting found ${errors.length} errors and ${warnings.length} warnings`,
          stdout,
          stderr,
        });
      } else {
        res.json({
          success: true,
          errors: [],
          warnings: [],
          message: "Linting completed successfully",
          stdout,
        });
      }
    });
  } catch (error) {
    res.json({
      success: false,
      error: error.message,
      message: "Failed to run linter - linting may not be configured",
    });
  }
});

// Replace lines in a file
app.post("/_container/replace_lines", (req, res) => {
  try {
    const { path: filePath, startLine, endLine, newContent } = req.body;

    if (!filePath || startLine === undefined || endLine === undefined) {
      return res.json({
        success: false,
        error: "path, startLine, and endLine are required",
      });
    }

    const fullPath = path.resolve(WORKSPACE_DIR, filePath);

    // Read the file
    const content = fsSync.readFileSync(fullPath, "utf8");
    const lines = content.split("\n");

    // Replace the specified lines (convert to 0-based indexing)
    const start = Math.max(0, startLine - 1);
    const end = Math.min(lines.length, endLine);

    // Remove old lines and insert new content
    lines.splice(start, end - start, newContent);

    // Write back to file
    fsSync.writeFileSync(fullPath, lines.join("\n"));

    res.json({
      success: true,
      message: `Lines ${startLine}-${endLine} replaced`,
    });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// Delete a file
app.post("/_container/delete_file", (req, res) => {
  try {
    const { path: filePath } = req.body;

    if (!filePath) {
      return res.json({ success: false, error: "path is required" });
    }

    const fullPath = path.resolve(WORKSPACE_DIR, filePath);

    // Check if file exists
    if (!fsSync.existsSync(fullPath)) {
      return res.json({ success: false, error: "File not found" });
    }

    // Delete the file
    fsSync.unlinkSync(fullPath);

    res.json({ success: true, message: "File deleted successfully" });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// Simple log storage for streaming
let logBuffer = [];
const MAX_LOG_BUFFER = 100;

// Capture console output and store in buffer
const originalConsoleLog = console.log;
const originalConsoleError = console.error;

console.log = function (...args) {
  const message = args.join(" ");
  logBuffer.push({
    type: "log",
    timestamp: new Date().toISOString(),
    message: message,
  });
  if (logBuffer.length > MAX_LOG_BUFFER) {
    logBuffer.shift();
  }
  originalConsoleLog.apply(console, args);
};

console.error = function (...args) {
  const message = args.join(" ");
  logBuffer.push({
    type: "error",
    timestamp: new Date().toISOString(),
    message: message,
  });
  if (logBuffer.length > MAX_LOG_BUFFER) {
    logBuffer.shift();
  }
  originalConsoleError.apply(console, args);
};

// Get recent logs
app.get("/_container/logs", (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const recentLogs = logBuffer.slice(-limit);
    res.json({ success: true, logs: recentLogs });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// Stream logs via Server-Sent Events (combines container logs + user app logs)
app.get("/_container/logs/stream", (req, res) => {
  const { spawn } = require("child_process");

  console.log(`[Container API] Starting log stream for client`);

  // Set up Server-Sent Events
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
  });

  // Send connection message
  res.write('data: {"type":"connected","message":"Container log stream connected"}\n\n');

  // Send recent container API logs
  const recentLogs = logBuffer.slice(-20);
  console.log(`[Container API] Sending ${recentLogs.length} recent logs to client`);
  recentLogs.forEach((log) => {
    res.write(`data: ${JSON.stringify(log)}\n\n`);
  });

  let lastSentIndex = logBuffer.length;

  // Stream container API logs
  const containerLogInterval = setInterval(() => {
    if (logBuffer.length > lastSentIndex) {
      const newLogs = logBuffer.slice(lastSentIndex);
      console.log(`[Container API] Streaming ${newLogs.length} new logs to client`);
      newLogs.forEach((log) => {
        res.write(`data: ${JSON.stringify(log)}\n\n`);
      });
      lastSentIndex = logBuffer.length;
    }
  }, 1000);

  // Stream user app logs from file
  const userAppLogFile = "/tmp/user-app.log";
  let userAppLogProcess = null;

  // Check if log file exists and start tailing it
  if (fsSync.existsSync(userAppLogFile)) {
    console.log(`[Container API] Starting to tail user app log file: ${userAppLogFile}`);
    userAppLogProcess = spawn("tail", ["-f", userAppLogFile]);

    userAppLogProcess.stdout.on("data", (data) => {
      const lines = data
        .toString()
        .split("\n")
        .filter((line) => line.trim());
      lines.forEach((line) => {
        if (line.trim()) {
          const logEntry = {
            type: "app_log",
            timestamp: new Date().toISOString(),
            message: line,
          };
          res.write(`data: ${JSON.stringify(logEntry)}\n\n`);
        }
      });
    });

    userAppLogProcess.stderr.on("data", (data) => {
      console.error(`[Container API] Tail process error: ${data}`);
    });
  } else {
    console.log(`[Container API] User app log file not found: ${userAppLogFile}`);
    res.write(`data: ${JSON.stringify({
      type: "info",
      timestamp: new Date().toISOString(),
      message: `User app log file not found: ${userAppLogFile}`,
    })}\n\n`);
  }

  // Also stream system logs (Next.js, npm, etc.)
  const systemLogFile = "/tmp/system.log";
  let systemLogProcess = null;

  if (fsSync.existsSync(systemLogFile)) {
    console.log(`[Container API] Starting to tail system log file: ${systemLogFile}`);
    systemLogProcess = spawn("tail", ["-f", systemLogFile]);

    systemLogProcess.stdout.on("data", (data) => {
      const lines = data
        .toString()
        .split("\n")
        .filter((line) => line.trim());
      lines.forEach((line) => {
        if (line.trim()) {
          const logEntry = {
            type: "system_log",
            timestamp: new Date().toISOString(),
            message: line,
          };
          res.write(`data: ${JSON.stringify(logEntry)}\n\n`);
        }
      });
    });
  }

  // Heartbeat
  const heartbeat = setInterval(() => {
    res.write(`data: ${JSON.stringify({ 
      type: "heartbeat",
      timestamp: new Date().toISOString(),
      message: "Container log stream heartbeat"
    })}\n\n`);
  }, 30000);

  // Clean up on disconnect
  req.on("close", () => {
    console.log(`[Container API] Client disconnected, cleaning up log stream`);
    clearInterval(containerLogInterval);
    clearInterval(heartbeat);
    if (userAppLogProcess) {
      userAppLogProcess.kill();
    }
    if (systemLogProcess) {
      systemLogProcess.kill();
    }
  });
});

// Poll for pending requests from the main API
app.get("/_container/poll", async (req, res) => {
  try {
    console.log(`[Container API] Polling for requests...`);

    // Get the base URL for the main API
    const baseUrl = process.env.MAIN_API_URL || "http://localhost:3000";
    const pollUrl = `${baseUrl}/api/container`;

    console.log(`[Container API] Polling from: ${pollUrl}`);

    const response = await fetch(pollUrl);

    if (!response.ok) {
      console.error(
        `[Container API] Poll failed with status: ${response.status}`
      );
      res.json({ requests: [] });
      return;
    }

    const data = await response.json();
    const requests = data.requests || [];

    console.log(
      `[Container API] Received ${requests.length} requests from poll`
    );

    if (requests.length === 0) {
      res.json({ requests: [] });
      return;
    }

    // Process each request
    for (const request of requests) {
      console.log(
        `[Container API] Processing request ${request.id}: ${request.action}`
      );

      try {
        let result;

        switch (request.action) {
          case "listFiles":
            result = await listFiles(request.params.path || ".");
            break;
          case "readFile":
            result = await readFile(request.params.path);
            break;
          case "writeFile":
            result = await writeFile(
              request.params.path,
              request.params.content
            );
            break;
          case "searchFiles":
            result = await searchFiles(
              request.params.pattern,
              request.params.files
            );
            break;
          case "replaceLines":
            result = await replaceLines(
              request.params.path,
              request.params.query,
              request.params.replacement
            );
            break;
          case "deleteFile":
            result = await deleteFile(request.params.path);
            break;
          case "runCommand":
            result = await runCommand(
              request.params.command,
              request.params.args || []
            );
            break;
          case "restartServer":
            result = await restartServer();
            break;
          case "checkStatus":
            result = await checkStatus();
            break;
          case "getBuildErrors":
            result = await getBuildErrors();
            break;
          case "runLinter":
            result = await runLinter();
            break;
          default:
            result = {
              success: false,
              error: `Unknown action: ${request.action}`,
            };
        }

        console.log(
          `[Container API] Request ${request.id} completed successfully:`,
          {
            action: request.action,
            success: result.success,
            error: result.error,
            message: result.message,
          }
        );

        // Send response back to main API
        await fetch(pollUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            responseId: request.id,
            result,
          }),
        });
      } catch (error) {
        console.error(`[Container API] Request ${request.id} failed:`, error);

        // Send error response back to main API
        await fetch(pollUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            responseId: request.id,
            error: error.message,
          }),
        });
      }
    }

    res.json({ requests: [] });
  } catch (error) {
    console.error("[Container API] Poll error:", error);
    res.json({ requests: [] });
  }
});

// ==========================================
// PROXY TO USER APP (all other routes)
// ==========================================

// Proxy all non-/_container/* requests to the user's app on port 3000
const userAppProxy = createProxyMiddleware({
  target: `http://localhost:${USER_APP_PORT}`,
  changeOrigin: true,
  ws: true, // Enable WebSocket proxying for HMR
  logLevel: "silent", // Reduce noise in logs
  onError: (err, req, res) => {
    console.error("Proxy error:", err.message);
    if (!res.headersSent) {
      res.status(503).json({
        error: "User app not available",
        message:
          "The application may still be starting up. Please wait a moment and try again.",
      });
    }
  },
});

// Apply proxy to all routes except /_container/*
app.use((req, res, next) => {
  if (req.path.startsWith("/_container/")) {
    // Let our container API handle it
    next();
  } else {
    // Add iframe-friendly headers before proxying
    res.setHeader("X-Frame-Options", "ALLOWALL");
    res.setHeader("Content-Security-Policy", "frame-ancestors *");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    console.log(`[Headers] Set iframe headers for: ${req.path}`);

    // Proxy to user app
    userAppProxy(req, res, next);
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Container API + Proxy server running on port ${PORT}`);
  console.log(`📡 Container API available at: /_container/*`);
  console.log(`🎯 User app proxied from: http://localhost:${USER_APP_PORT}`);
});

// List files in a directory
async function listFiles(path) {
  console.log(`[Container API] listFiles called with path: ${path}`);
  try {
    const files = await fs.readdir(path, { withFileTypes: true });
    const fileList = files.map((file) => ({
      name: file.name,
      type: file.isDirectory() ? "directory" : "file",
    }));

    console.log(
      `[Container API] listFiles found ${fileList.length} items in ${path}`
    );
    return { success: true, files: fileList, path };
  } catch (error) {
    console.error(`[Container API] listFiles error:`, error);
    return { success: false, error: error.message, path };
  }
}

// Read file contents
async function readFile(path) {
  console.log(`[Container API] readFile called with path: ${path}`);
  try {
    const content = await fs.readFile(path, "utf8");
    const lines = content.split("\n").length;

    console.log(`[Container API] readFile read ${lines} lines from ${path}`);
    return { success: true, content, path, lines };
  } catch (error) {
    console.error(`[Container API] readFile error:`, error);
    return { success: false, error: error.message, path };
  }
}

// Write file contents
async function writeFile(path, content) {
  console.log(
    `[Container API] writeFile called with path: ${path}, content length: ${content.length}`
  );
  try {
    // Ensure directory exists
    const dir = path.split("/").slice(0, -1).join("/");
    if (dir) {
      await fs.mkdir(dir, { recursive: true });
    }

    await fs.writeFile(path, content, "utf8");
    console.log(
      `[Container API] writeFile successfully wrote ${content.length} characters to ${path}`
    );
    return { success: true, path };
  } catch (error) {
    console.error(`[Container API] writeFile error:`, error);
    return { success: false, error: error.message, path };
  }
}

// Replace text in a file (text-based replacement)
async function replaceLines(path, query, replacement) {
  console.log(
    `[Container API] replaceLines called with path: ${path}, query length: ${query.length}, replacement length: ${replacement.length}`
  );
  try {
    // Read the file
    const content = await fs.readFile(path, "utf8");
    const originalLength = content.length;

    // Check if the query text exists in the file
    if (!content.includes(query)) {
      return {
        success: false,
        path,
        message: `Query text not found in file. The exact text to replace was not found.`,
        error: "Text not found",
        suggestion:
          "Use read_file tool to examine the file and see its current content, then try again with the correct text.",
      };
    }

    // Replace the text
    const newContent = content.replace(query, replacement);
    const newLength = newContent.length;

    // Write the modified content back to the file
    await fs.writeFile(path, newContent, "utf8");

    console.log(
      `[Container API] replaceLines successfully replaced text in ${path} (${originalLength} → ${newLength} chars)`
    );

    return {
      success: true,
      path,
      message: `Successfully replaced text in ${path}`,
      originalLength,
      newLength,
    };
  } catch (error) {
    console.error(`[Container API] replaceLines error:`, error);
    return { success: false, error: error.message, path };
  }
}

// Search for files containing text
async function searchFiles(pattern, files = []) {
  console.log(`[Container API] searchFiles called with pattern: ${pattern}`);
  try {
    const matches = [];
    const patternLower = pattern.toLowerCase(); // Make search case-insensitive

    // If no specific files provided, search in current directory
    const searchPaths = files.length > 0 ? files : ["."];

    for (const searchPath of searchPaths) {
      const fullPath = path.join(WORKSPACE_DIR, searchPath);

      if (fsSync.statSync(fullPath).isFile()) {
        // Search in single file
        const content = await fs.readFile(fullPath, "utf8");
        if (content.toLowerCase().includes(patternLower)) {
          matches.push({
            file: searchPath,
            matches: content
              .split("\n")
              .map((line, index) => ({
                line: index + 1,
                content: line,
              }))
              .filter((line) =>
                line.content.toLowerCase().includes(patternLower)
              ),
          });
        }
      } else {
        // Search in directory recursively
        const searchInDirectory = async (dirPath) => {
          const items = await fs.readdir(dirPath, { withFileTypes: true });

          for (const item of items) {
            const itemPath = path.join(dirPath, item.name);
            const relativePath = path.relative(WORKSPACE_DIR, itemPath);

            if (item.isDirectory()) {
              await searchInDirectory(itemPath);
            } else if (item.isFile()) {
              try {
                const content = await fs.readFile(itemPath, "utf8");
                if (content.toLowerCase().includes(patternLower)) {
                  matches.push({
                    file: relativePath,
                    matches: content
                      .split("\n")
                      .map((line, index) => ({
                        line: index + 1,
                        content: line,
                      }))
                      .filter((line) =>
                        line.content.toLowerCase().includes(patternLower)
                      ),
                  });
                }
              } catch (error) {
                console.warn(
                  `[Container API] Could not read file ${itemPath}:`,
                  error.message
                );
              }
            }
          }
        };

        await searchInDirectory(fullPath);
      }
    }

    console.log(
      `[Container API] searchFiles found ${matches.length} files with matches`
    );
    return { success: true, matches };
  } catch (error) {
    console.error(`[Container API] searchFiles error:`, error);
    return { success: false, error: error.message };
  }
}

// Delete a file
async function deleteFile(filePath) {
  console.log(`[Container API] deleteFile called with path: ${filePath}`);
  try {
    const fullPath = path.join(WORKSPACE_DIR, filePath);
    await fs.unlink(fullPath);
    console.log(`[Container API] deleteFile successfully deleted ${filePath}`);
    return { success: true, path: filePath };
  } catch (error) {
    console.error(`[Container API] deleteFile error:`, error);
    return { success: false, error: error.message, path: filePath };
  }
}

// Run a command
async function runCommand(command, args = []) {
  console.log(
    `[Container API] runCommand called with: ${command} ${args.join(" ")}`
  );
  try {
    return new Promise((resolve) => {
      const fullCommand = `${command} ${args.join(" ")}`;
      exec(fullCommand, { cwd: WORKSPACE_DIR }, (error, stdout, stderr) => {
        if (error) {
          console.error(`[Container API] runCommand error:`, error);
          resolve({
            success: false,
            error: error.message,
            stdout: stdout || "",
            stderr: stderr || "",
            exitCode: error.code,
          });
        } else {
          console.log(`[Container API] runCommand completed successfully`);
          resolve({
            success: true,
            stdout: stdout || "",
            stderr: stderr || "",
            exitCode: 0,
          });
        }
      });
    });
  } catch (error) {
    console.error(`[Container API] runCommand error:`, error);
    return { success: false, error: error.message };
  }
}

// Restart the development server
async function restartServer() {
  console.log(`[Container API] restartServer called`);
  try {
    // Kill any existing npm processes
    await runCommand("pkill", ["-f", "npm"]);

    // Wait a moment for processes to terminate
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Start the development server
    const result = await runCommand("npm", ["run", "dev"]);

    console.log(`[Container API] restartServer completed`);
    return { success: true, message: "Server restarted successfully" };
  } catch (error) {
    console.error(`[Container API] restartServer error:`, error);
    return { success: false, error: error.message };
  }
}

// Check the status of the development server
async function checkStatus() {
  console.log(`[Container API] checkStatus called`);
  try {
    // Check if npm process is running
    const result = await runCommand("pgrep", ["-f", "npm"]);

    if (result.success && result.stdout.trim()) {
      return {
        success: true,
        status: "running",
        message: "Development server is running",
      };
    } else {
      return {
        success: true,
        status: "stopped",
        message: "Development server is not running",
      };
    }
  } catch (error) {
    console.error(`[Container API] checkStatus error:`, error);
    return { success: false, error: error.message };
  }
}

// Get build errors from the project
async function getBuildErrors() {
  console.log(`[Container API] getBuildErrors called`);
  try {
    // Try to run a build to check for errors
    const result = await runCommand("npm", ["run", "build"]);

    if (result.success) {
      return {
        success: true,
        errors: [],
        warnings: [],
        message: "No build errors found",
      };
    } else {
      // Parse stderr for error messages
      const errorLines = result.stderr
        .split("\n")
        .filter(
          (line) =>
            line.includes("error") ||
            line.includes("Error") ||
            line.includes("ERROR")
        );

      return {
        success: false,
        errors: errorLines,
        warnings: [],
        message: `Build failed with ${errorLines.length} errors`,
        stdout: result.stdout,
        stderr: result.stderr,
      };
    }
  } catch (error) {
    console.error(`[Container API] getBuildErrors error:`, error);
    return { success: false, error: error.message };
  }
}

// Run linter on the project
async function runLinter() {
  console.log(`[Container API] runLinter called`);
  try {
    // Try to run the linter (assuming ESLint is configured)
    const result = await runCommand("npm", ["run", "lint"]);

    if (result.success) {
      return {
        success: true,
        errors: [],
        warnings: [],
        message: "Linting completed successfully",
        stdout: result.stdout,
      };
    } else {
      // Parse the output for linting errors and warnings
      const output = result.stdout + result.stderr;
      const lines = output.split("\n");

      const errors = [];
      const warnings = [];

      for (const line of lines) {
        if (line.includes("error") || line.includes("Error")) {
          errors.push(line.trim());
        } else if (line.includes("warning") || line.includes("Warning")) {
          warnings.push(line.trim());
        }
      }

      return {
        success: false,
        errors,
        warnings,
        message: `Linting found ${errors.length} errors and ${warnings.length} warnings`,
        stdout: result.stdout,
        stderr: result.stderr,
      };
    }
  } catch (error) {
    console.error(`[Container API] runLinter error:`, error);
    return {
      success: false,
      error: error.message,
      message: "Failed to run linter - linting may not be configured",
    };
  }
}
