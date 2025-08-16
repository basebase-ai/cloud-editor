#!/bin/bash
set -e

echo "🚀 Universal Dev Container Starting..."

# Environment variables
GITHUB_REPO_URL=${GITHUB_REPO_URL:-""}
PROJECT_ID=${PROJECT_ID:-"default-project"}
WORKSPACE_DIR="/workspace"
# Railway sets PORT for the public service port, we use that for our proxy
PUBLIC_PORT=${PORT:-3001} # Railway provides PORT env var for public access  
USER_APP_PORT=3000 # User app runs internally on port 3000

# But if Railway sets PORT=3000, we need to use a different internal port for user app
if [ "$PORT" = "3000" ]; then
    USER_APP_PORT=3001
fi

# Create workspace directory
mkdir -p $WORKSPACE_DIR
cd $WORKSPACE_DIR

echo "📝 Environment:"
echo "  - Repo URL: $GITHUB_REPO_URL"
echo "  - Project ID: $PROJECT_ID"
echo "  - Public Port (Container API + Proxy): $PUBLIC_PORT"
echo "  - User App Port (Internal): $USER_APP_PORT"

# Function to start container API with proxy
start_container_api() {
    echo "🔧 Starting Container API + Proxy on port $PUBLIC_PORT..."
    cd /app
    PORT=$PUBLIC_PORT node container-api.js &
    CONTAINER_API_PID=$!
    echo "✅ Container API + Proxy started (PID: $CONTAINER_API_PID)"
    echo "📡 Container API available at: /_container/*"
    echo "🎯 User app will be proxied from port $USER_APP_PORT"
}

# Function to clone and start user app
start_user_app() {
    if [ -n "$GITHUB_REPO_URL" ]; then
        echo "📦 Cloning repository: $GITHUB_REPO_URL"
        
        # Clone the repository (only if workspace is empty)
        if [ "$(ls -A $WORKSPACE_DIR 2>/dev/null)" ]; then
            echo "📁 Workspace already exists, skipping clone"
        else
            if [ -n "$GITHUB_TOKEN" ]; then
                # Private repo with token
                CLONE_URL=$(echo $GITHUB_REPO_URL | sed "s/https:\/\/github.com/https:\/\/$GITHUB_TOKEN@github.com/")
                git clone $CLONE_URL $WORKSPACE_DIR 2>/dev/null || {
                    echo "❌ Failed to clone private repository"
                    return 1
                }
            else
                # Public repo
                git clone $GITHUB_REPO_URL $WORKSPACE_DIR || {
                    echo "❌ Failed to clone repository"
                    return 1
                }
            fi
        fi
        
        cd $WORKSPACE_DIR
        echo "✅ Repository cloned successfully"
        echo "📁 Current directory: $(pwd)"
        echo "📄 Files in directory: $(ls -la | head -10)"
        
        # Auto-detect project type and install dependencies
        if [ -f "package.json" ]; then
            echo "📦 Installing Node.js dependencies..."
            npm install || {
                echo "⚠️  npm install failed, continuing anyway"
            }
            
            # Determine start command
            if npm run | grep -q "dev"; then
                START_COMMAND="npm run dev"
            elif npm run | grep -q "start"; then
                START_COMMAND="npm start"
            else
                START_COMMAND="node index.js"
            fi
            
            echo "🚀 Starting user app with: $START_COMMAND"
            export USER_APP_START_COMMAND="$START_COMMAND"
            
            # Start the user's application with log output to file
            LOG_FILE="/tmp/user-app.log"
            PORT=$USER_APP_PORT $START_COMMAND > $LOG_FILE 2>&1 &
            USER_APP_PID=$!
            echo "✅ User app started (PID: $USER_APP_PID)"
            echo "📝 Logs redirected to: $LOG_FILE"
            
        elif [ -f "requirements.txt" ]; then
            echo "🐍 Python project detected, installing dependencies..."
            pip install -r requirements.txt || {
                echo "⚠️  pip install failed, continuing anyway"
            }
            
            # Try common Python start commands
            if [ -f "app.py" ]; then
                echo "🚀 Starting Python app: python app.py"
                python app.py &
                USER_APP_PID=$!
            elif [ -f "main.py" ]; then
                echo "🚀 Starting Python app: python main.py"
                python main.py &
                USER_APP_PID=$!
            else
                echo "⚠️  Could not determine how to start Python app"
            fi
            
        else
            echo "⚠️  Unknown project type, only Container API will be available"
        fi
    else
        echo "ℹ️  No repository URL provided, only Container API will be available"
    fi
}

# Start both processes
start_container_api
start_user_app

echo "🎉 Universal Dev Container is ready!"
echo "   - Public Access (Container API + Proxy): http://localhost:$PUBLIC_PORT"
echo "   - Container API: http://localhost:$PUBLIC_PORT/_container/*"
if [ -n "$USER_APP_PID" ]; then
    echo "   - User App (proxied): http://localhost:$PUBLIC_PORT/*"
    echo "   - User App (direct): http://localhost:$USER_APP_PORT"
fi

# Keep container running and monitor processes
wait_for_processes() {
    while true; do
        # Check if container API is still running
        if ! kill -0 $CONTAINER_API_PID 2>/dev/null; then
            echo "❌ Container API died, restarting..."
            start_container_api
        fi
        
        # Check if user app is still running (if it was started)
        if [ -n "$USER_APP_PID" ] && ! kill -0 $USER_APP_PID 2>/dev/null; then
            echo "❌ User app died, restarting..."
            start_user_app
        fi
        
        sleep 10
    done
}

# Handle shutdown gracefully
trap 'echo "🛑 Shutting down..."; kill $CONTAINER_API_PID $USER_APP_PID 2>/dev/null; exit 0' TERM INT

# Keep the container running
wait_for_processes
