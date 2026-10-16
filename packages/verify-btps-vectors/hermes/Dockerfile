# The Hermes CLI that react-native@0.86.3 ships (EBA-150), built from source
# on top of the Node image the vectors run under, so the golden vectors run
# inside the real engine. See ../README.md, "Hermes".
#
# facebook/hermes publishes no Hermes V1 CLI binary (its GitHub releases stop
# at v0.13.0, and the hermes-compiler npm package carries only hermesc, the
# compiler), so the CLI is built from the tag react-native@0.86.3 names:
# its hermes-compiler dependency, 250829098.0.17, is facebook/hermes tag
# hermes-v250829098.0.17. The build refuses any other commit.

ARG NODE_IMAGE=node:20.11.1-bookworm

FROM ${NODE_IMAGE} AS build
ARG HERMES_TAG=hermes-v250829098.0.17
ARG HERMES_COMMIT=3477757eb2475555cf8d8df24bfb1deb0613880d
RUN apt-get update \
 && apt-get install -y --no-install-recommends cmake ninja-build clang python3 \
 && rm -rf /var/lib/apt/lists/*
RUN git clone --quiet --depth 1 --branch "${HERMES_TAG}" https://github.com/facebook/hermes.git /hermes \
 && test "$(git -C /hermes rev-parse HEAD)" = "${HERMES_COMMIT}"
# The release version is the one facebook/hermes's own release builds stamp
# in: the hermes-compiler package version at that commit.
RUN version="$(node -p "require('/hermes/npm/hermes-compiler/package.json').version")" \
 && CC=clang CXX=clang++ cmake -S /hermes -B /out -G Ninja \
      -DCMAKE_BUILD_TYPE=Release \
      -DHERMES_ENABLE_TEST_SUITE=OFF \
      -DHERMES_RELEASE_VERSION="${version}" \
 && ninja -C /out hermes \
 && /out/bin/hermes -version | grep -F "Hermes release version: ${version}"

FROM ${NODE_IMAGE}
COPY --from=build /out/bin/hermes /usr/local/bin/hermes
RUN hermes -version && sha256sum /usr/local/bin/hermes
