FROM node:24-alpine AS builder

WORKDIR /app

# Copy root and workspace package files
COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/package.json shared/tsconfig.json ./shared/
COPY server/package.json server/tsconfig.json ./server/
COPY web/package.json web/tsconfig.json web/vite.config.ts web/index.html ./web/

# Install all workspace dependencies
RUN npm ci

# Copy source codes
COPY shared/src ./shared/src
COPY server/src ./server/src
COPY web/src ./web/src

# Build shared library, server, and web frontend
RUN npm --workspace=shared run build
RUN npm --workspace=server run build
RUN npm --workspace=web run build

# --- Production Image ---
FROM node:24-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4000

# Install production dependencies only
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
RUN npm ci --omit=dev

# Copy compiled outputs from builder
COPY --from=builder /app/shared/dist ./shared/dist
COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/web/dist ./web/dist

# Create persistent data volume directory for SQLite database
RUN mkdir -p /app/data

EXPOSE 4000

CMD ["node", "server/dist/index.js"]
