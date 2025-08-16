// Container API Template
// This file should be deployed to Railway containers to handle AI agent tool requests

const express = require("express");
const fs = require("fs").promises;
const path = require("path");
const { spawn } = require("child_process");

const app = express();
const port = process.env.RAILWAY_CONTAINER_API_PORT || 3001;

app.use(express.json());

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "healthy", timestamp: new Date().toISOString() });
});

// Main tool API endpoint
app.post("/api/tools", async (req, res) => {
  try {
    const { action, params } = req.body;

    console.log(`[Container API] Received action: ${action}`, params);

    let result;

    switch (action) {
      case "listFiles":
        result = await listFiles(params.path || ".");
        break;

      case "readFile":
        result = await readFile(params.path);
        break;

      case "writeFile":
        result = await writeFile(params.path, params.content);
        break;

      case "deleteFile":
        result = await deleteFile(params.path);
        break;

      case "searchFiles":
        result = await searchFiles(params.pattern, params.files);
        break;

      case "runCommand":
        result = await runCommand(params.command, params.args);
        break;

      case "replaceLines":
        result = await replaceLines(
          params.path,
          params.query,
          params.replacement
        );
        break;

      case "checkStatus":
        result = await checkStatus();
        break;

      case "restartServer":
        result = await restartServer();
        break;

      default:
        throw new Error(`Unknown action: ${action}`);
    }

    res.json(result);
  } catch (error) {
    console.error(`[Container API] Error:`, error);
    res.status(500).json({
      error: error.message,
      success: false,
    });
  }
});

async function listFiles(dirPath) {
  try {
    const fullPath = path.resolve(dirPath);
    const entries = await fs.readdir(fullPath, { withFileTypes: true });

    const files = entries.map((entry) => ({
      name: entry.name,
      type: entry.isDirectory() ? "directory" : "file",
    }));

    return {
      files,
      path: dirPath,
      success: true,
    };
  } catch (error) {
    return {
      files: [],
      path: dirPath,
      error: error.message,
      success: false,
    };
  }
}

async function readFile(filePath) {
  try {
    const fullPath = path.resolve(filePath);
    const content = await fs.readFile(fullPath, "utf-8");

    return {
      content,
      path: filePath,
      success: true,
    };
  } catch (error) {
    return {
      content: null,
      path: filePath,
      error: error.message,
      success: false,
    };
  }
}

async function writeFile(filePath, content) {
  try {
    const fullPath = path.resolve(filePath);
    const dir = path.dirname(fullPath);

    // Create directory if it doesn't exist
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(fullPath, content, "utf-8");

    return {
      path: filePath,
      success: true,
    };
  } catch (error) {
    return {
      path: filePath,
      error: error.message,
      success: false,
    };
  }
}

async function deleteFile(filePath) {
  try {
    const fullPath = path.resolve(filePath);
    await fs.unlink(fullPath);

    return {
      path: filePath,
      success: true,
    };
  } catch (error) {
    return {
      path: filePath,
      error: error.message,
      success: false,
    };
  }
}

async function searchFiles(pattern, filePattern = "*") {
  // Simple grep implementation
  const results = [];

  try {
    const searchDir = async (dir) => {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (
          entry.isDirectory() &&
          !entry.name.startsWith(".") &&
          entry.name !== "node_modules"
        ) {
          await searchDir(fullPath);
        } else if (entry.isFile() && isTextFile(entry.name)) {
          try {
            const content = await fs.readFile(fullPath, "utf-8");
            const lines = content.split("\n");

            lines.forEach((line, index) => {
              if (line.includes(pattern)) {
                results.push({
                  file: fullPath,
                  line: index + 1,
                  content: line.trim(),
                  match: pattern,
                });
              }
            });
          } catch (err) {
            // Skip files that can't be read
          }
        }
      }
    };

    await searchDir(".");

    return {
      results,
      pattern,
      filesSearched: filePattern,
      success: true,
    };
  } catch (error) {
    return {
      results: [],
      pattern,
      error: error.message,
      success: false,
    };
  }
}

function isTextFile(filename) {
  const textExtensions = [
    ".js",
    ".jsx",
    ".ts",
    ".tsx",
    ".json",
    ".html",
    ".css",
    ".scss",
    ".md",
    ".txt",
    ".xml",
    ".svg",
    ".vue",
    ".yaml",
    ".yml",
    ".toml",
  ];
  return textExtensions.some((ext) => filename.toLowerCase().endsWith(ext));
}

async function runCommand(command, args = []) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      shell: true,
    });

    let output = "";
    let errorOutput = "";

    child.stdout.on("data", (data) => {
      output += data.toString();
    });

    child.stderr.on("data", (data) => {
      errorOutput += data.toString();
    });

    child.on("close", (code) => {
      resolve({
        success: code === 0,
        exitCode: code,
        output: output.trim(),
        error: errorOutput.trim(),
        command: `${command} ${args.join(" ")}`,
      });
    });

    child.on("error", (error) => {
      resolve({
        success: false,
        exitCode: -1,
        output: "",
        error: error.message,
        command: `${command} ${args.join(" ")}`,
      });
    });
  });
}

async function replaceLines(filePath, query, replacement) {
  try {
    const fullPath = path.resolve(filePath);
    const content = await fs.readFile(fullPath, "utf-8");

    if (!content.includes(query)) {
      return {
        success: false,
        path: filePath,
        error: "Query text not found in file",
      };
    }

    const newContent = content.replace(query, replacement);

    if (newContent === content) {
      return {
        success: false,
        path: filePath,
        message: "No changes made - replacement text identical to original",
      };
    }

    await fs.writeFile(fullPath, newContent, "utf-8");

    return {
      success: true,
      path: filePath,
      originalLength: content.length,
      newLength: newContent.length,
    };
  } catch (error) {
    return {
      success: false,
      path: filePath,
      error: error.message,
    };
  }
}

async function checkStatus() {
  try {
    const cwd = process.cwd();

    // Check if package.json exists
    let packageInfo = "No package.json found";
    try {
      const packageJson = await fs.readFile("package.json", "utf-8");
      const pkg = JSON.parse(packageJson);
      packageInfo = `Package: ${pkg.name || "unnamed"} v${
        pkg.version || "unknown"
      }`;
    } catch {
      packageInfo = "Could not read package.json";
    }

    // List root directory
    const rootFiles = await fs.readdir(".", { withFileTypes: true });
    const fileList = rootFiles
      .map((item) => `${item.name}${item.isDirectory() ? "/" : ""}`)
      .join(", ");

    return {
      workdir: cwd,
      packageInfo,
      rootFiles: fileList,
      containerApi: "Running",
      success: true,
    };
  } catch (error) {
    return {
      error: error.message,
      success: false,
    };
  }
}

async function restartServer() {
  // This would need to be implemented based on the specific deployment setup
  // For now, just return a success message
  return {
    success: true,
    message:
      "Server restart requested (implementation depends on deployment setup)",
  };
}

app.listen(port, () => {
  console.log(`[Container API] Server running on port ${port}`);
  console.log(`[Container API] Health check: http://localhost:${port}/health`);
  console.log(
    `[Container API] Tools endpoint: http://localhost:${port}/api/tools`
  );
});

module.exports = app;
