FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies
FROM base AS install
COPY bun.lock package.json ./
COPY apps/relay/package.json apps/relay/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
COPY tooling/typescript/package.json tooling/typescript/
COPY patches/ patches/
RUN bun install --frozen-lockfile --production

# Final
FROM base
COPY --from=install /app/node_modules ./node_modules
COPY apps/relay/ apps/relay/
COPY packages/db/ packages/db/
COPY packages/shared/ packages/shared/
COPY tooling/typescript/ tooling/typescript/

EXPOSE 8080
CMD ["bun", "run", "apps/relay/src/index.ts"]
