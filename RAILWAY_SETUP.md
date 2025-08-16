# Railway Container Setup Guide

This guide explains how to set up Railway containers to replace the WebContainer functionality.

## Overview

The app now uses Railway containers instead of WebContainer for running and editing code. Each container:

1. Clones a GitHub repository
2. Installs dependencies with `npm install`
3. Runs `npm run dev` to start the development server
4. Exposes an API for AI agent tools (read_file, write_file, etc.)
5. Streams logs back to the browser

## Setup Requirements

### 1. Railway Account and Project

1. Create a Railway account at [railway.app](https://railway.app)
2. Create a new project in Railway
3. Note your Project ID (found in project settings)
4. Generate a Railway API token (Account Settings > Tokens)

### 2. Configure Environment Variables

Set these environment variables on your server (not exposed to the client for security):

```bash
RAILWAY_PROJECT_ID=your-railway-project-id
RAILWAY_TOKEN=your-railway-token
```

**Important**: These credentials are kept server-side only for security. Never expose Railway tokens to the client.

You can set these in your deployment environment (Vercel, Railway, etc.) or in a local `.env.local` file:

```bash
# .env.local (only these two are needed!)
RAILWAY_PROJECT_ID=your-railway-project-id
RAILWAY_TOKEN=your-railway-token
```

### 3. Universal Container Image Setup

To support any GitHub repository automatically, we need to create a universal container image that can:

1. Clone any GitHub repository
2. Auto-detect the project type and package manager
3. Install dependencies automatically
4. Start the development server
5. Run the container API alongside the app

#### Create Universal Dockerfile

Create a `Dockerfile` in your cloud-editor project:

```dockerfile
FROM node:18-slim

# Install git and other dependencies
RUN apt-get update && apt-get install -y \
    git \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy container API template
COPY container-api-template.js /usr/local/bin/container-api.js
COPY universal-startup.sh /usr/local/bin/startup.sh

# Install container API dependencies globally
RUN npm install -g express cors

# Make startup script executable
RUN chmod +x /usr/local/bin/startup.sh

# Expose ports for both app and container API
EXPOSE 3000 3001

# Use startup script as entrypoint
CMD ["/usr/local/bin/startup.sh"]
```

#### Create Universal Startup Script

Create `universal-startup.sh`:

```bash
#!/bin/bash
set -e

echo "🚀 Universal Container Starting..."

# Environment variables expected:
# GITHUB_REPO_URL - Repository to clone
# GITHUB_TOKEN - Optional GitHub token for private repos

if [ -z "$GITHUB_REPO_URL" ]; then
    echo "❌ GITHUB_REPO_URL environment variable is required"
    exit 1
fi

echo "📁 Cloning repository: $GITHUB_REPO_URL"

# Clone with token if provided
if [ -n "$GITHUB_TOKEN" ]; then
    # Extract repo parts for authenticated clone
    REPO_PATH=$(echo "$GITHUB_REPO_URL" | sed 's|https://github.com/||')
    git clone "https://$GITHUB_TOKEN@github.com/$REPO_PATH" /workspace
else
    git clone "$GITHUB_REPO_URL" /workspace
fi

cd /workspace

echo "🔍 Detecting project type..."

# Auto-detect project type and install dependencies
if [ -f "package.json" ]; then
    echo "📦 Node.js project detected"

    # Install dependencies
    echo "⬇️ Installing dependencies..."
    npm install

    # Detect available scripts
    if npm run | grep -q "dev"; then
        DEV_COMMAND="npm run dev"
    elif npm run | grep -q "start:dev"; then
        DEV_COMMAND="npm run start:dev"
    elif npm run | grep -q "serve"; then
        DEV_COMMAND="npm run serve"
    else
        DEV_COMMAND="npm start"
    fi

    echo "🎯 Will use command: $DEV_COMMAND"

elif [ -f "requirements.txt" ]; then
    echo "🐍 Python project detected"
    pip install -r requirements.txt
    DEV_COMMAND="python manage.py runserver 0.0.0.0:3000 || python app.py || flask run --host=0.0.0.0 --port=3000"

elif [ -f "Gemfile" ]; then
    echo "💎 Ruby project detected"
    bundle install
    DEV_COMMAND="rails server -b 0.0.0.0 -p 3000 || ruby app.rb"

elif [ -f "go.mod" ]; then
    echo "🔷 Go project detected"
    go mod download
    DEV_COMMAND="go run . || go run main.go"

else
    echo "❓ Unknown project type, will try to serve static files"
    DEV_COMMAND="npx serve . -p 3000"
fi

# Start container API in background
echo "🔧 Starting container API..."
node /usr/local/bin/container-api.js &
CONTAINER_API_PID=$!

# Start the main application
echo "🚀 Starting application with: $DEV_COMMAND"
eval $DEV_COMMAND &
APP_PID=$!

# Wait for either process to exit
wait $APP_PID $CONTAINER_API_PID
```

#### Deploy Universal Image to Railway

1. Build and push the universal image to a container registry:

```bash
# Build the universal container
docker build -t your-registry/universal-dev-container .

# Push to registry (Docker Hub, GitHub Container Registry, etc.)
docker push your-registry/universal-dev-container
```

2. The universal container is automatically used - no additional setup needed!

**Note**: BaseBase provides a pre-built universal container at `ghcr.io/basebase-ai/universal-dev-container:latest` that supports most common project types (Node.js, Python, Ruby, Go, static sites).

## How It Works

### 1. Container Deployment Flow

1. User visits `https://cloud-editor.basebase.ai/my_project?repo=https://github.com/user/repo`
2. User provides their GitHub token (stored in localStorage for private repos)
3. Frontend automatically calls `/api/railway/deploy` with repo URL and GitHub token
4. API creates new Railway service using the universal container image
5. Container automatically clones the repo, installs dependencies, and starts both:
   - The user's application on port 3000
   - The container API on port 3001
6. User sees the running app in an iframe and can immediately start chatting with AI

### 2. Tool Communication Flow

1. AI agent tools make requests to `/api/container`
2. Container API polls `/api/container` for pending requests
3. Container API executes the requested operation (read file, write file, etc.)
4. Results are sent back through the same API

### 3. Log Streaming

1. Frontend calls `/api/railway/logs` to start log streaming
2. API fetches logs from Railway GraphQL API
3. Logs are streamed to browser via Server-Sent Events
4. Logs are displayed in the container's log panel

## API Endpoints

### Railway Deployment

- `POST /api/railway/deploy` - Deploy new container
- `GET /api/railway/deploy` - Get deployment status

### Container Communication

- `POST /api/container` - Send tool request to container
- `GET /api/container` - Poll for pending requests (used by container)

### Log Streaming

- `GET /api/railway/logs` - Fetch historical logs
- `POST /api/railway/logs` - Start real-time log streaming

## Container API Tools

The container API supports these tool actions:

- `listFiles` - List directory contents
- `readFile` - Read file contents
- `writeFile` - Write file contents
- `deleteFile` - Delete a file
- `searchFiles` - Search for text in files
- `runCommand` - Execute shell commands
- `replaceLines` - Replace text in files
- `checkStatus` - Get container status
- `restartServer` - Restart the dev server

## Troubleshooting

### Railway Configuration Missing

If deployment fails with "Railway credentials not configured on server", ensure you've set the server environment variables:

- `RAILWAY_PROJECT_ID` - Your Railway project ID
- `RAILWAY_TOKEN` - Your Railway API token

### Container Not Responding

1. Check Railway dashboard for deployment status
2. Verify container API is running on port 3001
3. Check container logs for errors
4. Ensure GitHub repository is accessible

### Logs Not Streaming

1. Verify Railway token has correct permissions
2. Check network connectivity
3. Try refreshing the deployment status

## Security Considerations

- **Railway tokens**: Kept server-side only, have full access to your Railway account
- **GitHub tokens**: Stored in user's localStorage, only used for cloning repositories
- **Container API**: Runs with full file system access within the container
- **Repository access**: Users can only access repositories they have GitHub access to
- **Isolation**: Each deployment creates a separate, isolated container instance
- **Production use**: Consider implementing additional API authentication and rate limiting

## Migration from WebContainer

The new Railway system provides several advantages over WebContainer:

1. **Real cloud environment** - Full Node.js runtime, not browser simulation
2. **Better performance** - Native execution vs. WASM
3. **Full package support** - No WebContainer limitations
4. **Persistent storage** - Files persist between sessions
5. **Real networking** - Can make external API calls
6. **Scalability** - Can run multiple containers simultaneously

The AI agent tools work identically to before, just with improved reliability and capabilities.
