# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common Development Commands

```bash
# Development server with hot reloading (uses Turbopack)
npm run dev

# Production build
npm run build

# Start production server
npm run start

# Lint code
npm run lint
```

## Architecture Overview

BaseBase Editor is a browser-based AI coding assistant that runs code in a local WebContainer environment. The application enables users to clone GitHub repositories, edit code, and get AI assistance with development tasks.

### Core Components

**Frontend (Next.js 15 + App Router)**
- `src/app/page.tsx` - Root redirect handler that extracts project info from URL query params
- `src/app/[projectId]/page.tsx` - Main project interface with WebContainer and chat panels
- `src/components/WebContainerManager.tsx` - Manages WebContainer lifecycle, GitHub repo cloning, and dev server
- `src/components/ChatInterface.tsx` - AI chat interface with streaming responses and tool status formatting
- `src/components/GitHubTokenModal.tsx` - Modal for GitHub token management

**Backend API Routes**
- `src/app/api/chat/route.ts` - AI chat API using Vercel AI SDK with Google Gemini, includes custom tool status streaming
- `src/app/api/webcontainer/route.ts` - Bridge API for communication between server-side tools and client-side WebContainer

**WebContainer Integration**
The app uses a sophisticated client-server bridge pattern:
1. Server-side AI tools (in chat/route.ts) make requests to `/api/webcontainer`
2. Client-side WebContainer polls for pending requests via GET
3. WebContainer executes operations (file read/write, search, etc.)
4. Results are sent back via POST to complete the bridge

### Key Features

**AI Tools Available**
- `list_files` - Explore project structure  
- `read_file` - View file contents
- `edit_file` - Make code changes
- `grep_files` - Search for patterns in code
- `run_linter` - Check code quality
- `check_status` - WebContainer debugging info

**GitHub Integration**
- Supports both public and private repositories
- Uses GitHub API to download repository contents as file tree
- Handles binary files (images, fonts) and text files appropriately
- Batch processing to respect API rate limits

**Development Server Management**
- Automatically installs npm dependencies
- Starts dev server with proper environment variables
- Handles server-ready events and iframe preview

## Technology Stack

- **Framework**: Next.js 15 with App Router
- **UI**: Mantine v8 components + Tailwind CSS
- **AI**: Vercel AI SDK with Google Gemini (requires GOOGLE_GENERATIVE_AI_API_KEY)
- **Runtime Environment**: WebContainer API for browser-based development
- **Icons**: Tabler Icons React + Lucide React

## Environment Variables

Required:
- `GOOGLE_GENERATIVE_AI_API_KEY` - Google Gemini API key for AI functionality

Optional:
- `NEXT_PUBLIC_APP_URL` - App URL for WebContainer bridge (defaults to localhost:3000)

## WebContainer Bridge Pattern

The app implements a unique request-response pattern for server-side AI tools to interact with client-side WebContainer:

1. **Server-side tools** (in chat API) make HTTP requests to `/api/webcontainer` 
2. **Bridge API** stores pending requests in memory map
3. **Client WebContainer** polls `/api/webcontainer` GET endpoint every second
4. **WebContainer executes** file operations locally in browser
5. **Results posted back** to bridge API to resolve server-side promises

This enables AI tools to perform file operations while maintaining WebContainer's browser-only constraint.

## Development Notes

- WebContainer uses singleton pattern to prevent multiple instances
- File operations handle both text and binary files appropriately
- Repository cloning supports main/master branch detection
- Chat interface formats tool status messages with emojis and result summaries
- Streaming responses include immediate tool status updates via custom stream wrapper