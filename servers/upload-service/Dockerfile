FROM node:20-alpine AS builder

WORKDIR /app

RUN npm install -g pnpm

COPY pnpm-lock.yaml pnpm-workspace.yaml rush.json ./
COPY servers/upload-service/package.json ./servers/upload-service/
COPY packages/ ./packages/

RUN pnpm install --frozen-lockfile

COPY servers/upload-service ./servers/upload-service
COPY packages ./packages

WORKDIR /app/servers/upload-service
RUN pnpm build

FROM node:20-alpine

WORKDIR /app

RUN npm install -g pnpm

COPY --from=builder /app/servers/upload-service/dist ./dist
COPY --from=builder /app/servers/upload-service/package.json ./package.json
COPY --from=builder /app/servers/upload-service/node_modules ./node_modules

EXPOSE 3006

CMD ["node", "dist/main.js"]
