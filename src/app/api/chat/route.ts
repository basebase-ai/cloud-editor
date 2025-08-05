import { google } from "@ai-sdk/google";
import { streamText, tool, stepCountIs } from "ai";
import { z } from "zod";

// Types for tool status events
interface ToolStartEvent {
  toolName: string;
  args: Record<string, unknown>;
}

interface ToolCompleteEvent {
  toolName: string;
  result: Record<string, unknown>;
}

interface ToolErrorEvent {
  toolName: string;
  error: Error;
}

// Event emitter for tool status messages
class ToolStatusEmitter {
  private listeners: { [key: string]: ((data: unknown) => void)[] } = {};

  emit(
    event: string,
    data: ToolStartEvent | ToolCompleteEvent | ToolErrorEvent
  ) {
    if (this.listeners[event]) {
      this.listeners[event].forEach((listener) => listener(data));
    }
  }

  on(event: string, listener: (data: unknown) => void) {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(listener);
  }
}

// Generate status messages for different tools
function getToolStartMessage(
  toolName: string,
  args: Record<string, unknown>
): string {
  switch (toolName) {
    case "list_files":
      const path = (args.path as string | undefined) || ".";
      return `🔍 Listing files in ${path}\n`;
    case "read_file":
      const readPath = (args.path as string | undefined) || "";
      return `📁 Reading ${readPath}\n`;
    case "write_file":
      const writePath = (args.path as string | undefined) || "";
      return `📝 Writing to ${writePath}\n`;
    case "grep_files":
      const pattern = (args.pattern as string | undefined) || "";
      return `🔎 Searching for '${pattern}'\n`;
    case "run_linter":
      return `🔧 Running linter\n`;
    case "check_status":
      return `⚡ Checking WebContainer status\n`;
    case "replace_lines":
      const replacePath = (args.path as string | undefined) || "";
      return `🔧 Replacing text in ${replacePath}\n`;
    case "delete_file":
      const deleteFilePath = (args.path as string | undefined) || "";
      return `🗑️ Deleting ${deleteFilePath}\n`;
    case "run_command":
      const cmd = (args.command as string | undefined) || "";
      const cmdArgs = (args.args as string[] | undefined) || [];
      return `💻 Running: ${cmd} ${cmdArgs.join(" ")}\n`;
    default:
      return `🔄 Running ${toolName}\n`;
  }
}

function getToolResultMessage(
  toolName: string,
  result: Record<string, unknown>
): string {
  switch (toolName) {
    case "list_files":
      const files = result.files as unknown[] | undefined;
      const fileCount = files?.length || 0;
      return `Found ${fileCount} items\n`;
    case "read_file":
      const lines = (result.lines as number | undefined) || 0;
      const path = (result.path as string | undefined) || "";
      return `Read ${lines} lines from ${path}\n`;
    case "write_file":
      const success = result.success as boolean | undefined;
      const writeResultPath = (result.path as string | undefined) || "";
      return success
        ? `✓ Written ${writeResultPath}\n`
        : `❌ Failed to write ${writeResultPath}\n`;
    case "grep_files":
      const results = result.results as unknown[] | undefined;
      const matches = results?.length || 0;
      const pattern = (result.pattern as string | undefined) || "";
      return `Found ${matches} matches for '${pattern}'\n`;
    case "run_linter":
      const errors = result.errors as unknown[] | undefined;
      const warnings = result.warnings as unknown[] | undefined;
      const errorCount = errors?.length || 0;
      const warningCount = warnings?.length || 0;
      return `Linter found ${errorCount} errors, ${warningCount} warnings\n`;
    case "check_status":
      const error = result.error as boolean | string | undefined;
      return error
        ? `❌ Status check failed\n`
        : `✓ WebContainer status checked\n`;
    case "replace_lines":
      const replaceSuccess = result.success as boolean | undefined;
      const replacePath = (result.path as string | undefined) || "";
      const originalLength = result.originalLength as number | undefined;
      const newLength = result.newLength as number | undefined;
      if (replaceSuccess) {
        const lengthChange =
          originalLength && newLength
            ? ` (${originalLength} → ${newLength} chars)`
            : "";
        return `✓ Replaced text in ${replacePath}${lengthChange}\n`;
      } else {
        return `❌ Failed to replace text in ${replacePath}\n`;
      }
    case "delete_file":
      const deleteSuccess = result.success as boolean | undefined;
      const deleteResultPath = (result.path as string | undefined) || "";
      return deleteSuccess
        ? `✓ Deleted ${deleteResultPath}\n`
        : `❌ Failed to delete ${deleteResultPath}\n`;
    case "run_command":
      const commandSuccess = result.success as boolean | undefined;
      const commandName = (result.command as string | undefined) || "";
      const exitCode = result.exitCode as number | undefined;
      if (commandSuccess) {
        return `✓ Command completed: ${commandName}\n`;
      } else {
        return `❌ Command failed: ${commandName} (exit code: ${exitCode})\n`;
      }
    default:
      return `✓ ${toolName} completed\n`;
  }
}

// Wrap a tool to emit status messages
function wrapToolWithStatus(
  originalTool: unknown,
  toolName: string,
  statusEmitter: ToolStatusEmitter
) {
  const tool = originalTool as {
    execute: (...args: unknown[]) => Promise<Record<string, unknown>>;
  };
  return {
    ...tool,
    execute: async (...args: unknown[]) => {
      // Extract the first argument which should contain the parameters
      const params = args[0] as Record<string, unknown>;

      // Emit start status
      statusEmitter.emit("toolStart", { toolName, args: params });

      try {
        const result = await tool.execute(...args);

        // Check if the result indicates a failure (many tools return errors in result rather than throwing)
        const hasError =
          result.error ||
          result.success === false ||
          (result.type && result.error) ||
          // Also check for specific tool failure patterns
          (result.message &&
            typeof result.message === "string" &&
            result.message.includes("❌")) ||
          (result.message &&
            typeof result.message === "string" &&
            result.message.includes("Failed"));

        if (hasError) {
          // Create an error object from the result for the status message
          const errorMessage =
            (result.error as string) ||
            (result.message as string) ||
            "Tool execution failed";
          const error = new Error(errorMessage);

          // Emit error status so user sees the failure in chat
          statusEmitter.emit("toolError", { toolName, error });
        } else {
          // Emit completion status for successful results
          statusEmitter.emit("toolComplete", { toolName, result });
        }

        // Always return the result so the AI agent can process it and explain any errors
        return result;
      } catch (error) {
        // Emit error status for unexpected errors (actual exceptions)
        statusEmitter.emit("toolError", { toolName, error: error as Error });
        throw error;
      }
    },
  };
}

// WebContainer bridge - simple HTTP-based communication for now
async function callWebContainer(
  action: string,
  params: Record<string, unknown>
): Promise<Record<string, unknown>> {
  try {
    const response = await fetch(
      `${
        process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
      }/api/webcontainer`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, params }),
      }
    );

    if (!response.ok) {
      throw new Error(`WebContainer call failed: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error(`WebContainer ${action} failed:`, error);
    throw error;
  }
}

// Mock WebContainer tools - these would interact with the actual WebContainer instance
const listFilesTool = tool({
  description: "List files and directories in the project",
  inputSchema: z.object({
    path: z
      .string()
      .describe("Path to list (default: current directory)")
      .default("."),
  }),
  execute: async ({ path }) => {
    console.log(`[Tool] list_files called with path: ${path}`);
    try {
      const result = await callWebContainer("listFiles", { path });
      console.log(`[Tool] list_files result:`, result);
      const typedResult = result as {
        files: { name: string; type: string }[];
        path: string;
      };
      return {
        files: typedResult.files.map((f) =>
          f.type === "directory" ? `${f.name}/` : f.name
        ),
        path: typedResult.path,
        type: "list_files",
      };
    } catch (error) {
      console.error(`[Tool] list_files error:`, error);
      return {
        files: [],
        path,
        type: "list_files",
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
});

const readFileTool = tool({
  description: "Read the contents of a file",
  inputSchema: z.object({
    path: z.string().describe("Path to the file to read"),
  }),
  execute: async ({ path }) => {
    console.log(`[Tool] read_file called with path: ${path}`);
    try {
      const result = await callWebContainer("readFile", { path });
      console.log(`[Tool] read_file result:`, result);
      const typedResult = result as { content: string; path: string };
      return {
        content: typedResult.content,
        path: typedResult.path,
        lines: typedResult.content.split("\n").length,
        type: "read_file",
      };
    } catch (error) {
      console.error(`[Tool] read_file error:`, error);
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      return {
        content: `❌ Could not read file: ${errorMessage}`,
        path,
        lines: 0,
        type: "read_file",
        error: errorMessage,
      };
    }
  },
});

const writeFileTool = tool({
  description:
    "Write content to a file. Creates a new file if it doesn't exist, or replaces the entire contents of an existing file. Automatically creates parent directories if needed.",
  inputSchema: z.object({
    path: z
      .string()
      .describe(
        "Path to the file to write (e.g., 'src/components/NewComponent.tsx')"
      ),
    content: z.string().describe("Complete content to write to the file"),
  }),
  execute: async ({ path, content }) => {
    console.log(
      `[Tool] write_file called with path: ${path}, content length: ${content.length}`
    );
    try {
      const result = await callWebContainer("writeFile", { path, content });
      console.log(`[Tool] write_file result:`, result);
      return {
        success: result.success,
        path: result.path,
        message: `File ${path} written successfully`,
        contentLength: content.length,
        type: "write_file",
      };
    } catch (error) {
      console.error(`[Tool] write_file error:`, error);
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      return {
        success: false,
        path,
        message: `❌ Failed to write file ${path}: ${errorMessage}`,
        contentLength: content.length,
        type: "write_file",
        error: errorMessage,
      };
    }
  },
});

const grepFilesTool = tool({
  description: "Search for text patterns in files",
  inputSchema: z.object({
    pattern: z.string().describe("Search pattern or regex"),
    files: z
      .string()
      .optional()
      .describe("File pattern to search in (default: all files)"),
  }),
  execute: async ({ pattern, files = "*" }) => {
    console.log(
      `[Tool] grep_files called with pattern: ${pattern}, files: ${files}`
    );
    try {
      const result = await callWebContainer("searchFiles", { pattern, files });
      console.log(`[Tool] grep_files result:`, result);
      return {
        results: result.results,
        pattern: result.pattern,
        filesSearched: result.filesSearched,
        type: "grep_files",
      };
    } catch (error) {
      console.error(`[Tool] grep_files error:`, error);
      return {
        results: [],
        pattern,
        filesSearched: files,
        type: "grep_files",
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
});

const runLinterTool = tool({
  description: "Run linter on the project files",
  inputSchema: z.object({
    files: z
      .string()
      .optional()
      .describe("Specific files to lint (default: all)"),
  }),
  execute: async ({ files = "all" }) => {
    // This would interact with the WebContainer API to run linting
    // For now, return mock linter results
    console.log(`[Tool] run_linter called with files: ${files}`);
    const result = {
      errors: [],
      warnings: [
        {
          file: "src/index.js",
          line: 10,
          message: "Unused variable: unusedVar",
          rule: "no-unused-vars",
        },
      ],
      filesLinted: files,
      type: "run_linter",
    };
    console.log(`[Tool] run_linter result:`, result);
    return result;
  },
});

const checkStatusTool = tool({
  description: "Check WebContainer status, running processes, and project info",
  inputSchema: z.object({}),
  execute: async () => {
    console.log(`[Tool] check_status called`);
    try {
      const result = await callWebContainer("checkStatus", {});
      console.log(`[Tool] check_status result:`, result);
      return {
        type: "check_status",
        ...result,
      };
    } catch (error) {
      console.error(`[Tool] check_status error:`, error);
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      return {
        type: "check_status",
        error: errorMessage,
        message: `❌ Could not check status: ${errorMessage}`,
      };
    }
  },
});

const checkBuildErrorsTool = tool({
  description:
    "Check for current build errors and compilation issues in the development server. Use this after making file changes to see if there are any errors that need to be fixed.",
  inputSchema: z.object({}),
  execute: async () => {
    console.log(`[Tool] check_build_errors called`);
    try {
      const result = await callWebContainer("getBuildErrors", {});
      console.log(`[Tool] check_build_errors result:`, result);
      const errors = (result.errors as string[]) || [];
      return {
        type: "check_build_errors",
        errors,
        hasErrors: errors.length > 0,
        message:
          errors.length > 0
            ? `❌ Found ${errors.length} build error(s): ${errors.join(" | ")}`
            : "✅ No build errors found",
      };
    } catch (error) {
      console.error(`[Tool] check_build_errors error:`, error);
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      return {
        type: "check_build_errors",
        error: errorMessage,
        message: `❌ Could not check build errors: ${errorMessage}`,
      };
    }
  },
});

const deleteFileTool = tool({
  description:
    "Delete a file from the project. Use with caution as this cannot be undone.",
  inputSchema: z.object({
    path: z.string().describe("Path to the file to delete"),
  }),
  execute: async ({ path }) => {
    console.log(`[Tool] delete_file called with path: ${path}`);
    try {
      const result = await callWebContainer("deleteFile", { path });
      console.log(`[Tool] delete_file result:`, result);
      return {
        success: result.success,
        path: result.path,
        message: `File ${path} deleted successfully`,
        type: "delete_file",
      };
    } catch (error) {
      console.error(`[Tool] delete_file error:`, error);
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      return {
        success: false,
        path,
        message: `❌ Failed to delete file ${path}: ${errorMessage}`,
        type: "delete_file",
        error: errorMessage,
      };
    }
  },
});

const runCommandTool = tool({
  description:
    "Execute a command in the WebContainer environment. Can run any Linux command like npm, git, ls, etc.",
  inputSchema: z.object({
    command: z
      .string()
      .describe("The command to execute (e.g., 'npm', 'ls', 'git')"),
    args: z
      .array(z.string())
      .optional()
      .describe(
        "Command arguments as an array (e.g., ['run', 'dev'] for 'npm run dev')"
      ),
  }),
  execute: async ({ command, args = [] }) => {
    console.log(`[Tool] run_command called: ${command} ${args.join(" ")}`);
    try {
      const result = await callWebContainer("runCommand", { command, args });
      console.log(`[Tool] run_command result:`, result);
      const typedResult = result as {
        success: boolean;
        exitCode: number;
        output: string;
        command: string;
        message: string;
      };
      return {
        success: typedResult.success,
        exitCode: typedResult.exitCode,
        output: typedResult.output,
        command: typedResult.command,
        message: typedResult.message,
        type: "run_command",
      };
    } catch (error) {
      console.error(`[Tool] run_command error:`, error);
      return {
        success: false,
        exitCode: -1,
        output: "",
        command: `${command} ${args.join(" ")}`,
        message: `❌ Failed to execute command: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
        type: "run_command",
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
});

const replaceLinesTool = tool({
  description:
    "Replace multi-line text blocks in a file with new content. More efficient than rewriting entire files when making targeted changes. IMPORTANT: If this fails, you should read the file first to understand its current state before trying again.",
  inputSchema: z.object({
    path: z.string().describe("Path to the file to modify"),
    query: z
      .string()
      .describe(
        "The exact multi-line text to find and replace (must match exactly including whitespace)"
      ),
    replacement: z
      .string()
      .describe("The new text to replace the query text with"),
  }),
  execute: async ({ path, query, replacement }) => {
    console.log(
      `[Tool] replace_lines called with path: ${path}, query length: ${query.length}, replacement length: ${replacement.length}`
    );
    try {
      const result = await callWebContainer("replaceLines", {
        path,
        query,
        replacement,
      });
      console.log(`[Tool] replace_lines result:`, result);
      const typedResult = result as {
        success: boolean;
        path: string;
        message: string;
        originalLength?: number;
        newLength?: number;
      };
      return {
        success: typedResult.success,
        path: typedResult.path,
        message: typedResult.message,
        originalLength: typedResult.originalLength,
        newLength: typedResult.newLength,
        type: "replace_lines",
      };
    } catch (error) {
      console.error(`[Tool] replace_lines error:`, error);
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      return {
        success: false,
        path,
        message: `❌ Failed to replace lines in ${path}: ${errorMessage}. You should read the file first to see its current content before trying again.`,
        type: "replace_lines",
        error: errorMessage,
        suggestion: `Use read_file tool to examine ${path} and understand why the query text wasn't found, then try again with the correct text.`,
      };
    }
  },
});

export async function POST(req: Request) {
  try {
    const { messages } = await req.json();

    if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
      return new Response("GOOGLE_GENERATIVE_AI_API_KEY is not configured", {
        status: 500,
      });
    }

    console.log(
      `[Chat API] Starting streamText with ${messages.length} messages`
    );

    // Create a stream controller that can be used to send messages immediately
    let streamController: ReadableStreamDefaultController<Uint8Array> | null =
      null;

    // Create status emitter that writes directly to stream
    const statusEmitter = new ToolStatusEmitter();

    // Listen for tool events and write status messages immediately to stream
    statusEmitter.on("toolStart", (data: unknown) => {
      const { toolName, args } = data as ToolStartEvent;
      const message = getToolStartMessage(toolName, args);
      console.log(`[Tool Status] ${toolName} starting:`, args);

      // Write immediately to stream if controller is available
      if (streamController) {
        streamController.enqueue(new TextEncoder().encode(message));
      }
    });

    statusEmitter.on("toolComplete", (data: unknown) => {
      const { toolName, result } = data as ToolCompleteEvent;
      const message = getToolResultMessage(toolName, result);
      console.log(`[Tool Status] ${toolName} completed:`, result);

      // Write immediately to stream if controller is available
      if (streamController) {
        streamController.enqueue(new TextEncoder().encode(message));
      }
    });

    statusEmitter.on("toolError", (data: unknown) => {
      const { toolName, error } = data as ToolErrorEvent;
      const message = `❌ ${toolName} failed: ${error.message}\n`;
      console.log(`[Tool Status] ${toolName} error:`, error);

      // Write immediately to stream if controller is available
      if (streamController) {
        streamController.enqueue(new TextEncoder().encode(message));
      }
    });

    // Wrap tools with status emission
    const enhancedTools = {
      list_files: wrapToolWithStatus(
        listFilesTool,
        "list_files",
        statusEmitter
      ),
      read_file: wrapToolWithStatus(readFileTool, "read_file", statusEmitter),
      write_file: wrapToolWithStatus(
        writeFileTool,
        "write_file",
        statusEmitter
      ),
      delete_file: wrapToolWithStatus(
        deleteFileTool,
        "delete_file",
        statusEmitter
      ),
      run_command: wrapToolWithStatus(
        runCommandTool,
        "run_command",
        statusEmitter
      ),
      grep_files: wrapToolWithStatus(
        grepFilesTool,
        "grep_files",
        statusEmitter
      ),
      run_linter: wrapToolWithStatus(
        runLinterTool,
        "run_linter",
        statusEmitter
      ),
      check_status: wrapToolWithStatus(
        checkStatusTool,
        "check_status",
        statusEmitter
      ),
      check_build_errors: wrapToolWithStatus(
        checkBuildErrorsTool,
        "check_build_errors",
        statusEmitter
      ),
      replace_lines: wrapToolWithStatus(
        replaceLinesTool,
        "replace_lines",
        statusEmitter
      ),
    };

    // Create custom stream that provides immediate status updates
    const customStream = new ReadableStream({
      async start(controller) {
        // Make controller available for immediate status message writing
        streamController = controller;

        try {
          const result = await streamText({
            model: google("gemini-1.5-pro"),
            messages,
            tools: enhancedTools,
            system: `You are an AI coding assistant operating within a WebContainer environment. 

IMPORTANT: When a user makes their first request, ALWAYS start by gathering project context:
1. Use list_files to see the project structure
2. Read the README.md if it exists to understand the project
3. Check package.json to understand the tech stack
4. Then proceed with the user's request

You can help users with their code by:
1. Analyzing their project structure using list_files
2. Reading specific files using read_file  
3. Writing complete file contents using write_file (creates new files or replaces entire file contents)
4. Deleting files using delete_file (use with caution - cannot be undone)
5. Making targeted changes using replace_lines (more efficient for specific text replacements)
6. Running any Linux command using run_command (npm, git, ls, ps, kill, etc.)
7. Searching for patterns using grep_files
8. Running linting to check code quality using run_linter
9. Checking WebContainer status and debugging with check_status
10. Checking for build errors using check_build_errors (IMPORTANT: use this after making file changes)

When working with files:
- Use write_file to create new files or completely replace the contents of existing files
- Use replace_lines for targeted changes when you need to replace specific multi-line blocks within existing files
- replace_lines is more efficient and safer for making precise changes to existing code
- write_file will overwrite the entire file, so use it when you need to rewrite substantial portions or create new files

When working with commands:
- Use run_command to execute any Linux command in the WebContainer environment
- Examples: run_command("npm", ["install", "package-name"]), run_command("ls", ["-la"]), run_command("git", ["status"])
- To restart dev server: run_command("pkill", ["-f", "npm"]) then run_command("npm", ["run", "dev"])
- To install packages: run_command("npm", ["install", "package-name"])
- To run tests: run_command("npm", ["test"])
- The command will return exit code, output, and success status

Never ask users for basic project information - always explore the codebase first to understand the context, then provide informed assistance.

IMPORTANT ERROR HANDLING:
- If any tool call fails (you'll see error messages in the chat), STOP your current approach immediately
- Explain to the user what went wrong and why the tool failed
- Before trying the same operation again, read the relevant files to understand the current state
- Consider alternative approaches if the original method isn't working
- Don't continue with multi-step plans if an earlier step failed - address the failure first

CRITICAL: After writing or modifying any files, ALWAYS use check_build_errors to verify there are no compilation errors:
- If you write/modify files and don't check for build errors, you're not completing your task properly
- Build errors must be fixed before considering a task complete
- Explain any build errors to the user and fix them immediately
- Never leave the user with broken code that won't compile

REQUIRED: Always provide a clear summary when you complete work:
- After making any file changes, summarize what you changed and why
- If you created new files, explain what they do and how they fit into the project
- If you fixed issues, explain what was broken and how you fixed it
- If there were build errors, confirm they are resolved
- End with a clear statement of what the user can expect to see/do next
- Never finish without explaining your work to the user

Always be thorough and methodical in your approach. Break down complex requests into smaller steps.
`,
            stopWhen: stepCountIs(20),
            experimental_telemetry: {
              isEnabled: true,
              functionId: "webcontainer-tools",
            },
          });

          // Stream AI response chunks
          for await (const chunk of result.textStream) {
            controller.enqueue(new TextEncoder().encode(chunk));
          }
        } catch (error) {
          console.error("Stream error:", error);
          controller.enqueue(
            new TextEncoder().encode(
              `Error: ${
                error instanceof Error ? error.message : "Unknown error"
              }\n`
            )
          );
        } finally {
          controller.close();
          streamController = null;
        }
      },
    });

    console.log(
      `[Chat API] StreamText setup complete, returning enhanced response`
    );

    return new Response(customStream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("Chat API error:", error);
    return new Response("Internal server error", { status: 500 });
  }
}

export const runtime = "edge";
