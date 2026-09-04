# 从 GitHub 仓库导入部署时使用本文件（构建上下文 = 仓库根目录）
# 本地部署仍走 server/Dockerfile（cloudbaserc.json localPath=./server）
FROM node:20-alpine

WORKDIR /app

# 先装依赖（利用镜像层缓存）
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

# 再拷代码
COPY server/src ./src

ENV NODE_ENV=production
# 云托管要求监听 80 端口（在控制台可改，默认80）
ENV PORT=80
EXPOSE 80

CMD ["node", "src/app.js"]
