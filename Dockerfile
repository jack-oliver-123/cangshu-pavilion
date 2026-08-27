FROM node:24-bookworm-slim AS build

WORKDIR /app
RUN corepack enable

COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app
RUN corepack enable

COPY --from=build --chown=node:node /app /app
RUN install -d -o node -g node /app/data

USER node
EXPOSE 4100
CMD ["pnpm", "--filter", "@cangshu/server", "start"]
