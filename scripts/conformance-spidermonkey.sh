#!/usr/bin/env bash
# Runs the conformance digest under SpiderMonkey — Firefox's engine — and
# compares it with Node (V8). The official Mozilla js shell loads ES modules
# with -m and provides console and native BigInt, so it runs the unmodified
# scripts/conformance.mjs against the built dist/index.mjs: no bundling or
# transform sits between the shipped artifact and the engine.
set -euo pipefail

# Firefox ESR release whose jsshell build is pinned. Update alongside the
# SHA-256 values below, taken from that release's SHA256SUMS on
# archive.mozilla.org.
FIREFOX_VERSION=153.4.0esr
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

# SHA-256 of each release asset, so a swapped or corrupted download fails the
# run instead of silently deciding what "SpiderMonkey says" about our
# conformance digest.
case "$(uname -s)" in
  Darwin)
    ASSET=jsshell-mac.zip
    ASSET_SHA256=561e03486df195eb03e84a50f0beb85b170fd80ad9ebd0dff8b8d76f7649c6e8
    ;;
  Linux)
    case "$(uname -m)" in
      x86_64) ;;
      *) echo "unsupported architecture: $(uname -m)"; exit 1 ;;
    esac
    ASSET=jsshell-linux-x86_64.zip
    ASSET_SHA256=0c28b1b2a3055899b30be1855c437d28a0e7dfa08bb7b2998b7bc936231c0119
    ;;
  *) echo "unsupported platform"; exit 1 ;;
esac

echo "fetching SpiderMonkey shell from Firefox $FIREFOX_VERSION ($ASSET)"
curl -sSfL -o "$WORK/jsshell.zip" \
  "https://archive.mozilla.org/pub/firefox/releases/$FIREFOX_VERSION/jsshell/$ASSET"
echo "$ASSET_SHA256  $WORK/jsshell.zip" | shasum -a 256 -c -
mkdir -p "$WORK/jsshell" && unzip -q "$WORK/jsshell.zip" -d "$WORK/jsshell"
echo "engine: $("$WORK/jsshell/js" --version)"

bun run build

SPIDERMONKEY_DIGEST=$("$WORK/jsshell/js" -m scripts/conformance.mjs)
NODE_DIGEST=$(node scripts/conformance.mjs)
echo "spidermonkey: $SPIDERMONKEY_DIGEST"
echo "node:         $NODE_DIGEST"
test "$SPIDERMONKEY_DIGEST" = "$NODE_DIGEST"
echo "SpiderMonkey (Firefox) output is identical to V8"
