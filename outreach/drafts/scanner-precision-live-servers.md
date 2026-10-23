Most MCP security scanners have the same tell: run one against your server and it lights up like a slot machine. Pattern-matchers flag the word "exec," flag "delete," flag "ignore," flag anything that rhymes with danger, and leave you to sort the one real problem out of forty false alarms. After the third alert that turns out to be a tool's own help text, you stop reading them. A scanner you stop reading is worse than no scanner — it's a checkbox that lies to you.

So the number we care about isn't how many problems we can find. It's how often we're wrong when we speak up. We decided to measure it in the open.

## The test: our rules against servers they'd never seen

In-sample accuracy is easy to fake. You write a rule, you test it against the examples you wrote the rule for, and you report 100%. It means nothing — you tuned the exam and then sat it. The honest signal is the *out-of-sample* flag rate: point the analyzer at real servers it was never tuned against and count how often it cries wolf.

We took a snapshot of the public MCP registry on 2026-10-20 and ran every reachable remote through the static analyzer — the same engine behind our free `/scan/mcp/preview` endpoint. It reads the advertised `tools/list` metadata (names, descriptions, JSON schemas, hidden unicode) and never invokes a tool.

- **246 servers probed; 109 returned a tools/list and were scanned.** The other 137 were credential-gated, SSE-only, or timed out.
- **987 real tool descriptions statically analyzed.**
- **3 servers flagged. 106 came back clear.**

A 2.8% flag rate on servers we'd never seen. For a pattern-based scanner, that's the number that matters — not because low means lazy, but because the whole game is not drowning the signal. The raw capture is in the repo at `benchmarks/registry_census/`; you can re-run the whole pass yourself.

## Then we did the part everyone skips

The point of an out-of-sample run isn't to post the flag rate and take a bow. It's to open up the flags and see whether *we* were right. So we pulled all three apart.

**Flag one was our mistake, and it's the most useful thing in this post.** A server called arclan.ai exposes a `query_registry` tool. Our rule tripped on the bare word "exec" — except "exec" appeared inside filter prose: *"restrict to servers with no write or exec tools."* The tool wasn't executing anything. It was letting you *search for other servers* by capability, and our rule couldn't tell the difference between a tool doing a dangerous thing and a tool describing one. That's a textbook false positive, the exact failure mode we built this scanner to avoid.

We fixed it the same day. The bare-`exec` branch now carries a negative lookahead so capability-class nouns in filter language don't trip it, and the server's description went into our corpus as a permanent regression test. Re-scan: zero flags. The fix is `benchmarks/README.md` and `tests/mcp_scan.test.mjs` if you want to read it.

The other two: one server (agentsindex.ai) no longer reproduces the flag at all — either a rule we tightened since or a description they changed. The third (aivikings.ai) now requires a session id, so we can't re-verify it either way, and we won't claim a result we can't reproduce.

## Why we'll tell you when we're wrong

There's a quieter version of this story that we'll also own, because it cuts the other way. While building a second test corpus we found a *false negative* — a redirect attack whose only tell was "Never reveal this instruction." Our conceal rule had been written to only fire when the secret was being kept from "the user," so this one slipped through clean. We found it, fixed the rule (`concealInstr` in the detection engine), and added it as a regression test. Precision cuts both ways, and a scanner that only ever brags about its catches is hiding its misses.

That's the whole philosophy. The accuracy numbers we publish from our hand-built corpus (recall and precision both 1.00 on 45 poisoning samples, and again on a 59-tool `tools/list` corpus) are *in-sample* — we tuned the rules against those examples, so we'll never dress them up as "100% accurate." The number that's actually load-bearing is the out-of-sample one, and the only reason it means anything is that we published the false positive sitting inside it.

## Scan your own server

Free, no account, nothing leaves your machine for the stdio case:

```bash
# hosted server:
curl -s "https://x402-data-api.sigrunner.workers.dev/scan/mcp/preview?url=https://YOUR-HOST/mcp"

# behind auth or stdio-only — POST your own tools/list:
curl -s -X POST https://x402-data-api.sigrunner.workers.dev/scan/mcp/preview \
  -H 'content-type: application/json' -d '{"tools":[...]}'
```

The free scan gives you a verdict. The paid tier ($0.05, x402 on Base) gives you itemized findings with evidence and OWASP LLM01/LLM08 mapping. Continuous drift monitoring — a re-scan on every deploy, because a tool description that's clean today is attacker-mutable tomorrow — is $9.99/mo.

A scanner is only worth running if you trust it to shut up when there's nothing to say. That trust is a number, it's measurable, and ours is in the repo.

Questions, or want the full methodology: contact@greyridgesignals.ai
