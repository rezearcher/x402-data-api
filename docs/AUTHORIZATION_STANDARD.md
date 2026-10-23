# Grey Ridge security-testing authorization standard

The binding authorization rule for the assessment service (replaces the informal "own+opt-in"). Security testing without authorization is a crime (US CFAA, UK Computer Misuse Act); authorization is the legal basis for every scan we run. Two tiers, each matching documented industry practice.

## Tier 1 — Self-serve free scan ("scan your MCP server" offer)

A visitor may only have us scan an asset they can PROVE they control. Mirrors Probely / Astra / Barracuda / Indusface / Detectify.

This tier is **fully automated — no human (ours or the registrar/Google's) in the loop.** Authorization weight scales with intrusiveness, and this product only runs **non-intrusive scans**, so a DNS-control challenge + a click-through legal authorization is sufficient. (Heavy signed docs — RoE, authorization letters — are reserved for the optional *active human assessment* upsell, Tier 2, not this.)

REQUIRED before any scan of a submitted target, all machine-checkable:
1. **Automated domain-control challenge** — our Worker mints a one-time per-host token; the user proves control by **either** of two interchangeable machine-checked methods (whichever they can edit), then our Worker confirms:
   - **DNS** — a **TXT record** at `_grsg-verify.<host>` (polled over our DoH resolver). The ACME DNS-01 / Search Console / ACM primitive.
   - **Served file** — the token in a plain-text file at `https://<host>/.well-known/grsg-verify.txt` (fetched https-only, redirects not followed). The ACME HTTP-01 / Search Console file primitive — for PaaS/managed hosts where the operator controls the HTTP path but not the DNS zone.
   Both prove the same thing: control of the host. Implemented at `/scan/verify/check` (`method=dns|http`, or unset = DNS then file). Do NOT use MX/email verification — it reintroduces a human.
2. **Click-through legal authorization** — before the scan runs, the user affirmatively accepts a versioned, timestamped, IP-logged authorization: they warrant they own the target OR hold current authorization, granted by someone with authority, scoped to the non-intrusive scan performed. The acceptance record is the legal artifact; no wet signature needed for non-intrusive scanning.
3. **Recordkeeping** — retain the challenge proof + the accepted authorization (≥12 months), machine-stored, produce on request; re-verify on a schedule for continuous-monitoring subscribers.
4. **User indemnity** — carried in the click-through terms; user is solely responsible for authorization.

The whole flow is code: challenge → DNS poll → logged click-through → scan. Zero human touch. One-time only: a lawyer may review the click-through authorization wording once (a setup, not a per-customer step); until then a standard scanner-AUP template applies.

## Tier 2 — Paid assessment / retainer engagement

Before any engagement testing, the following are executed (NIST SP 800-115 planning + RoE; OWASP WSTG / PTES methodology):
1. **Rules of Engagement (RoE)** — scope, testing window, acceptable techniques, escalation contacts, data handling, liability limits.
2. **Signed Authorization Letter** ("get-out-of-jail") — signed by an executive with authority over the assets; lists the testers, in-scope systems, and approved activities; shareable with ISPs/cloud/SOC to verify legitimacy.
3. **Statement of Work (SOW)** — objective, in-scope AND explicit out-of-scope / "do not test" assets, windows, deliverables, data handling.
4. **MSA + mutual NDA / data-handling agreement** — incl. retention + destruction terms (an NDA alone is insufficient).
5. **Scope precision** — exact domains / IP ranges / apps / cloud accounts. Third-party systems (cloud providers, SaaS the client uses) require SEPARATE written permission from that third party.
6. **Legal/procurement review** of final engagement language before signature; jurisdiction-aware (CFAA, CMA, local law).

## Prospecting (how we find buyers WITHOUT testing them)

Prospect intelligence uses PUBLIC signals only — who ships agents/MCP/DeFi, funding, job posts, public docs, published CVEs. We NEVER run an unauthorized scan to generate a lead or a "sample finding." Outreach offers the FREE verified-ownership scan (they test their own asset) or a scoped engagement — it never presents results of an unauthorized test.

## What marketing may publish

Aggregate / anonymized statistics from authorized scans (our own assets + verified opt-ins) only. Never a finding tied to a specific third party we were not authorized to test. Responsible/coordinated disclosure norms apply to anything involving a real external system.

Sources (industry practice, 2026): Probely, Astra, Barracuda, Indusface, Detectify (ownership-verification gating); Find The Breach / VibeSafely / unpwned AUPs (per-scan attestation, signed-authorization, recordkeeping, indemnity); NIST SP 800-115, OWASP WSTG, PTES, CFAA/CMA (engagement standard).
