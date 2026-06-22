# KOS WL Bot — Next.js dashboard image. Build context = repo root.
#   docker build -f apps/dashboard/Dockerfile -t kos-dashboard .
FROM node:20-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

# ---- build ----
FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
# Prisma client is needed for type generation; DB is not contacted at build.
RUN pnpm --filter @kos/db build \
 && pnpm --filter @kos/dashboard build

# ---- runtime ----
FROM base AS runner
ENV NODE_ENV=production
COPY --from=build /app /app
WORKDIR /app/apps/dashboard
EXPOSE 3001
CMD ["pnpm", "start"]
