# Cloud Editor

A powerful web-based AI coding assistant that allows users to edit GitHub repositories inside a browser. This application allows you to clone any GitHub repository, edit code in real-time, and get AI assistance with development tasks. It automatically deploys cloud containers on Railway with a universal Docker image that supports any Node.js, Python, or web project.

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
RAILWAY_DEV_PROJECT_ID=your_railway_dev_project_id
RAILWAY_DEV_ENVIRONMENT_ID=your_railway_dev_environment_id
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

1. Navigate to `http://localhost:3000/your-project-name?repo=https://github.com/owner/repo`
2. Add your GitHub token when requested (for private repos)
3. The system will automatically:
   - Deploy a new Railway container with universal Docker image
   - Generate a public Railway domain (e.g., `project-user-production.up.railway.app`)
   - Clone your repository inside the container
   - Auto-detect project type (Node.js, Python, etc.)
   - Install dependencies (`npm install`, `pip install`, etc.)
   - Start your development server with proper port configuration
   - Expose your app through path-based proxy routing
   - Stream real-time logs from both container and your app
   - Enable hot module replacement for instant changes

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

### Example Working Deployment

🌐 **Live Demo**: https://sr2e-starter-production.up.railway.app

This is a live example of a Next.js starter deployed through our system:

- **User App**: https://sr2e-starter-production.up.railway.app/ (Next.js with Mantine UI)
- **Container API**: https://sr2e-starter-production.up.railway.app/_container/health
- **Live Logs**: https://sr2e-starter-production.up.railway.app/_container/logs/stream

### Example AI Prompts

- "Show me the project structure and main components"
- "Add authentication to this Next.js app"
- "Fix the TypeScript errors in the components folder"
- "Add a new API endpoint for user management"
- "Optimize this React component for performance"
- "Set up a database connection and create user models"

## Container API & Proxy Architecture

Each deployed container uses a path-based proxy system:

### User Application Routes

- `https://your-domain.up.railway.app/` - Your application (Next.js, React, etc.)
- `https://your-domain.up.railway.app/about` - All standard app routes
- `https://your-domain.up.railway.app/_next/*` - WebSocket HMR, static assets

### Container API Routes (AI Agent Tools)

- `GET /_container/health` - Container health check
- `POST /_container/read_file` - Read file contents
- `POST /_container/write_file` - Write/modify files
- `POST /_container/list_files` - List directory contents
- `POST /_container/run_command` - Execute commands
- `POST /_container/restart_server` - Restart the development server
- `GET /_container/logs/stream` - Real-time log streaming via Server-Sent Events

The proxy ensures zero conflicts between your app and AI agent tools while maintaining full HMR support.

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

The system supports multiple users working on the same repository simultaneously:

- Each user gets a unique user ID stored in localStorage
- Railway services are named with format: `{userId}-{repoName}`
- Each user-repo combination gets its own isolated container
- Automatic Railway domain generation: `{userId}-{repoName}.up.railway.app`
- Real-time log streaming is per-user session
- No conflicts between users editing the same repository

## Universal Container Support

The universal Docker container automatically detects and supports:

### Node.js Ecosystem

- **Next.js Applications** - `npm run dev` with HMR support
- **React Applications** - Create React App, Vite projects
- **Express Servers** - API servers and web applications
- **Vue.js Applications** - Nuxt.js and standard Vue projects
- **General Node.js** - Any project with `package.json`

### Python Projects

- **Flask Applications** - Web applications and APIs
- **Django Projects** - Full-stack web applications
- **FastAPI** - Modern async API frameworks
- **General Python** - Any project with `requirements.txt`

### Static Sites

- **HTML/CSS/JS** - Served via static file server
- **Generated Sites** - Gatsby, Hugo output directories

### Auto-Detection Features

- Detects project type from `package.json`, `requirements.txt`
- Automatically installs dependencies
- Selects appropriate start command (`npm run dev`, `python app.py`, etc.)
- Configures ports for Railway deployment
- Handles both development and production modes

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
