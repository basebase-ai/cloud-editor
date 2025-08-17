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
NODE_PATH=/usr/local/lib/node_modules node /usr/local/bin/container-api.js &
CONTAINER_API_PID=$!

# Add iframe-friendly headers to Next.js config if it exists
if [ -f "next.config.mjs" ] || [ -f "next.config.js" ]; then
    echo "📋 Adding iframe headers to Next.js config..."
    
    # Create a backup and modify the config
    if [ -f "next.config.mjs" ]; then
        CONFIG_FILE="next.config.mjs"
    else
        CONFIG_FILE="next.config.js"
    fi
    
    # Add iframe headers if not already present
    if ! grep -q "X-Frame-Options" "$CONFIG_FILE"; then
        # Backup original config
        cp "$CONFIG_FILE" "${CONFIG_FILE}.original"
        
        # Use a simpler approach - inject headers function before the export
        if [ "$CONFIG_FILE" = "next.config.mjs" ]; then
            # For ES modules, add headers function before export
            sed '/export default/i \
\
// Add iframe headers for embedding compatibility\
const iframeHeaders = {\
  async headers() {\
    return [\
      {\
        source: "/(.*)",\
        headers: [\
          {\
            key: "X-Frame-Options",\
            value: "ALLOWALL",\
          },\
          {\
            key: "Content-Security-Policy",\
            value: "frame-ancestors *",\
          },\
          {\
            key: "Cross-Origin-Resource-Policy",\
            value: "cross-origin",\
          },\
        ],\
      },\
    ];\
  },\
};\
\
// Merge with original config\
nextConfig.headers = iframeHeaders.headers;\
' "${CONFIG_FILE}.original" > "$CONFIG_FILE"
        else
            # For CommonJS, similar approach
            sed '/module.exports/i \
\
// Add iframe headers for embedding compatibility\
nextConfig.headers = async function() {\
  return [\
    {\
      source: "/(.*)",\
      headers: [\
        {\
          key: "X-Frame-Options",\
          value: "ALLOWALL",\
        },\
        {\
          key: "Content-Security-Policy",\
          value: "frame-ancestors *",\
        },\
        {\
          key: "Cross-Origin-Resource-Policy",\
          value: "cross-origin",\
        },\
      ],\
    },\
  ];\
};\
' "${CONFIG_FILE}.original" > "$CONFIG_FILE"
        fi
        echo "✅ Added iframe headers to $CONFIG_FILE"
    fi
fi

# Start the main application (force port 3000 for user app)
echo "🚀 Starting application with: $DEV_COMMAND"
PORT=3000 eval $DEV_COMMAND &
APP_PID=$!

# Function to handle graceful shutdown
cleanup() {
    echo "🛑 Shutting down..."
    kill $CONTAINER_API_PID 2>/dev/null || true
    kill $APP_PID 2>/dev/null || true
    exit 0
}

# Set up signal handling
trap cleanup SIGTERM SIGINT

# Wait for either process to exit
wait $APP_PID $CONTAINER_API_PID
