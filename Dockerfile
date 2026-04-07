# Use a slim Node base image
FROM node:20-slim

# Install Python 3 and minimal tools
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Create auth_info directory
RUN mkdir -p /app/auth_info

# Copy package files and install Node dependencies
COPY package*.json ./
RUN npm install --production

# Copy requirements.txt and install Python dependencies
COPY requirements.txt ./
RUN pip3 install --no-cache-dir -r requirements.txt --break-system-packages

# Copy the rest of the application
COPY . .

# Build the frontend
RUN npm run build

# Expose the port
EXPOSE 3000

# Start the server with manual GC enabled
CMD ["node", "--expose-gc", "node_modules/tsx/dist/cli.mjs", "server.ts"]
