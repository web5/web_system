FROM node:20-alpine AS builder

WORKDIR /app

RUN npm install -g pnpm

COPY pnpm-lock.yaml pnpm-workspace.yaml rush.json ./
COPY servers/gateway/package.json ./servers/gateway/
COPY packages/ ./packages/

RUN pnpm install --frozen-lockfile

COPY servers/gateway ./servers/gateway
COPY packages ./packages

WORKDIR /app/servers/gateway
RUN pnpm build

FROM node:20-alpine

WORKDIR /app

RUN npm install -g pnpm

COPY --from=builder /app/servers/gateway/dist ./dist
COPY --from=builder /app/servers/gateway/package.json ./package.json
COPY --from=builder /app/servers/gateway/node_modules ./node_modules

EXPOSE 3000

CMD ["node", "dist/main.js"]
