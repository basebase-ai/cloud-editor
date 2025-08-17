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
COPY container/container-api.js /usr/local/bin/container-api.js
COPY universal-startup.sh /usr/local/bin/startup.sh

# Install container API dependencies globally
RUN npm install -g express cors http-proxy-middleware

# Make startup script executable
RUN chmod +x /usr/local/bin/startup.sh

# Create workspace directory
RUN mkdir -p /workspace

# Expose common ports (Railway will map to the assigned PORT)
EXPOSE 3000 8080

# Use startup script as entrypoint
CMD ["/usr/local/bin/startup.sh"]
