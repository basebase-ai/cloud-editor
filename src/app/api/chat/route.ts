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
      return {
        content: "",
        path,
        lines: 0,
        type: "read_file",
        error: error instanceof Error ? error.message : "Unknown error",
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
      return {
        success: false,
        path,
        message: `Failed to update file ${path}: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
        contentLength: content.length,
        type: "edit_file",
        error: error instanceof Error ? error.message : "Unknown error",
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
        edit_file: editFileTool,
        grep_files: grepFilesTool,
        run_linter: runLinterTool,
      },
      system: `You are an AI coding assistant operating within a WebContainer environment. 
      
You can help users with their code by:
1. Analyzing their project structure using list_files
2. Reading specific files using read_file  
3. Making code changes using edit_file
4. Searching for patterns using grep_files
5. Running linting to check code quality using run_linter

When helping users:
- Take multiple steps to understand the codebase first
- Show your thinking process with intermediate messages
- Use tools to gather information before making changes
- Explain what you're doing at each step
- Provide clear summaries of changes made

Always be thorough and methodical in your approach. Break down complex requests into smaller steps and show your progress.`,
      stopWhen: stepCountIs(5),
    });
    console.log(`[Chat API] StreamText completed, returning response`);

    return result.toTextStreamResponse();
  } catch (error) {
    console.error("Chat API error:", error);
    return new Response("Internal server error", { status: 500 });
  }
}

export const runtime = "edge";
