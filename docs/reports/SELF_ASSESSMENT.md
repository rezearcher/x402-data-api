# Grey Ridge Signals — Infrastructure Security Self-Assessment

**Target:** Grey Ridge Signals production surfaces — `api.greyridgesignals.ai`, `greyridgesignals.ai`, `x402-data-api.sigrunner.workers.dev`, `portfolio.sigrunner.com`, `sigrunner.com`
**Assessment window:** 2026-10-23 · **Classification:** Internal reference (template for client reports) · **Assessor:** Grey Ridge Signals (automated, dogfood)

> This is Grey Ridge's assessment of its *own* stack — the reference that every client report is generated from, and proof we hold our stack to the bar we sell. It is maintained continuously: each loop pass adds a lens and updates retest status. Scope and limitations are stated plainly; "clear" means no known pattern matched, **not** "safe."

---

## 1. Executive summary

Grey Ridge's public surfaces were assessed across six non-intrusive lenses (HTTP security headers, TLS, email authentication, MCP tool-poisoning exposure, paid-route authorization, and secret exposure). Overall posture is **moderate, improving**: transport and primary-domain email posture are strong, one header class was remediated and verified live during this assessment, and two medium findings remain open (one email-auth gap on a secondary domain, one defense-in-depth gap).

| Severity | Open | Remediated this cycle |
|---|---|---|
| High | 0 | 0 |
| Medium | 2 | 1 |
| Low | 1 | 0 |
| Informational / Pass | 4 | — |

Headline: no high-severity exposure. Priority action is the **`sigrunner.com` email-authentication gap** (no DMARC) — a domain-spoofing/phishing risk — followed by a **Content-Security-Policy** rollout.

## 2. Scope & methodology

- **In scope:** the five production hostnames above and the public MCP endpoint (`/mcp`). Non-intrusive only.
- **Method:** external observation — HTTP response-header inspection, TLS/certificate inspection (OpenSSL), DNS/email-authentication records (SPF/DMARC/DKIM), static analysis of advertised MCP tools for prompt-injection / tool-poisoning signatures (OWASP **LLM01/LLM08**), and unauthenticated probing of paid routes for authorization and information exposure.
- **Explicit limitations (what this is NOT):** not a runtime/dynamic penetration test, not source-code review, not an authenticated or infrastructure/network assessment, not a compliance certification. A "clear"/"pass" means no *known* issue was detected by these lenses, not a guarantee of security. Findings outside OWASP LLM01/LLM08 and the header/TLS/email/authz lenses are out of scope for this pass.
- **Standards referenced:** OWASP LLM Top 10 (LLM01 Prompt Injection, LLM08 Excessive Agency), OWASP Secure Headers, NIST SP 800-115 (methodology), RFC 7489 (DMARC).

## 3. Findings

### GR-2026-001 — `sigrunner.com` has no DMARC and a permissive SPF (Medium)
- **Severity:** Medium · **CVSS 3.1:** 6.5 — `AV:N/AC:L/PR:N/UI:R/S:U/C:L/I:L/A:N` · **OWASP:** email spoofing / phishing enablement
- **Evidence:** `dns_email_security(sigrunner.com)` → DMARC `found:false` (risk: critical); SPF `v=spf1 include:_spf.google.com ~all` (soft-fail); no DKIM selector found. (Contrast: `greyridgesignals.ai` is correctly configured — see GR-2026-006.)
- **Impact:** an attacker can spoof `@sigrunner.com` mail with a high deliverability chance; no policy instructs receivers to reject, and `~all` only soft-fails. Reputational/phishing risk against a security brand.
- **Remediation (one):** publish `_dmarc.sigrunner.com` TXT `v=DMARC1; p=reject; rua=mailto:...`, tighten SPF to `-all`, and add a DKIM selector.
- **Status:** OPEN. Remediation is a DNS change via the Cloudflare API; blocked this cycle by a 1Password rate-limit on the CF token read (see §5). Queued for next clear op window.

### GR-2026-002 — Content-Security-Policy absent on all surfaces (Low→Medium)
- **Severity:** Low (defense-in-depth) · **CVSS 3.1:** 4.3 — `AV:N/AC:L/PR:N/UI:R/S:U/C:L/I:N/A:N` · **OWASP:** A05 Security Misconfiguration
- **Evidence:** no `content-security-policy` header on any surface (header scan, 2026-10-23).
- **Impact:** no in-browser mitigation against injected script/XSS on the HTML surfaces (`/check`, `/miniapp`).
- **Remediation (one):** add a CSP; because the pages use inline scripts, roll out `Content-Security-Policy-Report-Only` first with hashes/nonces, then enforce — deliberately, to avoid breaking the inline-script pages.
- **Status:** OPEN (deliberately staged; not a quick header add).

### GR-2026-003 — Missing baseline security headers (Medium) — REMEDIATED + verified live
- **Severity:** Medium · **CVSS 3.1:** 4.3 — `AV:N/AC:L/PR:N/UI:R/C:L/I:N/A:N` · **OWASP:** A05
- **Evidence (pre):** `api.greyridgesignals.ai` + the Worker served **zero** of HSTS/X-Content-Type-Options/X-Frame-Options/Referrer-Policy/Permissions-Policy.
- **Remediation applied:** central Hono middleware adding all five (commit `9f98484`, deployed via CI).
- **Status:** **CLOSED — retest 2026-10-23:** re-scan confirms all five served live on both surfaces (`strict-transport-security: max-age=31536000; includeSubDomains; preload`, `x-content-type-options: nosniff`, `x-frame-options: SAMEORIGIN`, `referrer-policy`, `permissions-policy`). CSP tracked separately as GR-2026-002.

### GR-2026-004 — MCP tool-poisoning exposure (Informational, pass) 
- **Lens:** static LLM01/LLM08 analysis of advertised MCP tools (`/scan/mcp`). No hidden-instruction/override/exfiltration/shadowing/dangerous-capability signatures surfaced on our own advertised toolset this pass. Re-run each cycle as tools change.

### GR-2026-005 — Paid-route authorization & secret exposure (Pass)
- **Evidence:** unpaid request to a paid route (`/scan/mcp`) correctly returns **HTTP 402** with no data leak; `/status` body contains no secret/token material. No IDOR observed on the probed routes.

### GR-2026-006 — Transport & primary-domain email posture (Pass)
- **TLS:** valid Google Trust Services certificates, ~90-day validity, correct SANs.
- **Email (`greyridgesignals.ai`):** SPF `-all` (hard-fail), DMARC `p=reject`, DKIM present — strong, low risk.

### GR-2026-007 — Authorization-before-scan control (Pass) — NEW this cycle
- **Lens:** the free scan reads only an MCP server's *published* `tools/list` (public metadata every client already receives) and never invokes a tool. To *claim* an asset — a verified-owner badge, continuous monitoring, drift alerts, the full report — a caller must complete an automated DNS-01-style domain-control challenge (`_grsg-verify.<host>` TXT) plus a versioned, IP/UA/timestamp-logged click-through authorization before any claim is recorded (`/scan/verify`, `/scan/verify/check`). This implements AUTHORIZATION_STANDARD Tier 1 end-to-end, headless.
- **Evidence (live):** `check` without `authorize=1` returns `authorization_required`; a non-hostname target is rejected 400 (no challenge minted, SSRF-safe — DoH only queries the validated host's own TXT); challenge token is deterministic per host (security is DNS control, not token secrecy) and host-bound (no cross-domain replay). Mirrors Detectify/Probely/Astra ownership gating. Known gap: DNS-TXT is currently the only verification method (no HTML-meta/file-at-path fallback yet) — acceptable for domain-hosted MCP servers, tracked for a bare-host/IP fallback.

### GR-2026-008 — Subscription-to-host binding & monitored-badge gate (Pass) — NEW this cycle
- **Lens:** the paid "monitored" trust badge must go green *only* for a host whose owner (a) has proven domain control and (b) holds an active monitoring subscription — and must drop to grey the moment either lapses, so the public badge never asserts a trust state the customer is not paying for. Authorization integrity: a caller cannot buy monitoring for a server they have not verified.
- **Evidence (live, commit `4d5ae75`):** `POST /stripe/create-checkout-session?host=<unverified>` is refused `400 ownership_not_verified` (no sub bound without prior DNS/file control). The sub is bound to the host via `client_reference_id` + `subscription_data.metadata.grsg_host` so both the first charge and every renewal invoice map back to it. `sub:<host>` is written only by a signature-verified webhook (`checkout.session.completed` / `invoice.paid` activate & extend; `customer.subscription.deleted` / `invoice.payment_failed` deactivate). `/scan/verify/badge?kind=monitored` is green only on verified-owner **AND** active sub (period + 3-day grace); a lapsed ownership proof (amber) takes precedence over any active sub; the free ownership badge is unchanged. Webhook HMAC verify, timestamp-freshness, and per-invoice idempotency (GR-2026-005 controls) are unchanged and still pass (usage suite 16/16). Drift-alert *delivery* is now built — see GR-2026-009.

### GR-2026-009 — Outbound drift-alert webhook: registration gate & SSRF posture (Pass) — NEW this cycle
- **Lens:** a monitoring subscriber registers an https webhook; on an ownership-proof transition we POST a signed event to it. An attacker-supplied outbound URL is a classic SSRF / request-forgery and abuse (amplification/relay) surface, and a webhook bound to a host the caller does not own would leak that host's monitoring state. Both must be closed by design.
- **Evidence (live, commit `db20fbc`):** registration (`POST /scan/verify/notify`) requires the host to be **claimed** (`409 claim_required` otherwise, verified live) **and** re-runs the live DNS/file proof of control at registration time (`403 control_not_proven` if the caller no longer controls the host) — so only the current operator can bind or change the webhook, and no stored secret is trusted. The URL is validated to **https-only, a public dotted host, never our own domains**; `http://` and a `*.sigrunner.workers.dev` target are both refused `400 invalid_notify_url` (unit-tested). Delivery uses `redirect:"manual"` (a target cannot bounce us elsewhere), a 4s timeout, and HMAC-SHA256 over the raw body in `X-GRSG-Signature` so the receiver authenticates the sender; the per-host secret is returned once to the proven owner and never leaked by the unauthenticated `GET` status read (unit-tested). Alerts fire only on a genuine verified↔lapsed transition **and** only while the subscription is active (no-sub and no-transition both suppress delivery — unit-tested). Cloudflare Workers cannot route to RFC-1918 regardless, so the public-host check is defense-in-depth, not the sole control. Mirrors the signed-webhook delivery of Snyk / Checkly / UptimeRobot. Tests: `tests/test_verify.mjs` 74 assertions (register/remove/invalid-url/lost-control gates, HMAC-verified lapse delivery, suppression paths).

## 4. Remediation roadmap (priority order)

1. **GR-2026-001** — `sigrunner.com` DMARC/SPF/DKIM (Medium; highest real risk) — once the op/CF token window clears.
2. **GR-2026-002** — CSP report-only → enforce (staged, to protect inline-script pages).
3. Continuous: re-run all lenses each loop pass; add lenses as new 2026 attack classes emerge (the bar moves).

## 5. Retest & operational notes

- GR-2026-003 retested and closed live this cycle.
- GR-2026-007 added: authorization-before-scan control shipped + live-verified (commit `33b2b46`).
- GR-2026-008 added: subscription-to-host binding + monitored-badge gate shipped + live-verified (commit `4d5ae75`); checkout refuses an unverified host, badge green only on verified-owner + active sub.
- GR-2026-009 added this cycle: outbound drift-alert webhook shipped + live-verified (commit `db20fbc`); registration gated on live proof-of-control, SSRF-safe https/public-host delivery, HMAC-signed, alerts only on a real transition while subscribed.
- GR-2026-001 remediation blocked this cycle by a transient 1Password rate-limit on the Cloudflare token read (ops dependency, not a target weakness); re-attempt next clear window.

## 6. Appendix — references

OWASP LLM Top 10 (LLM01, LLM08); OWASP Secure Headers Project; NIST SP 800-115; RFC 7489 (DMARC), RFC 7208 (SPF), RFC 6376 (DKIM). Scanner: `src/mcp_scan.ts`. Evidence captured 2026-10-23 via header/TLS/DNS/authz lenses; CVSS vectors computed per finding, ranked by realistic impact rather than score alone.
