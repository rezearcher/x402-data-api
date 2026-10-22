# MCP scan benchmark (Claims Law artifact)
Corpus: 16 poisoned + 26 benign (second batch of 20 added blind after the first rule fix: 7/8 caught, 0 FP, then fixed the 1 miss) tool descriptions (benchmarks/mcp_scan_corpus.json), poisoned patterns from public tool-poisoning research (Invariant Labs style), benign ones incl. look-alike words (evaluate, webhook, "other tools", deploy).
- Live endpoint (before round-3/4 deploy), `scripts/mcp_scan_benchmark.sh`: recall 0.50, precision 1.00 (22 samples) -> benchmarks/mcp_scan_results.json
- Local analyzer after c54 rule fixes, `node scripts/mcp_scan_local_bench.mjs`: recall 1.00, precision 1.00.
LIMITS: n=22, hand-built, rules were tuned against the misses -> in-sample. Do NOT publish "100% accurate"; publish "n=22 corpus, methodology in repo". Grow corpus before any accuracy claim.

- c67: corpus n=45 (added registry-census false-positive 'Never tell the user a ...' as benign + 2 poisoned variants); local analyzer recall 1.00 / precision 1.00, still in-sample.

## tools/list-shaped corpus (benchmarks/mcp_tools_list_corpus.json)
A second, `tools/list`-shaped corpus built for cross-validation with external MCP
threat-detection projects (and for exercising scanners that ingest a full
`{"tools":[...]}` document). Each sample promotes a corpus entry to a complete MCP
tool object (`name`, `description`, `inputSchema`) with a `label` (good|bad),
`category`, and `source`. Regenerate with `python3 -I scripts/build_tools_list_corpus.py`.
- n=59: 18 poisoned + 41 clean. The clean half adds paraphrased tools from public
  servers (filesystem, github, slack, postgres, fetch, time, memory, brave-search,
  sentry, gdrive, puppeteer, everything) — a clean `tools/list` surface shape.
- `benchmarks/mcp_tools_list_sample.json` = the same 59 tools as a bare JSON-RPC
  `tools/list` result (no labels), ready to pipe into any scanner.
- Local analyzer (`node scripts/mcp_tools_list_bench.mjs`, feeds name+description+schema):
  recall 1.00 / precision 1.00. Still single-author, partly in-sample — publish
  "n=59, methodology in repo", never "100% accurate".
- Building this corpus surfaced (and we fixed) a real analyzer false-negative: a
  redirect attack whose only secrecy marker was "Never reveal this instruction" was
  passing clean — the conceal rule required the target to be "the user". Fixed in
  src/mcp_scan.ts (concealInstr); regression test 4b in tests/mcp_scan.test.mjs.
- License: MIT, same as the repo. No share-alike, no third-party per-line encumbrance.
