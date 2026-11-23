FROM oven/bun:1

RUN apt-get update \
  && apt-get install -y --no-install-recommends git \
  && rm -rf /var/lib/apt/lists/*

RUN git config --global --add safe.directory '*'

WORKDIR /app

COPY package.json bun.lock* ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/server/package.json ./packages/server/
COPY packages/web/package.json ./packages/web/

RUN bun install --frozen-lockfile || bun install

COPY packages ./packages

RUN bun run --cwd packages/web build

ENV DATA_DIR=/app/data
ENV HOST=0.0.0.0
ENV PORT=4321

EXPOSE 4321

CMD ["bun", "run", "packages/server/src/index.ts"]
