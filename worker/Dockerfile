FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc

FROM node:20-alpine AS runtime
RUN apk add --no-cache dumb-init
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=builder /app/dist ./dist
USER node
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
