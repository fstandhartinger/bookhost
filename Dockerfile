FROM node:22-slim AS deps
WORKDIR /wissen
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
FROM node:22-slim AS builder
WORKDIR /wissen
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /wissen/node_modules ./node_modules
COPY . .
RUN npm run build
FROM node:22-slim AS runner
WORKDIR /wissen
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/* && groupadd --system --gid 1001 nodejs && useradd --system --uid 1001 --gid nodejs nextjs
COPY --from=builder --chown=nextjs:nodejs /wissen/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /wissen/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /wissen/public ./public
COPY --from=builder --chown=nextjs:nodejs /wissen/content ./content
COPY --from=builder --chown=nextjs:nodejs /wissen/db ./db
COPY --from=builder --chown=nextjs:nodejs /wissen/scripts ./scripts
USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 CMD curl --fail --silent http://127.0.0.1:3000/healthz || exit 1
ENTRYPOINT ["sh","scripts/entrypoint.sh"]
