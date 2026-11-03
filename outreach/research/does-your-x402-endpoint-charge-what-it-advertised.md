# Does your x402 endpoint charge what it advertised? The price-accuracy check almost nobody runs

An x402 agent does something humans never would: it pays a bill it didn't read. Your
agent picks an endpoint from a catalog or listing because the price said, say, **$0.001**.
At call time the endpoint answers with an HTTP 402 and an `accepts[]` array carrying the
*real* amount — and the agent just pays whatever is in that array. Nobody put the two
numbers side by side. If the live 402 quietly asks for `5000` atomic units ($0.005) instead
of the `1000` ($0.001) you chose it for, the payment still settles. Silently. Five times over.

`GET /x402/preflight` fetches the endpoint once (**read-only — it never pays**) and, among
its other checks, returns a **price-accuracy verdict**: does the live `accepts[].amount`
match the price you were told? Keyless x402 on Base, **$0.001/call**, with a free preview
(3/IP/day).

## The verdict

```
price_accuracy.verdict : MATCH | OVERCHARGE | UNDERCHARGE | UNKNOWN
```

It compares two numbers, in atomic USDC units (6 decimals on Base — `1000` = $0.001):

- **charged** — the live `maxAmountRequired` / `amount` the endpoint presents in its 402.
- **advertised** — from one of two sources, degrade-open:
  - `&advertised=<usdc>` — the figure *your* catalog quoted (`advertised_source: "caller"`), zero extra fetch; or
  - **self-manifest** — if you omit it, the check pulls the endpoint's *own*
    `/.well-known/x402`, finds the entry whose resource host + path match your target, and
    reads the price it publishes there (`advertised_source: "self-manifest"`). A
    self-consistency check: does the endpoint charge what its own manifest says?

If either side is missing — the endpoint presents no chargeable amount, or there's nothing
to compare against — the verdict is **UNKNOWN** with `note: "price NOT verified"`. It does
not guess.

## The rule, with worked numbers

The MATCH tolerance is `max(1 atomic unit, 1% of advertised)` — just enough to absorb
dollar→atomic rounding, nothing more. These are the actual outputs of the shipped pure
function (reproducible; the logic lives in `src/index.ts`):

| advertised | live charge | verdict | ratio | why |
|-----------|-------------|---------|-------|-----|
| $0.001 (`1000`) | $0.005 (`5000`) | **OVERCHARGE** | 5x | charges 4000 over a tolerance of 10 |
| $0.005 (`5000`) | $0.005 (`5000`) | **MATCH** | 1x | delta 0 |
| $0.001 (`1000`) | `1005` (0.5% over) | **MATCH** | 1.005x | inside the `max(1, 1%)=10` band |
| $0.002 (`2000`) | $0.001 (`1000`) | **UNDERCHARGE** | 0.5x | charges less — benign; your quoted figure is stale |

OVERCHARGE is the one that matters, and it's handled with a deliberately light hand:
**it downgrades a PAY to CAUTION, never to AVOID.** Charging more than advertised isn't
fraud and isn't illegal — it's just not the deal you thought you were getting. The verdict
flags it, tells you the real price, and lets *you* decide. UNDERCHARGE doesn't move the
verdict at all; it only notes your advertised figure is out of date.

## What the live response looks like

The free preview returns the full envelope — the `price_accuracy` block sits alongside the
will-it-settle and safe-to-pay checks, under a plain scope note:

```
"scope_note": "static 402 wire-format + liveness + LLM01/LLM08 description scan
 + payTo OFAC/scam flag + advertised-vs-charged price-accuracy check; read-only,
 never pays; not a settlement guarantee."
```

## Where this sits next to the alternatives

x402 trust is a young, crowded shelf — and it's worth being precise about what's already
there, because the honest gap is narrow and specific. The reputation surfaces you can find
today score an endpoint on *reputation, uptime, and unique-payer counts* — observed-trust
risk indicators, built from how an endpoint has behaved historically. Those are genuinely
useful, and this check does not replace them. But a reputation score answers "has this
seller behaved well for others?" — not "is the amount in the 402 in front of me right now
the amount I was quoted?" Those are different questions. A well-reputed endpoint can still
post a 402 that's 5x its listed price, whether from a config change, a tier you didn't
notice, or a stale catalog entry. The price-accuracy check is the per-call, point-in-time
cross-check of *this* 402 against *this* advertised figure. Pair it with a reputation score;
don't substitute one for the other.

## Scope honesty

This is a read-only pre-payment check, not a pentest and not a guarantee.

- It **never pays** and never broadcasts anything — it fetches the 402 once.
- The verdict is **point-in-time**, not historical. It tells you what *this* fetch saw;
  an endpoint can change its price between your check and your pay.
- **UNKNOWN is a real answer.** If the endpoint presents no amount (down, or not a
  conformant 402) or there's no advertised figure to compare, it says so rather than
  inventing a verdict. We don't call anything "safe."
- The self-manifest path is a *self-consistency* check (wire vs the endpoint's own
  manifest) — it can't catch an endpoint that lies identically in both places. Pass your
  own `&advertised=` for an independent comparison against the price *you* were quoted.

## Try it

- Free preview (3/IP/day, no key): `GET https://api.greyridgesignals.ai/x402/preflight/preview?url=<your-endpoint>&advertised=<usdc>`
- Paid, unmetered: `GET https://api.greyridgesignals.ai/x402/preflight?url=<your-endpoint>&advertised=<usdc>` — $0.001 USDC/call via x402 on Base, no signup.
- The same check ships as an MCP tool (`x402_preflight`) and in the `greyridge-x402-tools` pip package.

If your agent pays x402 bills without a human in the loop, the one number it should never
skip is the one it's about to pay.
