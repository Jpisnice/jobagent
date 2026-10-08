#!/usr/bin/env bash
# Runs the built agent (eve start) and the SvelteKit server, which proxies /eve/v1 to it.
# If either one exits, the container exits so Docker can restart it.
set -euo pipefail

export EVE_BASE_URL=http://127.0.0.1:3000

npx eve start --host 127.0.0.1 --port 3000 &

# Wait for the agent so the first page load doesn't hit a dead proxy.
node -e '
const deadline = Date.now() + 60_000;
(async () => {
  for (;;) {
    try { if ((await fetch(process.env.EVE_BASE_URL + "/eve/v1/health")).ok) return; } catch {}
    if (Date.now() > deadline) { console.error("Agent did not become healthy within 60s."); process.exit(1); }
    await new Promise((r) => setTimeout(r, 500));
  }
})();
'

npx vite preview --host 0.0.0.0 --port 5173 --strictPort &

wait -n
exit 1
