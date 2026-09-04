# 微信云托管 Dockerfile
FROM node:20-alpine

WORKDIR /app

# 先装依赖（利用镜像层缓存）
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# 再拷代码
COPY src ./src

ENV NODE_ENV=production
# 云托管要求监听 80 端口（在控制台可改，默认80）
ENV PORT=80
EXPOSE 80

CMD ["node", "src/app.js"]
