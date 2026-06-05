# syntax=docker/dockerfile:1
# Stage 1: build TypeScript + web
FROM node:22-slim AS builder
WORKDIR /app

# Install build deps (scripts enabled — required for native modules e.g. better-sqlite3)
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

# Install production deps only. Scripts are enabled because native modules
# (better-sqlite3) require post-install build steps.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy compiled output
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/web/dist ./web/dist

# Create non-root user and data directory with correct ownership.
# VOLUME is declared here (before USER switch) so Docker tracks the mount point.
RUN useradd --system --create-home --home-dir /data koa \
    && mkdir -p /data \
    && chown koa:koa /data

# Declare /data as a volume so persistent data survives container restarts.
# Mount it: docker run -v koa-data:/data ...
VOLUME /data

ENV KOA_HOME=/data
EXPOSE 3000

# Node.js-based health check — no curl dependency required on slim image
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "require('http').get('http://localhost:3000/api/ping',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

USER koa

CMD ["node", "dist/cli/index.js", "web", "--port", "3000"]
