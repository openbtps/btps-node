# ---------- Stage 1: Builder ----------
FROM node:20.11.1-alpine AS builder

WORKDIR /var/www

# Copy Yarn v4 binary + config
COPY .yarn/releases ./.yarn/releases
COPY .yarnrc.yml package.json yarn.lock ./
COPY package.tgz ./package.tgz
COPY btps.middleware.mjs ./btps.middleware.mjs
RUN yarn install

# Build the app
COPY tsconfig.json ./
COPY src/ ./src/
RUN yarn build

# ---------- Stage 2: Production ----------
FROM node:20.11.1-alpine AS production

WORKDIR /var/www

# Copy Yarn binary + config
COPY .yarn/releases ./.yarn/releases
COPY .yarnrc.yml package.json yarn.lock ./
COPY package.tgz ./package.tgz

# Install only production deps
RUN yarn workspaces focus --production

# Copy built app
COPY --from=builder /var/www/btps.middleware.mjs ./btps.middleware.mjs
COPY --from=builder /var/www/dist ./dist

# Clean up unnecessary files
RUN rm -rf package.tgz

EXPOSE 3443
CMD ["node", "./dist/main.js"]
