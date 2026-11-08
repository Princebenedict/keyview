FROM node:22-slim
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY public ./public
ENV PORT=3000
EXPOSE 3000
CMD ["node", "src/server.js"]
