# Node.js Express 主應用 Dockerfile
FROM node:18-alpine
LABEL "language"="nodejs"

WORKDIR /app

# 複製 package.json 和 lock 文件
COPY package*.json ./

# 安裝依賴
RUN npm ci --only=production

# 複製所有代碼和靜態文件
COPY . .

# 暴露端口
EXPOSE 3001

# 啟動應用
CMD ["node", "index.js"]
