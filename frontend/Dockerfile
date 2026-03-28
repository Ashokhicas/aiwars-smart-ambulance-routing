# Stage 1: build
FROM node:20-alpine AS builder
WORKDIR /app

# Enable pnpm
RUN npm install -g pnpm

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm run build

# Stage 2: serve
FROM nginx:alpine AS runtime

# nginx:alpine supports envsubst on templates out of the box
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=builder /app/dist /usr/share/nginx/html

# Default fallback env vars
ENV PORT=8080
ENV BACKEND_URL=http://localhost:8000
