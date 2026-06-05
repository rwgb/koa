# syntax=docker/dockerfile:1
# Stage 1: build TypeScript + web
FROM node:22-slim AS builder
WORKDIR /app

# Install build deps
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ src/
RUN npm run build

# Build web UI
COPY web/package.json web/package-lock.json web/
RUN cd web && npm ci
COPY web/ web/
RUN npm run build:web

# Stage 2: production image
FROM node:22-slim AS runtime
WORKDIR /app

# Install production deps only — --ignore-scripts prevents lifecycle
# scripts in production packages running as root
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

# Copy compiled output
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/web/dist ./web/dist

# Create non-root user and data directory before switching user
RUN useradd --system --create-home --home-dir /data koa \
    && mkdir -p /data \
    && chown koa:koa /data

ENV KOA_HOME=/data
EXPOSE 3000

# Declare /data as a volume so persistent data survives container restarts.
# Mount this volume: docker run -v koa-data:/data ...
VOLUME /data

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD curl -sf http://localhost:3000/api/ping || exit 1

USER koa

CMD ["node", "dist/cli/index.js", "web", "--port", "3000"]
