# Build stage
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install dependencies (including devDependencies for build)
RUN npm ci

# Copy source code and config
COPY index.html tsconfig.json vite.config.ts ./
COPY src ./src
COPY server ./server
COPY shared ./shared

# Build both TypeScript and Vite (creates dist/)
RUN npm run build

# API runtime stage
FROM node:22-alpine AS api-runtime

WORKDIR /app

# Install wget for health checks
RUN apk add --no-cache wget

# Copy package files
COPY package.json package-lock.json ./

# Install production dependencies (including tsx for runtime)
RUN npm ci --omit=dev --save=false && npm install --save-exact tsx

# Copy source files (app runs with tsx loader at runtime)
COPY --from=builder /app/src ./src
COPY --from=builder /app/server ./server
COPY --from=builder /app/shared ./shared
COPY --from=builder /app/tsconfig.json ./
COPY --from=builder /app/package.json ./

# Expose API port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget -O /dev/null http://localhost:3001/api/health || exit 1

# Start the server (uses tsx import for runtime compilation)
CMD ["node", "--import", "tsx/esm", "server/index.ts"]

# Web runtime stage (uses built Vite assets)
FROM node:22-alpine AS web-runtime

WORKDIR /app

# Install simple http server for serving static files
RUN npm install -g serve

# Copy built Vite assets
COPY --from=builder /app/dist ./dist

# Expose web port
EXPOSE 5173

# Start serving static assets
CMD ["serve", "-s", "dist", "-l", "5173"]
