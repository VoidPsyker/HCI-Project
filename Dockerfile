# syntax=docker/dockerfile:1

FROM node:22-bookworm AS build
WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/server/package.json apps/server/package.json
COPY packages/analysis/package.json packages/analysis/package.json
COPY packages/scoring/package.json packages/scoring/package.json
COPY packages/taxonomy/package.json packages/taxonomy/package.json
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8787

COPY --from=build /app/package.json /app/package-lock.json /app/tsconfig.base.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps ./apps
COPY --from=build /app/packages ./packages

RUN mkdir -p /app/data /app/exports
EXPOSE 8787

CMD ["npm", "run", "start"]
