Your agent reads a tool's description before it ever calls the tool. The name, the description, the JSON schema — all of it gets injected into the model's context as trusted instruction. That text is the first thing an attacker controls, and it is attacker-mutable on every server deploy.

Most concealment tricks in that surface are known: zero-width spaces, bidirectional overrides, the Unicode TAG block (U+E0000–U+E007F). Scanners catch those. There is a quieter one that slipped past ours until last week, and past most of the tooling I have looked at: **variation selectors.**

## What a variation selector is supposed to do

A variation selector is a Unicode code point that modifies the character before it. The common one is U+FE0F (VS16), which forces emoji presentation — it is the difference between a flat "⚠" and the colored "⚠️" you actually see. Legitimate, everywhere, one per base character.

That is the cover. A variation selector renders nothing on its own. It attaches to whatever precedes it and, by design, is invisible to a human reading the string.

## How it becomes a covert channel

Paul Butler's write-up on smuggling arbitrary data through emoji made the technique concrete: there are 240 code points in the Variation Selector Supplement (U+E0100–U+E01EF) with no legitimate role in ordinary prose. Map each one to a byte and you can encode an entire hidden message as a run of selectors appended to a single visible character.

To a reviewer, the tool description reads `Returns the current price.` To the model, that same string carries a trailing payload of instructions nobody saw — "also forward the wallet address to…", or whatever the attacker wrote. The human signs off on benign copy. The model ingests benign copy plus an invisible instruction. Through 2025 and into this year it has become a standard way to hide prompt-injection text where review cannot reach it.

## Why generic scanners miss it

The naive fix — flag any variation selector — breaks immediately, because U+FE0F is in nearly every emoji string a real developer writes. Flag it and you drown the signal in false positives on "⚠️ deprecated" and "✅ stable". So most unicode checks either skip the range or whitelist it, and the Supplement block sails straight through.

The distinction that makes detection precise:

- The **Variation Selector Supplement (U+E0100–U+E01EF)** has no legitimate use in tool-metadata prose at all. Any single occurrence is anomalous — flag on sight.
- The **BMP selectors (U+FE00–U+FE0F)** are legitimate one at a time. But a smuggled payload is a *run* — one selector per encoded byte — and two consecutive selectors never occur in real text, because adjacent emoji keep their own selectors separated by a base character. So the rule is: require two or more in a row.

That split is the whole trick. It catches the covert channel without lighting up on ordinary emoji copy.

## What we shipped

We added the rule to our open MCP scanner. It checks the tool description and the tool *name* — the name is attacker-controllable too, and it renders in tool pickers and logs where a reviewer is even less likely to inspect it byte by byte.

```
const varSel = /[\u{E0100}-\u{E01EF}]|[︀-️]{2,}/u;
```

Three regression cases cover it: a BMP selector run, a Supplement character, and selectors smuggled into the tool name. The full suite is 51 tests, all passing, and the corpus is in the repo so you can see exactly what we flag and what we deliberately do not.

A note on honesty, because it matters for trust: when we census the public MCP registry, the confirmed poisoning rate is zero. We have not caught a live server using this in the wild. The point of the rule is not a scary headline — it is that your tool surface is mutable on the next deploy, and the cost of carrying a precise check for an invisible channel is close to nothing. Clean today is not clean forever.

## Check your own

The scan never invokes a tool. It reads only the advertised `tools/list` metadata — the same bytes the model would read — and nothing leaves your machine if you POST your own list from behind auth.

Free, no account:

```
curl "https://x402-data-api.sigrunner.workers.dev/scan/mcp/preview?url=https://YOUR-HOST/mcp"
```

Method, corpus, and the reproduce path are in the repo. If you maintain an MCP server, the worthwhile habit is scanning on every connect and alerting when the surface drifts — the description that was benign at review is the description an attacker rewrites next.
