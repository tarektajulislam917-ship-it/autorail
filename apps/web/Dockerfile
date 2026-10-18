FROM node:20-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json* ./
COPY apps/web/package.json apps/web/package.json
COPY services/browser-service/package.json services/browser-service/package.json
RUN npm ci --workspace @live-browser/web --include-workspace-root

FROM dependencies AS builder
COPY apps/web apps/web
RUN npm run build --workspace @live-browser/web

FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV APP_HOST=0.0.0.0

COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=builder /app/apps/web/.next ./apps/web/.next
COPY --from=builder /app/apps/web/public ./apps/web/public
COPY --from=builder /app/apps/web/package.json /app/apps/web/server.mjs ./apps/web/
COPY --from=builder /app/apps/web/next.config.ts /app/apps/web/tsconfig.json /app/apps/web/next-env.d.ts ./apps/web/

WORKDIR /app/apps/web
EXPOSE 3000
CMD ["node", "server.mjs"]
