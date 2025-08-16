# Cloud Editor

A powerful web-based AI coding assistant that allows users to edit GitHub repositories inside a browser. This application allows you to clone any GitHub repository, edit code in real-time, and get AI assistance with development tasks. It leverages cloud containers on Railway to serve the apps in dev mode while they are being edited.

## Features

- 🤖 **AI-Powered Code Assistant** - Chat with Gemini AI to make code changes
- ☁️ **Railway Cloud Containers** - Each project runs in its own isolated cloud environment
- 🐳 **Universal Docker Containers** - Automatically detects and runs any Node.js, Python, or web project
- 📂 **GitHub Repository Cloning** - Clone and work with any public or private GitHub repo
- 🛠️ **Live Development Tools** - Edit files, run commands, restart servers in real-time
- 📡 **Live Log Streaming** - See your application logs in real-time as you develop
- 🎨 **Modern UI** - Built with Next.js, Mantine, and Tailwind CSS
- 🔄 **Multi-step Agent** - AI assistant can take multiple actions to complete complex tasks
- 👥 **Multi-tenant Support** - Multiple users can work on the same repository simultaneously

## Architecture

- **Frontend**: Next.js 15 with App Router, Mantine UI components
- **AI Integration**: Google Gemini via AI SDK
- **Cloud Runtime**: Railway containers with universal Docker images
- **Container Registry**: GitHub Container Registry (GHCR)
- **Real-time Communication**: Server-Sent Events for log streaming
- **Styling**: Tailwind CSS + Mantine component library

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Set up environment variables

Create a `.env.local` file with the following variables:

```env
# AI Configuration
GOOGLE_GENERATIVE_AI_API_KEY=your_google_ai_api_key_here

# Railway Configuration (server-side only)
RAILWAY_PROJECT_ID=your_railway_project_id
RAILWAY_ENVIRONMENT_ID=your_railway_environment_id
RAILWAY_TOKEN=your_railway_api_token
```

### 3. Railway Setup

Follow the detailed setup guide in [RAILWAY_SETUP.md](./RAILWAY_SETUP.md) to:

- Create a Railway project and get credentials
- Configure your Railway environment
- Set up the universal container deployment

### 4. Run the development server

```bash
npm run dev
```

### 5. Open the application

Navigate to [http://localhost:3000](http://localhost:3000)

## Usage

### Deploying a Repository

To work with a GitHub repository:

1. Navigate to `http://localhost:3000/your-project-name?repo=https://github.com/my-repo-name`
2. Add your GitHub token when requested (for private repos)
3. The system will automatically:
   - Deploy a new Railway container
   - Clone your repository
   - Install dependencies
   - Start your development server
   - Show live app output in your browser
   - Use hot module replacement to instantly show you changes
   - Stream app server logs to your browser as well

### AI Assistant Capabilities

The AI assistant can help you with:

- **File Operations**:

  - `read_file` - View any file in your project
  - `write_file` - Create or modify files
  - `list_files` - Explore project structure

- **Development Tools**:
  - `run_command` - Execute terminal commands
  - `restart_server` - Restart your development server
- **Real-time Features**:
  - Live code changes with hot reloading
  - Real-time log streaming
  - Instant feedback on compilation errors

### Example Prompts

- "Show me the project structure and main components"
- "Add authentication to this Next.js app"
- "Fix the TypeScript errors in the components folder"
- "Add a new API endpoint for user management"
- "Optimize this React component for performance"
- "Set up a database connection and create user models"

## Container API

Each deployed container exposes a unified API for AI agent interactions:

- `GET /api/health` - Container health check
- `POST /api/read_file` - Read file contents
- `POST /api/write_file` - Write/modify files
- `POST /api/list_files` - List directory contents
- `POST /api/run_command` - Execute commands
- `POST /api/restart_server` - Restart the development server
- `GET /api/logs/stream` - Real-time log streaming via Server-Sent Events

## Development Scripts

```bash
# Development server with hot reloading
npm run dev

# Production build
npm run build

# Start production server
npm run start

# Lint code
npm run lint

# Testing scripts
npm run test:container      # Test container deployment
npm run test:files         # Test file operations
npm run test:logs          # Test log streaming
npm run test:all           # Run full test suite
npm run inspect:container  # Interactive container inspector
```

## Multi-tenant Architecture

The system supports multiple users working on the same repository:

- Each user gets a unique user ID stored in localStorage
- Railway services are named with format: `{userId}-{projectId}`
- Isolated containers prevent conflicts between users
- Real-time log streaming is per-user session

## Supported Project Types

The universal container automatically detects and supports:

- **Node.js Projects** - package.json with npm/yarn
- **Next.js Applications** - Automatic dev server startup
- **React Applications** - Create React App and Vite projects
- **Python Projects** - requirements.txt with pip
- **Express Servers** - API and web applications

## Browser Compatibility

This application requires a modern browser with support for:

- ES2022 features
- Server-Sent Events (EventSource)
- Modern JavaScript APIs

## Contributing

1. Fork the repository
2. Create a feature branch
3. Test your changes with the provided testing scripts
4. Ensure all container functionality works
5. Submit a pull request

## License

MIT License - see LICENSE file for details
