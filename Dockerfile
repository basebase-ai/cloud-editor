FROM node:18-slim

# Install git and other dependencies
RUN apt-get update && apt-get install -y \
    git \
    curl \
    python3 \
    python3-pip \
    ruby \
    ruby-dev \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install global npm packages that might be needed
RUN npm install -g serve concurrently nodemon

WORKDIR /app

# Copy container API template
COPY container-api-template.js /usr/local/bin/container-api.js
COPY universal-startup.sh /usr/local/bin/startup.sh

# Install container API dependencies globally
RUN npm install -g express cors

# Make startup script executable
RUN chmod +x /usr/local/bin/startup.sh

# Create workspace directory
RUN mkdir -p /workspace

# Expose ports for both app and container API
EXPOSE 3000 3001

# Use startup script as entrypoint
CMD ["/usr/local/bin/startup.sh"]
