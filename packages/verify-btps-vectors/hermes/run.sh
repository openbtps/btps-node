#!/usr/bin/env bash
# Runs `yarn verify:btps-vectors` with Hermes 250829098.0.17, the engine
# react-native@0.86.3 ships, in a container (EBA-150). Needs only Docker;
# installs nothing on the host.
#
#   packages/verify-btps-vectors/hermes/run.sh [verify-btps-vectors options]
#
# The first run builds the image (Hermes from source, a few minutes). The
# checkout is mounted read-write; dependencies go in a Docker volume, so the
# host's node_modules is neither used nor touched.
set -euo pipefail

IMAGE=btps-hm-hermes:250829098.0.17
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"

docker build --quiet --tag "$IMAGE" "$HERE" >/dev/null
docker run --rm --name "btps-hm-verify-$$" \
  --volume "$REPO":/work \
  --volume btps-hm-node-modules:/work/node_modules \
  --workdir /work \
  "$IMAGE" \
  bash -c 'node .yarn/releases/yarn-*.cjs install --immutable >/dev/null \
    && node packages/verify-btps-vectors/bin/verify-btps-vectors.mjs \
         --known-failing test/vectors/known-failing.json "$@"' -- "$@"
