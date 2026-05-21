FROM node:20-alpine AS builder

WORKDIR /app

# 复制依赖文件
COPY package.json pnpm-lock.yaml ./

# 安装 pnpm
RUN npm install -g pnpm@9.15.0

# 安装依赖
RUN pnpm install --frozen-lockfile

# 复制源代码
COPY . .

# 构建
RUN pnpm run build

# 生产镜像
FROM node:20-alpine

WORKDIR /app

# 复制构建产物
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

EXPOSE 3003

CMD ["node", "dist/main"]
