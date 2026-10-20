# MCP scan benchmark (Claims Law artifact)
Corpus: 8 poisoned + 14 benign tool descriptions (benchmarks/mcp_scan_corpus.json), poisoned patterns from public tool-poisoning research (Invariant Labs style), benign ones incl. look-alike words (evaluate, webhook, "other tools", deploy).
- Live endpoint (before round-3/4 deploy), `scripts/mcp_scan_benchmark.sh`: recall 0.50, precision 1.00 (22 samples) -> benchmarks/mcp_scan_results.json
- Local analyzer after c54 rule fixes, `node scripts/mcp_scan_local_bench.mjs`: recall 1.00, precision 1.00.
LIMITS: n=22, hand-built, rules were tuned against the misses -> in-sample. Do NOT publish "100% accurate"; publish "n=22 corpus, methodology in repo". Grow corpus before any accuracy claim.
