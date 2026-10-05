# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig*.json vite.config.ts tailwind.config.ts postcss.config.js index.html ./
COPY src ./src
COPY public ./public
RUN npm run build

# Production stage
FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html

# nginx renders this template with the environment at container start
COPY nginx.conf.template /etc/nginx/templates/default.conf.template

# Where /api is proxied to. The backend uses host networking, so this is the Docker host.
ENV PXLS_BACKEND_URL=http://host.docker.internal:3400

EXPOSE 80
