FROM node:24.22.1-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends openssl && apt-get clean

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --no-audit --no-fund

# Copy source code
COPY . .

# Generate Prisma client
RUN npm run build && npm prune --omit=dev --no-audit --no-fund

# Expose port
EXPOSE 5000

# Start server
CMD ["node", "src/server.js"]
