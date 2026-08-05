FROM node:24-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
RUN apk add --no-cache iputils
RUN addgroup -S ispcontrol && adduser -S ispcontrol -G ispcontrol
RUN mkdir -p /var/lib/ispcontrol && chown ispcontrol:ispcontrol /var/lib/ispcontrol
COPY --from=build --chown=ispcontrol:ispcontrol /app/dist ./dist
USER ispcontrol
VOLUME ["/var/lib/ispcontrol"]
EXPOSE 9080
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:9080/health || exit 1
CMD ["node", "dist/main.js"]
