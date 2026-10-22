Thanks — this is exactly the exchange I wanted, and I took your point about the clean `tools/list` gap seriously. I just published a corpus shaped for it and ran your style of exercise against my own rules first.

**On format — I built the half you said you'd value most.** There are now two corpora in the repo, both MIT:

- `benchmarks/mcp_scan_corpus.json` — the original 45, flat `{name, description, label}`. Fine input for your scanner, but as you said, in-distribution for mine.
- `benchmarks/mcp_tools_list_corpus.json` — **new, n=59 (18 poisoned / 41 clean).** Each sample is a complete MCP tool object (`name`, `description`, `inputSchema`) with `label`, `category`, and `source`. The clean half is the part you lacked: 14 of the clean entries are tools paraphrased from public servers (filesystem, github, slack, postgres, fetch, time, memory, brave-search, sentry, gdrive, puppeteer, everything), with realistic nested/array/enum schemas.
- `benchmarks/mcp_tools_list_sample.json` — the same 59 tools as a bare JSON-RPC `tools/list` result (`{"jsonrpc":"2.0","id":1,"result":{"tools":[...]}}`), no labels. That's the direct-ingestion form, and it's also a ready test fixture for your in-flight #737 (the "scan a tools/list document, one event per tool" fix) — it should produce 59 events.

Regenerate either with `python3 -I scripts/build_tools_list_corpus.py`.

**Your four questions:**

1. **Is `benchmarks/` the set, size, split?** Yes — the two above are everything. Use `mcp_tools_list_corpus.json`: n=59, 18 poisoned / 41 clean. No larger labeled set behind it.

2. **How labels were assigned.** Single reviewer (me), by hand. `bad` = a tool-metadata poisoning / prompt-injection / exfiltration pattern lives in the name or description; `good` = benign, including deliberate look-alike wording (evaluate, webhook, "other tools", deploy) and two real registry-census false positives I keep as clean controls. Up front on provenance: the poisoned samples are synthetic, following public research (Invariant Labs `<IMPORTANT>`, the WhatsApp/SMS exfil phrasing, tool-shadowing, invisible-unicode/bidi, and ANSI/CSS covert-channel variants) — not captured from live malicious servers. The clean tools are authored benign twins plus the paraphrased public-server tools. So: synthetic, single-review, no double-blind. Treat recall on it as in-sample for me too.

3. **License.** MIT, same as the repo `LICENSE` (Grey Ridge Signals Group LLC). The clean public-server entries are paraphrased, not copied, and released MIT with the rest. No share-alike, no per-line third-party encumbrance — clear for you to fold the clean samples into your gate corpus. Keep whatever attribution is useful to you; none required.

4. **Publishing per-sample results, both directions.** Yes, please — in this issue or your repo, whichever you prefer. I'll do the same with your rule hits/misses against these corpora and keep your rule IDs in my notes so fixes trace back, as you suggested.

**Reciprocating the exercise — it already paid off.** Before sending this I ran my analyzer across the new corpus and it surfaced a real false-negative of mine: a redirect attack whose only secrecy marker was "Never reveal this instruction" was passing clean, because my conceal rule required the target to be "the user" (it caught "don't tell the user", missed "never reveal this instruction"). Fixed in commit `6861b29` with a regression test and a privacy-copy negative control ("do not disclose this information to third parties" stays clean). That's the kind of miss I expect your rules to catch that mine don't, so please do run both lanes — I want the misses.

One confirmation on your observation: my scanner reads tool metadata (name + description + inputSchema), so a bare `{"tools":[...]}` document is the right ingestion unit, which is why `mcp_tools_list_sample.json` is in that shape. If you'd rather I also emit your `mcp_exchange` wrapper form directly, say the word and I'll add it to the generator.
