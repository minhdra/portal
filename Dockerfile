# syntax=docker/dockerfile:1
# Nhiều tầng: deps -> build -> (migrate | runner). Base glibc (bookworm-slim): argon2 có binary dựng sẵn cho glibc,
# alpine (musl) phải biên dịch lại; worker_threads chạy như nhau. Không chứa .env/secret (xem .dockerignore).
ARG NODE_IMAGE=node:22-bookworm-slim

# ---- deps: cài toàn bộ phụ thuộc (gồm dev: prisma CLI, tsx, typescript) theo lockfile
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# openssl phải có TRƯỚC npm ci: prisma tải schema engine đúng nền (openssl 3) lúc cài, không cần ghi node_modules khi chạy
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

# ---- build: prisma generate + next build (output: standalone)
FROM deps AS build
COPY . .
# generate đọc DATABASE_URL (prisma.config.ts) và src/server/db.ts tạo PrismaClient ngay khi import (next build
# "collect page data"): chỉ giá trị giả, KHÔNG kết nối, không nằm trong ảnh cuối.
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
RUN npx prisma generate && npm run build

# ---- migrate: ảnh one-shot chạy `prisma migrate deploy` rồi seed idempotent (không nằm trong CMD của portal)
FROM ${NODE_IMAGE} AS migrate
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
# prisma schema engine cần openssl (ảnh slim không có)
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY package.json prisma.config.ts tsconfig.json ./
COPY prisma ./prisma
COPY --from=build /app/prisma/generated ./prisma/generated
USER node
CMD ["sh", "-c", "npx prisma migrate deploy && npx tsx prisma/seed.ts"]

# ---- runner: chỉ bản standalone + static + public, user không root
FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3100 HOSTNAME=0.0.0.0
RUN mkdir -p /data/uploads && chown node:node /data/uploads
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3100
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3100/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "server.js"]
