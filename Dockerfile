FROM node:22-alpine AS build
WORKDIR /app
ARG VITE_BASE=/simulation/
ARG VITE_PLATFORM_URL=/api
ENV VITE_BASE=$VITE_BASE
ENV VITE_PLATFORM_URL=$VITE_PLATFORM_URL
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
