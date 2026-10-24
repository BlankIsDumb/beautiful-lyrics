#!/bin/bash
# macOS Terminal/Login Items launcher. No launch agent or login item is installed.
set -euo pipefail
script_dir="$(cd -- "$(dirname -- "$0")" && pwd)"
log_dir="$script_dir/../local-backups"
# Finder/Login Items have a smaller PATH than an interactive shell. Support both
# standard Homebrew locations; a custom Node installation can supply NODE_BINARY.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
node_binary="${NODE_BINARY:-node}"
healthy() {
  curl --silent --fail --max-time 2 http://127.0.0.1:8967/health |
    "$node_binary" -e 'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{try{process.exit(JSON.parse(s).service==="beautiful-lyrics-spicy-relay"?0:1)}catch{process.exit(1)}})'
}
if ! command -v "$node_binary" >/dev/null 2>&1; then
  echo 'Node.js 20+ is required. Install Node or set NODE_BINARY to its absolute path.' >&2
  exit 1
fi
"$node_binary" -e 'if(Number(process.versions.node.split(".")[0])<20){console.error("Node.js 20+ is required.");process.exit(1)}'
if healthy; then
  echo 'Spicy relay is already running.'
  exit 0
fi
mkdir -p "$log_dir"
# Detach from Terminal without logging keys or lyrics. Server binds loopback only.
nohup "$node_binary" "$script_dir/spicy-relay.mjs" >"$log_dir/spicy-relay.out.log" 2>"$log_dir/spicy-relay.err.log" </dev/null &
relay_pid=$!
for ((attempt=0; attempt<15; attempt++)); do
  sleep 0.2
  if healthy; then
    echo "Spicy relay started (PID $relay_pid). No login settings were changed."
    exit 0
  fi
  if ! kill -0 "$relay_pid" 2>/dev/null; then break; fi
done
echo "Spicy relay did not start. See $log_dir/spicy-relay.err.log." >&2
exit 1
