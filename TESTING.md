# Railway Container Testing Toolkit

This directory contains a comprehensive testing suite for validating the Railway container functionality piece by piece.

## 🧪 Test Scripts

### 1. Container Creation Test

**Script:** `scripts/test-container-creation.js`  
**Command:** `npm run test:container <repo-url> [github-token]`

Tests the complete Railway container deployment process:

- ✅ Deploys container using Railway GraphQL API
- ✅ Polls for deployment status until ready
- ✅ Validates container URL is accessible
- ✅ Tests basic container API connectivity

**Example:**

```bash
npm run test:container https://github.com/vercel/next.js
npm run test:container https://github.com/user/private-repo gh_token_here
```

### 2. File Operations Test

**Script:** `scripts/test-file-operations.js`  
**Command:** `npm run test:files <project-id>`

Tests all container API file operations:

- ✅ `checkStatus` - Container health check
- ✅ `listFiles` - Directory listing
- ✅ `readFile` - File content reading
- ✅ `writeFile` - File creation and writing
- ✅ `replaceLines` - Line-based file editing
- ✅ `searchFiles` - File pattern searching
- ✅ `runCommand` - Shell command execution
- ✅ `deleteFile` - File deletion

**Example:**

```bash
npm run test:files user-repo
```

### 3. Log Streaming Test

**Script:** `scripts/test-log-streaming.js`  
**Command:** `npm run test:logs <project-id>`

Tests Railway log streaming functionality:

- ✅ Historical logs retrieval (GET endpoint)
- ✅ Real-time log streaming (SSE via POST endpoint)
- ✅ Log parsing and formatting
- ✅ Stream connection handling

**Example:**

```bash
npm run test:logs user-repo
```

### 4. Comprehensive Test Runner

**Script:** `scripts/test-runner.js`  
**Command:** `npm run test:all <repo-url> [github-token]`

Runs all tests in sequence with detailed reporting:

1. **Container Creation** - Deploy and validate container
2. **File Operations** - Test all API endpoints (10 tests)
3. **Log Streaming** - Test historical and real-time logs

**Example:**

```bash
npm run test:all https://github.com/vercel/next.js
```

### 5. Interactive Container Inspector

**Script:** `scripts/container-inspector.js`  
**Command:** `npm run inspect:container <project-id>`

Interactive shell for manual container exploration:

```bash
npm run inspect:container user-repo

🐚 container> ls
📁 Contents of .:
  1. package.json
  2. src/
  3. README.md

🐚 container> cat package.json
📄 Content of package.json:
──────────────────────────────────────────────────
{
  "name": "my-app",
  "version": "1.0.0"
}
──────────────────────────────────────────────────

🐚 container> run npm install
💻 Running: npm install
...

🐚 container> help
📋 Available Commands:
  ls [path]           - List files in directory
  cat <file>          - Read file content
  write <file>        - Write content to file
  run <command>       - Run shell command
  search <pattern>    - Search for files
  status              - Show container status
  exit                - Exit inspector
```

## 🚀 Quick Start

1. **Set up environment variables** (see `RAILWAY_SETUP.md`):

   ```bash
   # In .env.local
   RAILWAY_PROJECT_ID=your-project-id
   RAILWAY_TOKEN=your-railway-token
   ```

2. **Start the development server**:

   ```bash
   npm run dev
   ```

3. **Run the complete test suite**:
   ```bash
   npm run test:all https://github.com/your-username/test-repo
   ```

## 🔧 Environment Variables

- `TEST_BASE_URL` - Override base URL (default: `http://localhost:3000`)
- `RAILWAY_PROJECT_ID` - Your Railway project ID
- `RAILWAY_TOKEN` - Your Railway API token

## 📊 Test Output

Each test provides detailed logging with timestamps and status indicators:

```
2024-01-15T10:30:45.123Z 🔄 Starting container creation test for: https://github.com/user/repo
2024-01-15T10:30:45.456Z ✅ Container deployed! Service ID: service-abc123
2024-01-15T10:30:55.789Z 📝 Status: DEPLOYING
2024-01-15T10:31:05.012Z ✅ Container is ready! URL: https://service-abc123.railway.app
```

## 🐛 Troubleshooting

### Container Creation Fails

- Check Railway credentials in `.env.local`
- Verify Railway project ID is correct
- Ensure sufficient Railway credits/usage

### File Operations Fail

- Container may still be starting up (wait 30+ seconds)
- Check container logs via log streaming test
- Verify container API is running on port 3001

### Log Streaming Issues

- Railway service must be deployed and running
- Check service and deployment IDs are correct
- Network connectivity to Railway API

### API Connectivity Issues

- Ensure Next.js dev server is running (`npm run dev`)
- Check for CORS issues in browser console
- Verify Railway container is accessible

## 📝 Example Workflow

```bash
# 1. Deploy a test container
npm run test:container https://github.com/vercel/next.js

# 2. Wait for output showing project ID, e.g., "vercel-next"

# 3. Test file operations
npm run test:files vercel-next

# 4. Test log streaming
npm run test:logs vercel-next

# 5. Manually explore the container
npm run inspect:container vercel-next

# 6. Visit the full UI
# http://localhost:3000/vercel-next?repo=https://github.com/vercel/next.js
```

## 🎯 Success Criteria

A fully working Railway container should:

- ✅ Deploy successfully via Railway API
- ✅ Pass all 10 file operation tests
- ✅ Stream logs in real-time
- ✅ Respond to container API calls within 30 seconds
- ✅ Run the target repository's development server
- ✅ Be accessible via generated Railway URL

This testing toolkit provides comprehensive validation that your Railway container integration is working correctly before relying on it in production!
