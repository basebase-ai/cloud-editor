const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");

const app = express();
const PORT = process.env.RAILWAY_CONTAINER_API_PORT || 3001;
const WORKSPACE_DIR = "/workspace";

app.use(cors());
app.use(express.json());

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Read file
app.post("/api/read_file", (req, res) => {
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
app.post("/api/write_file", (req, res) => {
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
app.post("/api/list_files", (req, res) => {
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
app.post("/api/run_command", (req, res) => {
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
app.post("/api/restart_server", (req, res) => {
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
app.get("/api/logs", (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const recentLogs = logBuffer.slice(-limit);
    res.json({ success: true, logs: recentLogs });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// Stream logs via Server-Sent Events (combines container logs + user app logs)
app.get("/api/logs/stream", (req, res) => {
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

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Container API server running on port ${PORT}`);
});
