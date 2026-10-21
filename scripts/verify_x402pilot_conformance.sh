#!/bin/bash
# Run x402-pilot's own x402-conformance-mcp decode_402 against our live 402
# routes — buyer-tool proof that our PaymentRequired is spec-clean (used in the
# DrVelvetFog / x402-pilot integration thread, issue #13 / PR #14).
#
# Self-contained: clones DrVelvetFog/x402-pilot, npm-installs the conformance
# MCP, spins it up over stdio, and calls decode_402 with a url= for each route.
# Prints pass/blocker/info counts. Exit 0 iff every route has 0 blockers.
#
# Usage: GH_TOKEN=... scripts/verify_x402pilot_conformance.sh [route ...]
set -euo pipefail
B="https://x402-data-api.sigrunner.workers.dev"
ROUTES=("${@:-}")
if [ -z "${ROUTES[0]:-}" ]; then
  ROUTES=("$B/chain/token-report?token=usdc" "$B/gate/swap?token=weth")
fi
: "${GH_TOKEN:?set GH_TOKEN (classic PAT with repo read)}"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
git clone --depth 1 "https://x-access-token:$GH_TOKEN@github.com/DrVelvetFog/x402-pilot.git" "$WORK/repo" >/dev/null 2>&1
MCP="$WORK/repo/mcp/x402-conformance-mcp"
( cd "$MCP" && npm install --no-audit --no-fund >/dev/null 2>&1 )

cat > "$MCP/_decode.mjs" <<'JS'
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const MCP_DIR = process.env.MCP_DIR, PLUGIN_ROOT = process.env.PLUGIN_ROOT;
const t = new StdioClientTransport({ command: 'node', args: [`${MCP_DIR}/dist/index.js`], cwd: MCP_DIR,
  env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT } });
const c = new Client({ name: 'proof', version: '0' }, { capabilities: {} });
await c.connect(t);
let blockers = 0;
for (const u of process.argv.slice(2)) {
  const r = await c.callTool({ name: 'decode_402', arguments: { url: u } });
  const o = JSON.parse(r.content[0].text);
  const s = o.findings.map((f) => f.severity);
  const b = s.filter((x) => ['critical', 'high'].includes(x)).length;
  blockers += b;
  console.log(`${u}\n  status=${o.httpStatus} expected402=${o.expected402} v=${o.version} | ${s.filter((x)=>x==='pass').length} pass / ${b} blocker / ${s.filter((x)=>x==='info').length} info`);
}
await c.close();
process.exit(blockers === 0 ? 0 : 1);
JS

MCP_DIR="$MCP" PLUGIN_ROOT="$WORK/repo" node "$MCP/_decode.mjs" "${ROUTES[@]}"
