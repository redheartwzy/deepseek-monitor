# ---- Build 阶段：仅安装生产依赖 ----
FROM node:20-alpine AS build
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --only=production --no-audit --no-fund

# ---- Run 阶段：多阶段减小镜像体积 ----
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

# better-sqlite3 原生模块需要编译工具
RUN apk add --no-cache build-base python3 && \
    npm cache clean --force

# 从 build 阶段复制 node_modules，避免重复安装
COPY --from=build /app/node_modules ./node_modules
COPY . .

# 创建 SQLite 数据目录（Railway 使用临时磁盘，可挂载持久化卷）
RUN mkdir -p data

EXPOSE 3000

# 健康检查：通知 Railway 服务已就绪
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "app.js"]
