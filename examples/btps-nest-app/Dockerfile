# btps-server image for examples/btps-nest-app (EBA-166).
#
# BUILD CONTEXT IS THE REPOSITORY ROOT, not this directory. The app depends on
# @btps/sdk through `portal:../..` (EBA-156), i.e. the repository root, which a
# context of "." cannot see. docker-compose.yml sets this up; by hand:
#
#   docker build -f examples/btps-nest-app/Dockerfile --target production .
#
# (run from the repository root). Every COPY below reads a git-tracked path, so
# the build works from a fresh clone: no hand-built package.tgz, no local dist/.
#
# Why the SDK is packed and then copied in as a real directory:
#   With Yarn's node-modules linker, a portal is installed as a *symlink*
#   (node_modules/@btps/sdk -> ../../../..), and the SDK's own dependencies
#   (lodash, zod, split2, proper-lockfile) are hoisted into the app's
#   node_modules, not the portal target. Node resolves a symlinked package from
#   its real path, so at runtime those imports would fail without
#   --preserve-symlinks. So each stage installs exactly as the committed
#   lockfile says (--immutable, against the portal), then replaces the symlink
#   with a real copy of the packed SDK, which is what a consumer of the
#   published package would get. The image then contains no symlink out of
#   node_modules and needs no --preserve-symlinks.

# ---------- Stage 1: sdk - build @btps/sdk from source and pack it ----------
# Debian, not Alpine: the SDK build runs scripts/add-license-header.sh, which
# needs bash. Only the packed output (/pkg) leaves this stage.
FROM node:20.11.1-bookworm-slim AS sdk

WORKDIR /sdk

COPY .yarn/releases ./.yarn/releases
COPY .yarnrc.yml package.json yarn.lock ./
RUN yarn install --immutable

COPY tsconfig.json tsconfig.build.json LICENSE NOTICE README.md ./
COPY build ./build
COPY scripts ./scripts
COPY src ./src
RUN yarn build \
 && yarn pack -o /tmp/btps-sdk.tgz \
 && mkdir /pkg \
 && tar -xzf /tmp/btps-sdk.tgz -C /pkg --strip-components=1 \
 && test -f /pkg/dist/index.js

# ---------- Stage 2: builder - install, build and smoke-test the app ----------
FROM node:20.11.1-alpine AS builder

# /repo mirrors the repository layout, so `portal:../..` from the app resolves
# to /repo, where the packed SDK sits - and the lockfile matches unchanged.
WORKDIR /repo/examples/btps-nest-app
COPY --from=sdk /pkg /repo
COPY --from=sdk /pkg /sdk-pkg

COPY examples/btps-nest-app/.yarn/releases ./.yarn/releases
COPY examples/btps-nest-app/.yarnrc.yml examples/btps-nest-app/package.json examples/btps-nest-app/yarn.lock ./
RUN yarn install --immutable \
 && test -L node_modules/@btps/sdk \
 && rm node_modules/@btps/sdk \
 && cp -R /sdk-pkg node_modules/@btps/sdk

COPY examples/btps-nest-app/tsconfig.json examples/btps-nest-app/nest-cli.json examples/btps-nest-app/btps.middleware.mjs ./
COPY examples/btps-nest-app/src ./src
COPY examples/btps-nest-app/smoke ./smoke
# The smoke test imports every SDK subpath the app uses, and every compiled
# module that uses one - a failure here fails the image build.
RUN yarn build && node smoke/sdk-subpaths.mjs

# ---------- Stage 3: prod-deps - production dependencies only ----------
FROM node:20.11.1-alpine AS prod-deps

WORKDIR /repo/examples/btps-nest-app
COPY --from=sdk /pkg /repo
COPY --from=sdk /pkg /sdk-pkg

COPY examples/btps-nest-app/.yarn/releases ./.yarn/releases
COPY examples/btps-nest-app/.yarnrc.yml examples/btps-nest-app/package.json examples/btps-nest-app/yarn.lock ./
RUN yarn workspaces focus --production \
 && test -L node_modules/@btps/sdk \
 && rm node_modules/@btps/sdk \
 && cp -R /sdk-pkg node_modules/@btps/sdk

# ---------- Stage 4: production ----------
FROM node:20.11.1-alpine AS production

WORKDIR /var/www

# package.json is needed at runtime: "type": "module" makes dist/*.js ESM.
COPY examples/btps-nest-app/package.json ./
COPY --from=prod-deps /repo/examples/btps-nest-app/node_modules ./node_modules
COPY --from=builder /repo/examples/btps-nest-app/btps.middleware.mjs ./btps.middleware.mjs
COPY --from=builder /repo/examples/btps-nest-app/dist ./dist

# Fail the build if @btps/sdk is still a link or cannot load in this layout.
RUN test -d node_modules/@btps/sdk && test ! -L node_modules/@btps/sdk \
 && node --input-type=module -e "await import('@btps/sdk'); console.log('@btps/sdk loads')"

EXPOSE 3443
CMD ["node", "./dist/main.js"]
