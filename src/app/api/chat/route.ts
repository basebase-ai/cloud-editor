import { google } from "@ai-sdk/google";
import { streamText, tool, stepCountIs } from "ai";
import { z } from "zod";

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
      const fileList = typedResult.files.map((f) =>
        f.type === "directory" ? `${f.name}/` : f.name
      );
      return {
        files: fileList,
        path: typedResult.path,
        type: "list_files",
        message: `📁 Listed ${fileList.length} items in ${typedResult.path}`,
      };
    } catch (error) {
      console.error(`[Tool] list_files error:`, error);
      return {
        files: [],
        path,
        type: "list_files",
        error: error instanceof Error ? error.message : "Unknown error",
        message: `❌ Failed to list files in ${path}`,
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
      const lineCount = typedResult.content.split("\n").length;
      return {
        content: typedResult.content,
        path: typedResult.path,
        lines: lineCount,
        type: "read_file",
        message: `📁 Read ${lineCount} lines from ${typedResult.path}`,
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
        message: `❌ Failed to read ${path}: ${errorMessage}`,
      };
    }
  },
});

const writeFileTool = tool({
  description: "Write complete file contents (overwrites existing file)",
  inputSchema: z.object({
    path: z.string().describe("Path to the file to write"),
    content: z.string().describe("Complete content for the file"),
  }),
  execute: async ({ path, content }) => {
    console.log(
      `[Tool] write_file called with path: ${path}, content length: ${content.length}`
    );
    try {
      const result = await callWebContainer("writeFile", { path, content });
      console.log(`[Tool] write_file result:`, result);
      const lineCount = content.split("\n").length;
      return {
        success: result.success,
        path: result.path,
        message: `📝 Wrote ${path} (${lineCount} lines, ${content.length} characters)`,
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
        message: `❌ Failed to write ${path}: ${errorMessage}`,
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
      const typedResult = result as {
        results: Array<{
          file: string;
          line: number;
          content: string;
          match: string;
        }>;
        pattern: string;
        filesSearched: string;
      };
      const matchCount = typedResult.results.length;
      return {
        results: typedResult.results,
        pattern: typedResult.pattern,
        filesSearched: typedResult.filesSearched,
        type: "grep_files",
        message: `🔍 Found ${matchCount} matches for "${pattern}"`,
      };
    } catch (error) {
      console.error(`[Tool] grep_files error:`, error);
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      return {
        results: [],
        pattern,
        filesSearched: files,
        type: "grep_files",
        error: errorMessage,
        message: `❌ Search failed for "${pattern}": ${errorMessage}`,
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
        message: result.message || "🔧 WebContainer status checked",
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

    const result = await streamText({
      model: google("gemini-1.5-pro"),
      messages,
      tools: {
        list_files: listFilesTool,
        read_file: readFileTool,
        write_file: writeFileTool,
        grep_files: grepFilesTool,
        run_linter: runLinterTool,
        check_status: checkStatusTool,
      },
      system: `You are an AI coding assistant operating within a WebContainer environment. 
      
You can help users with their code by:
1. Analyzing their project structure using list_files
2. Reading specific files using read_file  
3. Writing complete file contents using write_file
4. Searching for patterns using grep_files
5. Running linting to check code quality using run_linter
6. Checking WebContainer status and debugging with check_status

When helping users:
- Take multiple steps to understand the codebase first
- Use tools to gather information before making changes
- Actually call the tools instead of just describing what you would do
- ALWAYS immediately output the 'message' field from each tool result to show progress to users
- If changes don't appear to take effect (like file edits not showing in the browser), use check_status to debug
- Be methodical and thorough

CRITICAL: When you need to modify a file, actually call the write_file tool with the complete file contents. Don't just show code examples - make real changes.

CRITICAL: After every tool call, immediately output the result's 'message' field. For example:
- After read_file: output the message like "📁 Read 45 lines from app/components/AuthPage.tsx" 
- After grep_files: output the message like "🔍 Found 2 matches for 'Sign In'"
- After write_file: output the message like "📝 Wrote app/components/AuthPage.tsx (89 lines, 2456 characters)"

MANTINE COLOR GUIDE: Use only these valid color keys for Button color and theme.primaryColor:
'dark', 'gray', 'red', 'pink', 'grape', 'violet', 'indigo', 'blue', 'cyan', 'green', 'lime', 'yellow', 'orange', 'teal'
Never use "purple" - use "grape" or "violet" instead.

Always be thorough and methodical in your approach. Break down complex requests into smaller steps and show your progress with brief tool announcements.
`,
      stopWhen: stepCountIs(5),
      experimental_telemetry: {
        isEnabled: true,
        functionId: "webcontainer-tools",
      },
    });

    console.log(`[Chat API] StreamText completed, returning response`);

    return result.toTextStreamResponse();
  } catch (error) {
    console.error("Chat API error:", error);
    return new Response("Internal server error", { status: 500 });
  }
}

export const runtime = "edge";
