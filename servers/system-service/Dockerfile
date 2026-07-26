FROM node:20-alpine AS builder

WORKDIR /app

RUN npm install -g pnpm

COPY pnpm-lock.yaml pnpm-workspace.yaml rush.json ./
COPY servers/system-service/package.json ./servers/system-service/
COPY packages/ ./packages/

RUN pnpm install --frozen-lockfile

COPY servers/system-service ./servers/system-service
COPY packages ./packages

WORKDIR /app/servers/system-service
RUN pnpm build

FROM node:20-alpine

WORKDIR /app

RUN npm install -g pnpm

COPY --from=builder /app/servers/system-service/dist ./dist
COPY --from=builder /app/servers/system-service/package.json ./package.json
COPY --from=builder /app/servers/system-service/node_modules ./node_modules

EXPOSE 3004

CMD ["node", "dist/main.js"]
