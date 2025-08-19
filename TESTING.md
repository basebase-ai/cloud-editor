# Testing Guide

This document describes the testing strategy for the cloud-editor application.

## Test Suite

### Cloud Editor E2E Test

The comprehensive end-to-end test suite that validates the entire cloud-editor workflow:

```bash
npm run test
```

**What it tests:**

- ✅ Railway container deployment
- ✅ App serving verification
- ✅ Container API functionality (file operations)
- ✅ Log streaming
- ✅ Automatic cleanup information

**When to run:**

- After any code changes that affect Railway deployment
- Before merging to main branch
- When debugging Railway/deployment issues

## Development Tools

```bash
npm run inspect:container # Inspect running container
npm run demo              # Run demo script
```

## Test Commands Summary

```bash
# Main E2E test (recommended)
npm run test

# Development tools
npm run inspect:container
npm run demo
```

## GitHub Actions Integration

The cloud-editor E2E test suite runs automatically on:

- Push to main/develop branches
- Pull requests to main branch
- Manual workflow dispatch

**Required Secrets:**

- `RAILWAY_TOKEN` - Railway API token
- `GITHUB_TOKEN` - GitHub API token (for PR comments)

## Troubleshooting

### Common Issues

1. **Railway API 400 Errors**

   - Check if `RAILWAY_TOKEN` is set correctly
   - Verify the service ID exists in Railway
   - Check Railway API status at https://status.railway.app

2. **Container Deployment Failures**

   - Ensure the test repo is accessible
   - Check Railway project has sufficient resources
   - Verify GitHub token has repo access

3. **Log Streaming Issues**
   - Container may not be running
   - Service ID may be incorrect
   - Network connectivity issues

### Debug Commands

```bash
# Check Railway API status
curl -H "Authorization: Bearer $RAILWAY_TOKEN" \
  https://backboard.railway.app/graphql/v2 \
  -d '{"query":"query { __typename }"}'

# Test local server health
curl http://localhost:3000/api/health

# Check container health (if deployed)
curl https://your-container-url.up.railway.app/_container/health
```

## Test Environment Setup

### Required Environment Variables

```bash
# Railway configuration
RAILWAY_TOKEN=your_railway_token
RAILWAY_DEV_PROJECT_ID=your_railway_dev_project_id

# GitHub configuration (for deployment)
GITHUB_TOKEN=your_github_token

# Test configuration
BASE_URL=http://localhost:3000
```

### Local Development

1. Start the development server:

   ```bash
   npm run dev
   ```

2. Run tests in another terminal:
   ```bash
   npm run test
   ```

## Test Results

### Test Output Example

```
🚀 Cloud Editor Test Suite
📍 Base URL: http://localhost:3000
📦 Test Repo: https://github.com/basebase-ai/nextjs-starter

🔧 Starting: Deploy Container
✅ Container deployed: https://test-user-nextjs-starter-dev.up.railway.app
✅ Deploy Container passed (53324ms)

🔧 Starting: App Serving
✅ App is serving correctly
✅ App Serving passed (7592ms)

🔧 Starting: Container API
✅ Found 18 files
✅ Container API working correctly

🔧 Starting: Log Streaming
✅ Received 5 logs

📋 Test Results Summary
========================================
Total Duration: 71550ms
Passed: 4/4
Failed: 0/4

🎉 All cloud-editor functionality working correctly!
```

**Note**: This test validates the entire cloud-editor workflow, helping identify whether issues are with Railway/deployment or the cloud-editor application itself.

## Continuous Integration

The cloud-editor E2E test suite is integrated into the CI/CD pipeline:

1. **Automatic Testing**: Runs on every PR and push to main
2. **Artifact Upload**: Test results are saved as artifacts
3. **PR Comments**: Results are posted as comments on PRs
4. **Failure Alerts**: Failed tests block merging

## Best Practices

1. **Run cloud-editor E2E tests locally** before pushing changes
2. **Check test artifacts** when tests fail in CI
3. **Monitor Railway usage** to avoid hitting limits
4. **Clean up test deployments** manually if needed
5. **Update test repo** if the default test repo changes

## Performance Considerations

- Cloud-editor E2E tests take ~1-2 minutes to complete
- Railway deployments consume resources
- Consider running tests during off-peak hours
- Monitor Railway usage and costs

## Current Status

The test suite validates the complete cloud-editor workflow:

- ✅ **Railway deployment** - Containers deploy correctly
- ✅ **App serving** - Deployed apps are accessible
- ✅ **Container API** - File operations work correctly
- ✅ **Log streaming** - Real-time logs are received

This comprehensive test ensures all cloud-editor functionality is working properly.
