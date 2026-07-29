# Base image pinned by digest, tag kept alongside it. The tag alone is mutable:
# `node:26-alpine` means a different image every few weeks, so two builds of the
# same commit are not the same artifact. The trade is real and deliberate — a
# digest does NOT pick up base-image CVE fixes on its own — and what pays for it
# is Dependabot's docker ecosystem, which understands `tag@digest` and bumps both
# together (see .github/dependabot.yml). Without that automation this pin would
# rot, which is the failure mode worth knowing before copying the pattern.
# Resolved 2026-07-29: node:26-alpine == 26.5.0-alpine3.24.

# ---- Build stage ----
FROM node:26-alpine@sha256:e88a35be04478413b7c71c455cd9865de9b9360e1f43456be5951032d7ac1a66 AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build

# ---- Runtime stage ----
FROM node:26-alpine@sha256:e88a35be04478413b7c71c455cd9865de9b9360e1f43456be5951032d7ac1a66 AS runtime
RUN apk add --no-cache tini
ENV NODE_ENV=production
WORKDIR /app

COPY package*.json ./
# npm is deleted once it has done its job. It is not a scanner workaround: the
# five HIGH/CRITICAL CVEs Trivy reports on this base image are all inside npm's
# own bundled dependencies (tar, undici, brace-expansion under
# /usr/local/lib/node_modules/npm), none of them in /app, and the node:26-alpine
# image ships no fixed npm yet. The service runs `node dist/main.js` and never
# npm, so removing it stops shipping the vulnerable code instead of suppressing
# the finding — and a package manager inside a production image is surface in its
# own right. Consequence for operators: inside the container the seed is
# `node dist/seed/seed.command.js`, NOT `npm run seed:prod` (see README).
RUN npm ci --omit=dev && npm cache clean --force \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
COPY --from=builder /app/dist ./dist

USER node
EXPOSE 3000

# Readiness: the process is healthy only when GET /health reports 200.
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
