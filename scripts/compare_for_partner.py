#!/usr/bin/env python3
"""Side-by-side verdict comparison for a PARTNER-SUPPLIED token list (DopamineDesk bounded-test shape).

Unlike benchmark_token_report.py (which auto-discovers tokens from GeckoTerminal), this takes an
EXPLICIT list of Base ERC-20 addresses — e.g. the tokens a partner's transaction-preflight flagged —
and returns our /gate/swap + /chain/token-report verdicts next to GoPlus, as a ready-to-paste table.

All calls use the FREE preview paths (no payment, no self-dealing). Output is reproducible and
publish-safe: print only what this computes.

Usage:
  python3 -I scripts/compare_for_partner.py 0xTOKEN1 0xTOKEN2 ...
  python3 -I scripts/compare_for_partner.py --file tokens.txt   # one address per line (# comments ok)
  python3 -I scripts/compare_for_partner.py --notional 500 0xTOKEN   # trade size for the swap gate

Writes data/partner_compare_<UTC>.json and prints a markdown table + summary.
"""
import json, sys, os, time, urllib.request, datetime

BASE = "https://x402-data-api.sigrunner.workers.dev"
UA = {"User-Agent": "curl/8.5.0"}


def get(u):
    try:
        return json.load(urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=35))
    except Exception as e:
        return {"__error__": str(e)}


def parse_args(argv):
    toks, notional, i = [], 500, 0
    while i < len(argv):
        a = argv[i]
        if a == "--notional":
            notional = int(argv[i + 1]); i += 2; continue
        if a == "--file":
            with open(argv[i + 1]) as f:
                for ln in f:
                    ln = ln.split("#")[0].strip()
                    if ln:
                        toks.append(ln.lower())
            i += 2; continue
        if a.startswith("0x"):
            toks.append(a.lower())
        i += 1
    # dedupe, preserve order
    seen, out = set(), []
    for t in toks:
        if t not in seen:
            seen.add(t); out.append(t)
    return out, notional


def main():
    toks, notional = parse_args(sys.argv[1:])
    if not toks:
        print("no token addresses supplied. pass 0x... args or --file tokens.txt", file=sys.stderr)
        sys.exit(2)
    rows = []
    for a in toks:
        gp = get("https://api.gopluslabs.io/api/v1/token_security/8453?contract_addresses=" + a)
        gprow = ((gp or {}).get("result") or {}).get(a, {}) if isinstance(gp, dict) else {}
        tr = get(f"{BASE}/chain/token-report/preview?token={a}")
        sw = get(f"{BASE}/gate/swap/preview?token={a}&side=buy&notional_usd={notional}")
        sec = (tr or {}).get("security", {}) if isinstance(tr, dict) else {}
        rows.append({
            "token": a,
            "our_verdict": (tr or {}).get("verdict"),
            "our_risk_score": (tr or {}).get("risk_score"),
            "our_honeypot": sec.get("isHoneypot"),
            "our_sellable": sec.get("sellable"),
            "swap_decision": (sw or {}).get("decision") or (sw or {}).get("gate"),
            "swap_reason": (sw or {}).get("reason"),
            "goplus_honeypot": gprow.get("is_honeypot"),
            "goplus_cannot_sell_all": gprow.get("cannot_sell_all"),
            "goplus_buy_tax": gprow.get("buy_tax"),
            "goplus_sell_tax": gprow.get("sell_tax"),
        })
        time.sleep(0.5)
    ts = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H%M%SZ")
    os.makedirs("data", exist_ok=True)
    path = f"data/partner_compare_{ts}.json"
    json.dump({"generated_at": ts, "notional_usd": notional, "n": len(rows), "rows": rows},
              open(path, "w"), indent=1)

    # markdown table for same-day paste-back
    print(f"\n### Grey Ridge vs GoPlus — {len(rows)} tokens (swap notional ${notional}, free preview path)\n")
    print("| token | our verdict | risk | our honeypot | swap gate | GoPlus honeypot | GoPlus sell-tax |")
    print("|---|---|---|---|---|---|---|")
    for r in rows:
        print(f"| `{r['token'][:10]}…` | {r['our_verdict']} | {r['our_risk_score']} | "
              f"{r['our_honeypot']} | {r['swap_decision']} | {r['goplus_honeypot']} | {r['goplus_sell_tax']} |")
    agree = sum(1 for r in rows if r["our_honeypot"] is not None and r["goplus_honeypot"] is not None
                and bool(r["our_honeypot"]) == (str(r["goplus_honeypot"]) == "1"))
    comparable = sum(1 for r in rows if r["our_honeypot"] is not None and r["goplus_honeypot"] is not None)
    print(f"\nhoneypot agreement: {agree}/{comparable} comparable tokens")
    print(f"artifact: {path}")


if __name__ == "__main__":
    main()
