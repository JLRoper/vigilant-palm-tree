# Build stage
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files -- npm workspaces (packages/*) need their package.json
# present on disk before `npm ci` runs, so they're linked correctly.
COPY package.json package-lock.json ./
COPY packages ./packages

# Install dependencies (including devDependencies for build)
RUN npm ci

# Copy source code and config
COPY index.html tsconfig.json vite.config.ts ./
COPY src ./src
COPY server ./server

# Build both TypeScript and Vite (creates dist/)
RUN npm run build

# API runtime stage
FROM node:22-alpine AS api-runtime

WORKDIR /app

# Install wget for health checks
RUN apk add --no-cache wget

# Copy package files -- npm workspaces (packages/*) need their package.json
# present on disk before `npm ci` runs, so they're linked correctly.
COPY package.json package-lock.json ./
COPY --from=builder /app/packages ./packages

# Install production dependencies (tsx is in `dependencies` for runtime use)
RUN npm ci --omit=dev --save=false

# Copy source files (app runs with tsx loader at runtime)
COPY --from=builder /app/src ./src
COPY --from=builder /app/server ./server
COPY --from=builder /app/tsconfig.json ./
COPY --from=builder /app/package.json ./

# #98: explicit for the deployed image -- without this, app.get('env')
# defaults to "development", which (a) makes Express's own default error
# handler include stack traces on any error server/errorHandler.ts doesn't
# otherwise catch, and (b) leaves server/auth.ts's devCode convenience field
# turned on for real users, not just local dev.
ENV NODE_ENV=production

# Expose API port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget -O /dev/null http://localhost:3001/api/health || exit 1

# Start the server (uses tsx import for runtime compilation)
CMD ["node", "--import", "tsx/esm", "server/index.ts"]

# Web runtime stage (uses built Vite assets + vite preview for /api proxy)
FROM node:22-alpine AS web-runtime

WORKDIR /app

# vite preview reads vite.config.ts and honors the preview.proxy block,
# which routes /api/* to the api container (host via API_HOST env).
COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/packages ./packages
# vite is in `dependencies`; installed from the lockfile
RUN npm ci --omit=dev --save=false

# Copy built Vite assets + the files `vite preview` needs at runtime
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/vite.config.ts ./vite.config.ts
COPY --from=builder /app/index.html ./index.html
COPY --from=builder /app/tsconfig.json ./tsconfig.json

# Expose web port
EXPOSE 5173

CMD ["npx", "vite", "preview", "--host", "0.0.0.0", "--port", "5173"]
