FROM node:20-alpine AS builder

WORKDIR /app

RUN npm install -g pnpm

COPY pnpm-lock.yaml pnpm-workspace.yaml rush.json ./
COPY servers/todo-service/package.json ./servers/todo-service/
COPY packages/ ./packages/

RUN pnpm install --frozen-lockfile

COPY servers/todo-service ./servers/todo-service
COPY packages ./packages

WORKDIR /app/servers/todo-service
RUN pnpm build

FROM node:20-alpine

WORKDIR /app

RUN npm install -g pnpm

COPY --from=builder /app/servers/todo-service/dist ./dist
COPY --from=builder /app/servers/todo-service/package.json ./package.json
COPY --from=builder /app/servers/todo-service/node_modules ./node_modules

EXPOSE 3005

CMD ["node", "dist/main.js"]
