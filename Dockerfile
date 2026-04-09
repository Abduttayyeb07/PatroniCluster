# ── Stage 1: Build ────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files first for better layer caching
COPY package.json package-lock.json ./
RUN npm ci

# Copy source and compile
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ── Stage 2: Production ──────────────────────────
FROM node:20-alpine AS production

WORKDIR /app

# Create non-root user for security
RUN addgroup -S botgroup && adduser -S botuser -G botgroup

# Copy package files and install production-only deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy compiled output from builder
COPY --from=builder /app/dist ./dist

# Create logs and SSH directories
RUN mkdir -p /app/logs /app/.ssh && chown -R botuser:botgroup /app/logs /app/.ssh

# Copy entrypoint script
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Switch to non-root user
USER botuser

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "process.exit(0)" || exit 1

ENV NODE_ENV=production

ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["node", "dist/index.js"]
