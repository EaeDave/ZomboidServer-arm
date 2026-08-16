# Build context: repository root. Configure Coolify to use panel/Dockerfile.
# Bun 1.4.0-canary.1; pin the multi-architecture manifest for reproducible Coolify builds.
FROM oven/bun:canary@sha256:c5a71eb0366bcc940e0542afe613e63badab21d000c31dda58f5ce52aeddf0ad AS build

WORKDIR /app/panel
COPY panel/package.json panel/bun.lock panel/tsconfig.json panel/drizzle.config.ts panel/.env.example panel/.oxlintignore ./
COPY panel/apps ./apps
COPY panel/packages ./packages

RUN bun install --frozen-lockfile
RUN bun run check
RUN bun test
RUN bun run build

FROM oven/bun:canary@sha256:c5a71eb0366bcc940e0542afe613e63badab21d000c31dda58f5ce52aeddf0ad

WORKDIR /app/panel
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

COPY --from=build /app/panel/package.json ./package.json
COPY --from=build /app/panel/bun.lock ./bun.lock
COPY --from=build /app/panel/drizzle.config.ts ./drizzle.config.ts
COPY --from=build /app/panel/apps ./apps
COPY --from=build /app/panel/packages ./packages
RUN bun install --frozen-lockfile --production

USER bun
EXPOSE 3000
CMD ["bun", "run", "start"]
