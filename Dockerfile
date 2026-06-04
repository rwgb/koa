# syntax=docker/dockerfile:1
# Stage 1: build TypeScript + web
FROM node:20-slim AS builder
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
FROM node:20-slim AS runtime
WORKDIR /app

# Install production deps only
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy compiled output
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/web/dist ./web/dist

# non-root user
RUN useradd --system --create-home --home-dir /data koa
ENV KOA_HOME=/data
EXPOSE 3000
USER koa

CMD ["node", "dist/cli/index.js", "web", "--port", "3000"]
