FROM node:18-slim

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    python3 \
    python3-pip \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package.json first for better caching
COPY package.json /app/

# Install container API dependencies
RUN npm install

# Copy container API and startup script
COPY container-api.js /app/
COPY universal-startup.sh /app/

# Make startup script executable
RUN chmod +x /app/universal-startup.sh

# Create workspace directory
RUN mkdir -p /workspace

# Expose both ports
EXPOSE 3000 3001

# Run the universal startup script
CMD ["/app/universal-startup.sh"]
