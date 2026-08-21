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

case "$(uname -s)" in
  Darwin) ASSET=hermes-cli-darwin.tar.gz ;;
  Linux) ASSET=hermes-cli-linux.tar.gz ;;
  *) echo "unsupported platform"; exit 1 ;;
esac

echo "fetching Hermes $HERMES_VERSION ($ASSET)"
curl -sL -o "$WORK/hermes.tar.gz" \
  "https://github.com/facebook/hermes/releases/download/$HERMES_VERSION/$ASSET"
mkdir -p "$WORK/hermes" && tar xzf "$WORK/hermes.tar.gz" -C "$WORK/hermes"

bun run build
bun build scripts/conformance.mjs --target=browser --format=iife --outfile="$WORK/bundle.js"

npm install --no-save --prefix "$WORK" \
  @babel/core@7.26.0 @babel/plugin-transform-classes@7.25.9 @babel/plugin-transform-class-properties@7.25.9 >/dev/null

node -e '
const base = process.argv[1] + "/node_modules/";
const babel = require(base + "@babel/core");
const fs = require("fs");
const out = babel.transformSync(fs.readFileSync(process.argv[1] + "/bundle.js", "utf8"), {
  plugins: [base + "@babel/plugin-transform-class-properties", base + "@babel/plugin-transform-classes"],
  configFile: false,
  babelrc: false,
});
fs.writeFileSync(process.argv[1] + "/hermes.js", "var console={log:function(m){print(m);}};\n" + out.code);
' "$WORK"

HERMES_DIGEST=$("$WORK/hermes/hermes" "$WORK/hermes.js")
NODE_DIGEST=$(node scripts/conformance.mjs)
echo "hermes: $HERMES_DIGEST"
echo "node:   $NODE_DIGEST"
test "$HERMES_DIGEST" = "$NODE_DIGEST"
echo "Hermes (React Native) output is identical to V8"
