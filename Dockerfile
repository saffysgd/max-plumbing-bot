FROM node:24-bookworm-slim

WORKDIR /usr/src/app

RUN corepack enable && corepack prepare pnpm@10.26.1 --activate

COPY . .

# MAX's API requires the Russian Trusted CA chain for outbound TLS verification.
ENV NODE_EXTRA_CA_CERTS=/usr/src/app/certs/max-api-trusted-ca.pem

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @workspace/api-server run build

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["pnpm", "--filter", "@workspace/api-server", "run", "start"]