#!/usr/bin/env bash
# Start the preview, from a cold sandbox if necessary.
#
#   bash tools/preview.sh [port]
#
# This workspace is recycled between sessions, and the snapshot that
# survives excludes node_modules/ and dist/ by name. A preview that
# depends on either is therefore gone every time the box comes back,
# which looks exactly like "the server keeps dying".
#
# So the built bundle lives in preview/ instead, which is not on that
# exclusion list, and tools/serve.mjs imports nothing outside node's
# standard library. The normal path needs neither an install nor a
# build -- it just serves. The rebuild below is the cold fallback for
# when preview/ really is absent.
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${1:-5173}"

if [ ! -f preview/index.html ]; then
  echo "preview/ is missing -- rebuilding it"
  [ -d node_modules ] || npm install
  npx vite build --outDir preview --emptyOutDir
fi

# free the port if a previous run is still holding it
if command -v fuser >/dev/null 2>&1; then
  fuser -k "${PORT}/tcp" 2>/dev/null || true
  sleep 1
fi

exec node tools/serve.mjs preview "$PORT"
