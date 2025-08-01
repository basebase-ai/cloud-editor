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

  emit(event: string, data: ToolStartEvent | ToolCompleteEvent | ToolErrorEvent) {
    if (this.listeners[event]) {
      this.listeners[event].forEach(listener => listener(data));
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
function getToolStartMessage(toolName: string, args: Record<string, unknown>): string {
  switch (toolName) {
    case 'list_files':
      const path = args.path as string | undefined || '.';
      return `🔍 Listing files in ${path}\n`;
    case 'read_file':
      const readPath = args.path as string | undefined || '';
      return `📁 Reading ${readPath}\n`;
    case 'edit_file':
      const editPath = args.path as string | undefined || '';
      return `📝 Writing to ${editPath}\n`;
    case 'grep_files':
      const pattern = args.pattern as string | undefined || '';
      return `🔎 Searching for '${pattern}'\n`;
    case 'run_linter':
      return `🔧 Running linter\n`;
    case 'check_status':
      return `⚡ Checking WebContainer status\n`;
    case 'replace_lines':
      const replacePath = args.path as string | undefined || '';
      return `🔧 Replacing text in ${replacePath}\n`;
    default:
      return `🔄 Running ${toolName}\n`;
  }
}

function getToolResultMessage(toolName: string, result: Record<string, unknown>): string {
  switch (toolName) {
    case 'list_files':
      const files = result.files as unknown[] | undefined;
      const fileCount = files?.length || 0;
      return `Found ${fileCount} items\n`;
    case 'read_file':
      const lines = result.lines as number | undefined || 0;
      const path = result.path as string | undefined || '';
      return `Read ${lines} lines from ${path}\n`;
    case 'edit_file':
      const success = result.success as boolean | undefined;
      const editPath = result.path as string | undefined || '';
      return success ? `✓ Updated ${editPath}\n` : `❌ Failed to update ${editPath}\n`;
    case 'grep_files':
      const results = result.results as unknown[] | undefined;
      const matches = results?.length || 0;
      const pattern = result.pattern as string | undefined || '';
      return `Found ${matches} matches for '${pattern}'\n`;
    case 'run_linter':
      const errors = result.errors as unknown[] | undefined;
      const warnings = result.warnings as unknown[] | undefined;
      const errorCount = errors?.length || 0;
      const warningCount = warnings?.length || 0;
      return `Linter found ${errorCount} errors, ${warningCount} warnings\n`;
    case 'check_status':
      const error = result.error as boolean | string | undefined;
      return error ? `❌ Status check failed\n` : `✓ WebContainer status checked\n`;
    case 'replace_lines':
      const replaceSuccess = result.success as boolean | undefined;
      const replacePath = result.path as string | undefined || '';
      const originalLength = result.originalLength as number | undefined;
      const newLength = result.newLength as number | undefined;
      if (replaceSuccess) {
        const lengthChange = originalLength && newLength ? ` (${originalLength} → ${newLength} chars)` : '';
        return `✓ Replaced text in ${replacePath}${lengthChange}\n`;
      } else {
        return `❌ Failed to replace text in ${replacePath}\n`;
      }
    default:
      return `✓ ${toolName} completed\n`;
  }
}

// Wrap a tool to emit status messages
function wrapToolWithStatus(originalTool: unknown, toolName: string, statusEmitter: ToolStatusEmitter) {
  const tool = originalTool as { execute: (...args: unknown[]) => Promise<Record<string, unknown>> };
  return {
    ...tool,
    execute: async (...args: unknown[]) => {
      // Extract the first argument which should contain the parameters
      const params = args[0] as Record<string, unknown>;
      
      // Emit start status
      statusEmitter.emit('toolStart', { toolName, args: params });
      
      try {
        const result = await tool.execute(...args);
        
        // Emit completion status
        statusEmitter.emit('toolComplete', { toolName, result });
        
        return result;
      } catch (error) {
        // Emit error status
        statusEmitter.emit('toolError', { toolName, error: error as Error });
        throw error;
      }
    }
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

const editFileTool = tool({
  description: "Edit or create a file with new content",
  inputSchema: z.object({
    path: z.string().describe("Path to the file to edit"),
    content: z.string().describe("New content for the file"),
  }),
  execute: async ({ path, content }) => {
    console.log(
      `[Tool] edit_file called with path: ${path}, content length: ${content.length}`
    );
    try {
      const result = await callWebContainer("writeFile", { path, content });
      console.log(`[Tool] edit_file result:`, result);
      return {
        success: result.success,
        path: result.path,
        message: `File ${path} updated successfully`,
        contentLength: content.length,
        type: "edit_file",
      };
    } catch (error) {
      console.error(`[Tool] edit_file error:`, error);
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      return {
        success: false,
        path,
        message: `❌ Failed to update file ${path}: ${errorMessage}`,
        contentLength: content.length,
        type: "edit_file",
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

const replaceLinesTool = tool({
  description: "Replace multi-line text blocks in a file with new content. More efficient than rewriting entire files when making targeted changes.",
  inputSchema: z.object({
    path: z.string().describe("Path to the file to modify"),
    query: z.string().describe("The exact multi-line text to find and replace (must match exactly including whitespace)"),
    replacement: z.string().describe("The new text to replace the query text with"),
  }),
  execute: async ({ path, query, replacement }) => {
    console.log(`[Tool] replace_lines called with path: ${path}, query length: ${query.length}, replacement length: ${replacement.length}`);
    try {
      const result = await callWebContainer("replaceLines", { path, query, replacement });
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
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return {
        success: false,
        path,
        message: `❌ Failed to replace lines in ${path}: ${errorMessage}`,
        type: "replace_lines",
        error: errorMessage,
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
    let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;

    // Create status emitter that writes directly to stream
    const statusEmitter = new ToolStatusEmitter();

    // Listen for tool events and write status messages immediately to stream
    statusEmitter.on('toolStart', (data: unknown) => {
      const { toolName, args } = data as ToolStartEvent;
      const message = getToolStartMessage(toolName, args);
      console.log(`[Tool Status] ${toolName} starting:`, args);
      
      // Write immediately to stream if controller is available
      if (streamController) {
        streamController.enqueue(new TextEncoder().encode(message));
      }
    });

    statusEmitter.on('toolComplete', (data: unknown) => {
      const { toolName, result } = data as ToolCompleteEvent;
      const message = getToolResultMessage(toolName, result);
      console.log(`[Tool Status] ${toolName} completed:`, result);
      
      // Write immediately to stream if controller is available
      if (streamController) {
        streamController.enqueue(new TextEncoder().encode(message));
      }
    });

    statusEmitter.on('toolError', (data: unknown) => {
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
      list_files: wrapToolWithStatus(listFilesTool, 'list_files', statusEmitter),
      read_file: wrapToolWithStatus(readFileTool, 'read_file', statusEmitter),
      edit_file: wrapToolWithStatus(editFileTool, 'edit_file', statusEmitter),
      grep_files: wrapToolWithStatus(grepFilesTool, 'grep_files', statusEmitter),
      run_linter: wrapToolWithStatus(runLinterTool, 'run_linter', statusEmitter),
      check_status: wrapToolWithStatus(checkStatusTool, 'check_status', statusEmitter),
      replace_lines: wrapToolWithStatus(replaceLinesTool, 'replace_lines', statusEmitter),
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
3. Making code changes using edit_file (for complete file rewrites)
4. Making targeted changes using replace_lines (more efficient for specific text replacements)
5. Searching for patterns using grep_files
6. Running linting to check code quality using run_linter
7. Checking WebContainer status and debugging with check_status

When editing files:
- Use replace_lines for targeted changes when you need to replace specific multi-line blocks
- Use edit_file for complete file overwrites or when creating new files
- replace_lines is more efficient and safer for making precise changes to existing code

Never ask users for basic project information - always explore the codebase first to understand the context, then provide informed assistance.

Always be thorough and methodical in your approach. Break down complex requests into smaller steps.
`,
            stopWhen: stepCountIs(5),
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
          controller.enqueue(new TextEncoder().encode(`Error: ${error instanceof Error ? error.message : 'Unknown error'}\n`));
        } finally {
          controller.close();
          streamController = null;
        }
      },
    });

    console.log(`[Chat API] StreamText setup complete, returning enhanced response`);

    return new Response(customStream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    console.error("Chat API error:", error);
    return new Response("Internal server error", { status: 500 });
  }
}

export const runtime = "edge";
