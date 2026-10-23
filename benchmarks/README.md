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

## Real-world precision — out-of-sample flag rate on live registry servers

The corpus numbers above are in-sample (rules were tuned against them). The honest
precision signal is the out-of-sample flag rate on servers we never tuned against.
We ran the static analyzer against the public MCP registry
(`benchmarks/registry_census/`, captured 2026-10-20):

- **109 real public MCP servers returned a `tools/list` and were scanned** (137
  of 246 probed were unreachable / returned no tools).
- **987 real tool descriptions statically scanned.**
- **3 servers flagged (2.8%); 106 verdict=clear.** No "find-a-vuln" framing — a
  2.8% flag rate on real servers is the opposite of the ~78% false-positive rate
  that third-party audits report for pattern-based MCP scanners.

On re-examination of the 3 flags (the whole point of an out-of-sample run is to
check them, not to brag about the rate):
- **arclan.ai `query_registry` — confirmed FALSE POSITIVE, now fixed.** The only
  match was the word "exec" inside filter prose ("restrict to servers with no
  write or exec tools") — enumeration of *other* servers' capabilities, not this
  tool executing. Fixed: the bare-`exec` branch now carries a negative lookahead
  so capability-class nouns don't trip it (regression test 7b). Re-scan: 0 flags.
- **agentsindex.ai `/mcp` — no longer reproduces** (0 flags on re-scan; either a
  since-tightened rule or a server-side description change).
- **aivikings.ai `/mcp` — could not re-verify** (now requires a session id).

Methodology + raw capture are in `benchmarks/registry_census/`. Publish
"2.8% out-of-sample flag rate on 109 live servers, 1 confirmed FP fixed,
methodology in repo" — never a bare accuracy percentage.
