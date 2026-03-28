# Stage 1: build
FROM node:20-alpine AS builder
WORKDIR /app

# Enable pnpm
RUN npm install -g pnpm

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

# Accept Maps API key at build time so Vite can bake it into the bundle
ARG VITE_MAPS_API_KEY=""
ENV VITE_MAPS_API_KEY=$VITE_MAPS_API_KEY

RUN pnpm run build

# Stage 2: serve
FROM nginx:alpine AS runtime

# Copy template but DO NOT put it in the auto-execute templates folder
COPY nginx.conf.template /app/nginx.conf.template
COPY --from=builder /app/dist /usr/share/nginx/html

ENV PORT=8080
ENV BACKEND_URL=http://localhost:8000

# Explicitly substitute the two critical deployment variables universally utilizing standard sed instead of unpredictable Alpine envsubst
CMD sed -e "s|\${PORT}|$PORT|g" -e "s|\${BACKEND_URL}|$BACKEND_URL|g" /app/nginx.conf.template > /etc/nginx/conf.d/default.conf && nginx -g 'daemon off;'
