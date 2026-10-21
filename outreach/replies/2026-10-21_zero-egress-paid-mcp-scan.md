# Zero-egress paid MCP scan — conversion-gap fix (cycle 67, 2026-10-21)

## Signal (from the reply corpus)
MCP-scan is the only buyer shape with demonstrated paid-intent. The discriminator that
converted Miles / Liquid Logic X where mcphub, Kuadrant/mcp-gateway, HelpCode-ai/anythingmcp
all said NO: **paste-mode = zero data egress** ("nothing of yours leaves except the tool
descriptions you already advertise"). Those three rejected the URL-mode scan citing exactly
data egress.

## Gap
Free preview had a paste path (`POST /scan/mcp/preview`), but the PAID itemized scan was
`GET /scan/mcp?url=` only — forcing a zero-egress buyer back to URL-mode (send their server
URL out) to pay. The proven buyer's paid conversion was structurally blocked.

## Fix (shipped + live)
- `POST /scan/mcp` `{"tools":[…]}` → full itemized findings, x402 $0.05, same gate as GET.
- commit 6c8c1a3 · deploy run 39626082191 · live-verified 402/amount 50000/payTo 0x5765…ed10.
- preview upsell now names the zero-egress paid path; README $0.10→$0.05 corrected.

## Delivery
Not emailed to Miles (ball-in-court — his team runs the preview this week). The new paid path
surfaces in the preview upsell his team receives in-product → non-spammy delivery of new value.
