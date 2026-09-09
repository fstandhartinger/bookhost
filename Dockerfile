FROM node:22-slim AS deps
WORKDIR /bookhost
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
FROM node:22-slim AS builder
WORKDIR /bookhost
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /bookhost/node_modules ./node_modules
COPY . .
RUN npm run build
FROM node:22-slim AS runner
WORKDIR /bookhost
ENV TRUST_PROXY=true NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/* && groupadd --system --gid 1001 nodejs && useradd --system --uid 1001 --gid nodejs nextjs
COPY --from=builder --chown=nextjs:nodejs /bookhost/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /bookhost/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /bookhost/public ./public
COPY --from=builder --chown=nextjs:nodejs /bookhost/content ./content
COPY --from=builder --chown=nextjs:nodejs /bookhost/db ./db
COPY --from=builder --chown=nextjs:nodejs /bookhost/scripts ./scripts
USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 CMD curl --fail --silent http://127.0.0.1:3000/healthz || exit 1
ENTRYPOINT ["sh","scripts/entrypoint.sh"]
