#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")" && pwd)"
cd "$root"
sha256sum --check UPSTREAM_SHA256SUMS
