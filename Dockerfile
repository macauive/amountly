FROM postgrest/postgrest:v16.4 AS postgrest
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --include=dev
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1 NEXT_PUBLIC_BACKEND=render
RUN npm run lint && npm run build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 NEXT_PUBLIC_BACKEND=render
COPY --from=postgrest /bin/postgrest /usr/local/bin/postgrest
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
COPY --chown=node:node scripts/render/start.mjs ./start.mjs
USER node
EXPOSE 10000
CMD ["node", "start.mjs"]
