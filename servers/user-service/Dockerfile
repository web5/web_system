FROM node:20-alpine AS builder

WORKDIR /app

RUN npm install -g pnpm

COPY pnpm-lock.yaml pnpm-workspace.yaml rush.json ./
COPY servers/user-service/package.json ./servers/user-service/
COPY packages/ ./packages/

RUN pnpm install --frozen-lockfile

COPY servers/user-service ./servers/user-service
COPY packages ./packages

WORKDIR /app/servers/user-service
RUN pnpm build

FROM node:20-alpine

WORKDIR /app

RUN npm install -g pnpm

COPY --from=builder /app/servers/user-service/dist ./dist
COPY --from=builder /app/servers/user-service/package.json ./package.json
COPY --from=builder /app/servers/user-service/node_modules ./node_modules

EXPOSE 3002

CMD ["node", "dist/main.js"]
