const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");
const { createProxyMiddleware } = require("http-proxy-middleware");

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

// Health check
app.get("/_container/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Read file
app.post("/_container/read_file", (req, res) => {
  try {
    const { path: filePath } = req.body;
    if (!filePath) {
      return res.json({ success: false, error: "Missing file path" });
    }

    const fullPath = path.join(WORKSPACE_DIR, filePath);
    const content = fs.readFileSync(fullPath, "utf8");
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
    fs.mkdirSync(dir, { recursive: true });

    fs.writeFileSync(fullPath, content, "utf8");
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

    const files = fs.readdirSync(fullPath).map((file) => {
      const filePath = path.join(fullPath, file);
      const stats = fs.statSync(filePath);
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

// Search for files
app.post("/_container/search_files", (req, res) => {
  try {
    const { pattern, path: searchPath = "." } = req.body;

    if (!pattern) {
      return res.json({ success: false, error: "Pattern is required" });
    }

    const fullPath = path.resolve(WORKSPACE_DIR, searchPath);
    const command = `find "${fullPath}" -name "*${pattern}*" -type f`;

    exec(command, (error, stdout, stderr) => {
      if (error) {
        return res.json({ success: false, error: error.message });
      }

      const matches = stdout
        .split("\n")
        .filter((line) => line.trim())
        .map((fullPath) => {
          return path.relative(WORKSPACE_DIR, fullPath);
        });

      res.json({ success: true, matches });
    });
  } catch (error) {
    res.json({ success: false, error: error.message });
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
    const content = fs.readFileSync(fullPath, "utf8");
    const lines = content.split("\n");

    // Replace the specified lines (convert to 0-based indexing)
    const start = Math.max(0, startLine - 1);
    const end = Math.min(lines.length, endLine);

    // Remove old lines and insert new content
    lines.splice(start, end - start, newContent);

    // Write back to file
    fs.writeFileSync(fullPath, lines.join("\n"));

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
    if (!fs.existsSync(fullPath)) {
      return res.json({ success: false, error: "File not found" });
    }

    // Delete the file
    fs.unlinkSync(fullPath);

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

  // Set up Server-Sent Events
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
  });

  // Send connection message
  res.write('data: {"type":"connected","message":"Log stream connected"}\n\n');

  // Send recent container API logs
  logBuffer.slice(-10).forEach((log) => {
    res.write(`data: ${JSON.stringify(log)}\n\n`);
  });

  let lastSentIndex = logBuffer.length;

  // Stream container API logs
  const containerLogInterval = setInterval(() => {
    if (logBuffer.length > lastSentIndex) {
      const newLogs = logBuffer.slice(lastSentIndex);
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
  if (fs.existsSync(userAppLogFile)) {
    userAppLogProcess = spawn("tail", ["-f", userAppLogFile]);

    userAppLogProcess.stdout.on("data", (data) => {
      const lines = data
        .toString()
        .split("\n")
        .filter((line) => line.trim());
      lines.forEach((line) => {
        if (line.trim()) {
          res.write(
            `data: ${JSON.stringify({
              type: "app_log",
              timestamp: new Date().toISOString(),
              message: line,
            })}\n\n`
          );
        }
      });
    });
  }

  // Heartbeat
  const heartbeat = setInterval(() => {
    res.write(`data: ${JSON.stringify({ type: "heartbeat" })}\n\n`);
  }, 30000);

  // Clean up on disconnect
  req.on("close", () => {
    clearInterval(containerLogInterval);
    clearInterval(heartbeat);
    if (userAppLogProcess) {
      userAppLogProcess.kill();
    }
  });
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
    // Proxy to user app
    userAppProxy(req, res, next);
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Container API + Proxy server running on port ${PORT}`);
  console.log(`📡 Container API available at: /_container/*`);
  console.log(`🎯 User app proxied from: http://localhost:${USER_APP_PORT}`);
});
