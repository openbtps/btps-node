# ---------- Stage 1: Builder ----------
FROM node:20.11.1-alpine AS builder

WORKDIR /var/www

# Copy Yarn v4 binary + config
COPY .yarn/releases ./.yarn/releases
COPY .yarnrc.yml package.json yarn.lock ./
COPY build ./build/
RUN yarn install

# Build the app
COPY tsconfig.json ./
COPY src/ ./src/
COPY .well-known/ ./.well-known/
RUN yarn build

# ---------- Stage 2: Production ----------
FROM node:20.11.1-alpine AS production

WORKDIR /var/www

# Copy Yarn binary + config
COPY .yarn/releases ./.yarn/releases
COPY .yarnrc.yml package.json yarn.lock ./

# Install only production deps
RUN yarn workspaces focus --production

# Copy built app and static files
COPY --from=builder /var/www/dist ./dist
COPY --from=builder /var/www/.well-known ./.well-known

EXPOSE 3443
CMD ["node", "./dist/server/index.js"]
  