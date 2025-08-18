# Universal Dev Container

This folder contains the Docker configuration for building the universal development container that Railway uses to run user coding sessions.

## Overview

The universal-dev-container is a Docker image that can:

- Clone any GitHub repository
- Auto-detect project type (Node.js, Python, Ruby, Go, etc.)
- Install dependencies automatically
- Start development servers
- Run a container API for AI agent tools

## Building and Publishing to GHCR

### Prerequisites

1. **GitHub Personal Access Token** with `write:packages` permission
2. **Docker** installed and running
3. **GitHub CLI** (optional, for easier authentication)

### Step 1: Authenticate with GHCR

```bash
# Option 1: Using GitHub CLI
gh auth login

# Option 2: Using Docker login
echo $GITHUB_TOKEN | docker login ghcr.io -u USERNAME --password-stdin
```

### Step 2: Build the Image

```bash
# Navigate to the container directory
cd container

# Build with platform flag for Railway compatibility
docker build --platform linux/amd64 -t ghcr.io/YOUR_USERNAME/universal-dev-container:latest .

# Or build with a specific version tag
docker build --platform linux/amd64 -t ghcr.io/YOUR_USERNAME/universal-dev-container:v1.0.0 .
```

**Important**: Always use `--platform linux/amd64` when building on Apple Silicon (M1/M2) machines to ensure compatibility with Railway's x86_64 infrastructure.

### Step 3: Push to GHCR

```bash
# Push the latest tag
docker push ghcr.io/basebase-ai/universal-dev-container:latest

# Push versioned tag
docker push ghcr.io/basebase-ai/universal-dev-container:v1.0.0
```

## Image Structure

- **Base**: `node:18-slim`
- **Working Directory**: `/app`
- **Workspace**: `/workspace` (for user repositories)
- **Ports**: 3000 (app), 3001 (container API)
- **Entrypoint**: `/app/universal-startup.sh`

## Environment Variables

The container expects these environment variables when deployed:

- `GITHUB_REPO_URL` (required): Repository to clone
- `GITHUB_TOKEN` (optional): GitHub token for private repositories

## Testing Locally

```bash
# Build the image
docker build -t universal-dev-container:test .

# Run with a test repository
docker run -e GITHUB_REPO_URL=https://github.com/username/test-repo -p 3000:3000 -p 3001:3001 universal-dev-container:test
```

## Troubleshooting

### Build Issues on Apple Silicon

- Always use `--platform linux/amd64` flag
- This ensures compatibility with Railway's infrastructure

### Authentication Issues

- Ensure your GitHub token has `write:packages` permission
- Check that you're logged in with `docker login ghcr.io`

### Image Not Found on Railway

- Verify the image name and tag are correct
- Check that the image is public or Railway has access to your private repository
