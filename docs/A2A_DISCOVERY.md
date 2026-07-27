# A2A Discovery — Agent-to-Agent Protocol Agent Card

**Added**: 2026-07-25 (task t_79490638)
**Route**: `/.well-known/agent-card.json`
**Spec**: [A2A Protocol Agent Discovery](https://a2a-protocol.org/latest/topics/agent-discovery/)

## What

A standard A2A Agent Card served at `/.well-known/agent-card.json` per RFC-8615,
making x402-data-api discoverable by any A2A-compatible agent framework, directory,
or crawler.

The card lists 8 skills (id/name/description/tags/examples) covering the full
product catalog — crypto prices, cross-venue funding rates, DeFi yields,
Polymarket markets, Base mainnet on-chain reads, token security / honeypot
detection, MCP server security auditing, and domain enrichment + tech-risk
assessment. Every skill description notes the HTTP 402 payment requirement
(x402 v2, USDC on Base) and references `/.well-known/x402` and `/mcp` for
the full machine-readable manifests.

## A2A does not have a native payment-extension field

Per the current v1.0 A2A spec, there is no `payment` or `x402` extension field
in the AgentCard schema. We do not fabricate one. Instead, each skill's
`description` field documents the payment flow in plain language — the same
approach already used by `/llms.txt` for LLM crawlers. If the A2A working group
adds a standard extension for payment requirements in a future version, we will
adopt it.

## AGNTCY Agent Directory Service — NOT done here

The [AGNTCY Agent Directory Service](https://docs.agntcy.org) is a genuine follow-up
registry that requires registration of a deployment URL under an identity:

1. Create/authenticate with an AGNTCY account (CLI or web)
2. Register the agentic service at `https://x402-data-api.sigrunner.workers.dev`
3. The directory indexes the Agent Card and makes it searchable

**This is explicitly out of scope for this card.** Registry submission requires
a NEW Rez account and/or CLI login (interactive account creation), which is a
Rez-atom follow-up, not a code-only action. The Agent Card at `/.well-known/agent-card.json`
is the prerequisite — it must exist and be valid before any directory can index it.

**Follow-up**: When a Rez account exists for AGNTCY:
```shell
# AGNTCY CLI register (hypothetical — tooling may differ)
agntcy register https://x402-data-api.sigrunner.workers.dev
```

## Verification

```shell
# Validate the card is served and well-formed
curl -sf https://x402-data-api.sigrunner.workers.dev/.well-known/agent-card.json | \
  python3 -c "
import json, sys
d = json.load(sys.stdin)
assert d.get('name'), 'no name'
assert d.get('url'), 'no url'
assert 'skills' in d, 'no skills'
assert len(d['skills']) >= 6, f'got {len(d[\"skills\"])} skills, need >=6'
for s in d['skills']:
    assert 'id' in s and 'name' in s and 'description' in s and 'tags' in s, \
        f'skill {s.get(\"id\",\"?\")} missing fields'
print(f'OK: {len(d[\"skills\"])} skills validated')
"
```

## Reference

- [A2A Protocol — Agent Discovery](https://a2a-protocol.org/latest/topics/agent-discovery/)
- [A2A Agent Card Schema](https://a2a-protocol.org/schemas/agent-card.json)
- [AGNTCY Agent Directory](https://docs.agntcy.org)
- arXiv 2507.19550 — *Towards Multi-Agent Economies: Enhancing the A2A Protocol with
  Ledger-Anchored Identities and x402 Micropayments for AI Agents*
