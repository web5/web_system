FROM node:20-alpine AS builder

WORKDIR /app

RUN npm install -g pnpm

COPY pnpm-lock.yaml pnpm-workspace.yaml rush.json ./
COPY servers/auth-service/package.json ./servers/auth-service/
COPY packages/ ./packages/

RUN pnpm install --frozen-lockfile

COPY servers/auth-service ./servers/auth-service
COPY packages ./packages

WORKDIR /app/servers/auth-service
RUN pnpm build

FROM node:20-alpine

WORKDIR /app

RUN npm install -g pnpm

COPY --from=builder /app/servers/auth-service/dist ./dist
COPY --from=builder /app/servers/auth-service/package.json ./package.json
COPY --from=builder /app/servers/auth-service/node_modules ./node_modules

EXPOSE 3001

CMD ["node", "dist/main.js"]
