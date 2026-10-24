#!/bin/bash
# Compatibility shortcut for Finder; no login items are registered.
set -euo pipefail
script_dir="$(cd -- "$(dirname -- "$0")" && pwd)"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
exec "${NODE_BINARY:-node}" "$script_dir/../spicy-proxy.mjs" start
