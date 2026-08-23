#!/usr/bin/env bash
# Runs the conformance digest under Hermes — the React Native engine — after
# the same class transform Metro applies, and compares it with Node (V8).
# Hermes has no module loader and no console, so the bundle is IIFE-formatted
# with a print() shim. BigInt is native from Hermes 0.12 (React Native 0.70),
# which is the floor the README claims.
set -euo pipefail

HERMES_VERSION=v0.13.0
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

# SHA-256 of each release asset, so a swapped or corrupted download fails the
# run instead of silently deciding what "Hermes says" about our conformance
# digest. Update alongside HERMES_VERSION.
case "$(uname -s)" in
  Darwin)
    ASSET=hermes-cli-darwin.tar.gz
    ASSET_SHA256=f16b0214f7b96eccbd47766f5a3914e847a4387649b2f6b60820d309879200bd
    ;;
  Linux)
    ASSET=hermes-cli-linux.tar.gz
    ASSET_SHA256=aead6eb0b8f563bb022354352eae32dad96c933330b6c1941b6db17674ca68ae
    ;;
  *) echo "unsupported platform"; exit 1 ;;
esac

echo "fetching Hermes $HERMES_VERSION ($ASSET)"
curl -sSfL -o "$WORK/hermes.tar.gz" \
  "https://github.com/facebook/hermes/releases/download/$HERMES_VERSION/$ASSET"
echo "$ASSET_SHA256  $WORK/hermes.tar.gz" | shasum -a 256 -c -
mkdir -p "$WORK/hermes" && tar xzf "$WORK/hermes.tar.gz" -C "$WORK/hermes"

bun run build
bun build scripts/conformance.mjs --target=browser --format=iife --outfile="$WORK/bundle.js"

node scripts/hermes-transform.mjs "$WORK/bundle.js" "$WORK/hermes.js"

HERMES_DIGEST=$("$WORK/hermes/hermes" "$WORK/hermes.js")
NODE_DIGEST=$(node scripts/conformance.mjs)
echo "hermes: $HERMES_DIGEST"
echo "node:   $NODE_DIGEST"
test "$HERMES_DIGEST" = "$NODE_DIGEST"
echo "Hermes (React Native) output is identical to V8"
