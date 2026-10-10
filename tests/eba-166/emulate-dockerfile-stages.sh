#!/usr/bin/env bash
# EBA-166: a no-Docker stand-in for the btps-server image build, for machines
# without a Docker daemon. It replays every RUN step of
# examples/btps-nest-app/Dockerfile, in order, on a `git archive` export of
# HEAD (a fresh-clone stand-in), copying the same paths each COPY names.
#
# THIS IS NOT AN IMAGE BUILD. It uses the host's node and yarn, not the
# node:20.11.1 base images; it does not exercise Docker's COPY semantics,
# build context or .dockerignore. It shows that the dependency resolution the
# Dockerfile relies on (portal:../.. against a packed SDK, symlink
# replacement, production focus, runtime import) works from tracked files.
# The acceptance signal is a real `docker build` (docker-build.integration
# .test.mjs, or the CI step).
#
#   bash tests/eba-166/emulate-dockerfile-stages.sh <empty-workdir>
set -euo pipefail
W=${1:?usage: $0 <empty-workdir>}; mkdir -p "$W"; W=$(cd "$W" && pwd)
SRC=$(git rev-parse --show-toplevel)
echo "commit $(git -C "$SRC" rev-parse HEAD)  node $(node --version)  yarn(host) $(yarn --version)"
C="$W/clone"; mkdir -p "$C"; git -C "$SRC" archive HEAD | tar -x -C "$C"
for p in examples/btps-nest-app/package.tgz dist node_modules examples/btps-nest-app/node_modules; do
  test ! -e "$C/$p" || { echo "export is not fresh: $p present"; exit 1; }
done; echo "fresh export: no package.tgz, dist or node_modules"

echo "== stage sdk"; S="$W/sdk"; mkdir -p "$S/.yarn"
cp -R "$C/.yarn/releases" "$S/.yarn/"; cp "$C"/{.yarnrc.yml,package.json,yarn.lock} "$S/"
(cd "$S" && yarn install --immutable | tail -n 2)
cp -R "$C"/{tsconfig.json,tsconfig.build.json,LICENSE,NOTICE,README.md,build,scripts,src} "$S/"
(cd "$S" && yarn build | tail -n 2 && yarn pack -o "$W/btps-sdk.tgz" | tail -n 1)
mkdir "$W/pkg"; tar -xzf "$W/btps-sdk.tgz" -C "$W/pkg" --strip-components=1
test -f "$W/pkg/dist/index.js"; echo "pkg/dist/index.js present"

stage() { # $1 stage dir, $2 install command
  local A="$W/$1/repo/examples/btps-nest-app"; mkdir -p "$W/$1/repo"
  cp -R "$W/pkg/." "$W/$1/repo/"; mkdir -p "$A/.yarn"
  cp -R "$C/examples/btps-nest-app/.yarn/releases" "$A/.yarn/"
  cp "$C/examples/btps-nest-app"/{.yarnrc.yml,package.json,yarn.lock} "$A/"
  (cd "$A" && $2 | tail -n 2 && test -L node_modules/@btps/sdk \
    && echo "node_modules/@btps/sdk is a symlink; replacing with packed SDK" \
    && rm node_modules/@btps/sdk && cp -R "$W/pkg" node_modules/@btps/sdk)
}
echo "== stage builder"; stage builder "yarn install --immutable"
A="$W/builder/repo/examples/btps-nest-app"
cp -R "$C/examples/btps-nest-app"/{tsconfig.json,nest-cli.json,btps.middleware.mjs,src,smoke} "$A/"
(cd "$A" && yarn build | tail -n 2 && node smoke/sdk-subpaths.mjs | tail -n 5)

echo "== stage prod-deps"; stage prod-deps "yarn workspaces focus --production"

echo "== stage production"; P="$W/production"; mkdir -p "$P"
cp "$C/examples/btps-nest-app/package.json" "$P/"
cp -R "$W/prod-deps/repo/examples/btps-nest-app/node_modules" "$P/"
cp -R "$A/btps.middleware.mjs" "$A/dist" "$P/"
(cd "$P" && test -d node_modules/@btps/sdk && test ! -L node_modules/@btps/sdk \
  && node --input-type=module -e "await import('@btps/sdk'); console.log('@btps/sdk loads')")
echo "== all stages replayed OK (emulation, not an image build)"
