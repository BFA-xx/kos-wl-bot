# KOS WL Bot — Discord bot image. Build context = repo root.
#   docker build -f apps/bot/Dockerfile -t kos-bot .
FROM node:20-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

# ---- build ----
FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @kos/db build \
 && pnpm --filter @kos/bot build

# ---- runtime ----
FROM base AS runner
ENV NODE_ENV=production
COPY --from=build /app /app
WORKDIR /app
# Apply pending migrations, then launch the bot.
CMD ["sh", "-c", "pnpm --filter @kos/db migrate:deploy && node apps/bot/dist/index.js"]
