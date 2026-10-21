#!/usr/bin/env python3
"""buyer_intent_scanner.py — better-qualified targeting feed from BUYER-INTENT issues.

The goal-gate's standing recommendation is "improve targeting (the ones already
replying don't convert)". For 60+ cycles the replying audience has been scanner/
firewall/infra builders who refuse ANY external paid dependency — the wrong
audience. Cold-pitching sellers (144 pulls, $0) is forbidden. Code-search for
repos already referencing our URL is saturated (competitors/census/stale).

This sensor opens a DIFFERENT, better-qualified channel discovered 2026-10-21:
GitHub ISSUES where a dev is ACTIVELY BUILDING an x402 *data-buyer* (a PaidHttpClient,
a "buy a price feed over x402" task, "add a market-data x402 source"). Those devs
are demand-side and self-selected — they WANT a provider. That is inbound-shaped,
not cold spam: answering an open build-issue with a concrete integration is
responsive. The sensor ranks them so each cycle can act on the single best target
instead of re-grepping GitHub by hand.

Ground-truth signals (NO hardcoded roster-as-logic — all derived at runtime):
  - chain-fit (the PROVEN replied->paid killer, measured against the 58-reply corpus
    2026-10-21): HOT requires POSITIVE Base/EVM evidence (net == base-evm), because
    every explicit NO that named a reason was a chain mismatch — Robinhood Chain
    (fly.ai), XRP (Sluzen/Agorean), BNB (pokter), Solana/NEAR (noobshole). An agent
    whose framework signs another chain replies "interested" then cannot sign our Base
    EIP-3009 USDC authorization. "unknown"/"multi" = chain-fit UNCONFIRMED -> WARM, never
    crowned the single best target.
  - seller-vs-buyer: an insider issue on an active Base repo looks identical whether the
    team builds a data BUYER (demand) or a data/trust SELLER (rival). SELLER_SELF keys on
    the repo's OWN description self-describing as a provider/guard-layer/facilitator/
    gateway that sells a service -> SELLER_PITCH (observed: pulsefeed-x402, industrial-
    platform-agent-tools were sellers surfacing as HOT).
  - role: census/observatory/operating-ledger/market-size automations forbid or never
    make paid requests -> RESEARCH.
  - freshness: pushed_at age — a stale (>45d) demo is near-dead; active required for HOT.
  - ownership: issues authored by us (rezearcher) are OUR pitches, not demand — dropped.
  - contacted: deduped against outreach/sent/ so we never re-pitch.
All signals derive from each repo's own description/topics/body and degrade open
(unmatched stays visible as WARM for manual judgement) — never a maintained list.

Output: ranked JSON (HOT/WARM/COLD) + human summary naming this cycle's single best
Base-compatible, active, un-contacted target. Degrades open: on any gh error it
emits status!=ok rather than a silent empty list.

Usage: python3 -I scripts/buyer_intent_scanner.py [--json]
Requires: `gh` authenticated (token via `gh auth token`).
"""
import datetime
import json
import os
import re
import subprocess
import sys

OUT = "/home/rez/.hermes/data/x402-demand/buyer_intent_latest.json"
SENT_DIR = os.path.expanduser("~/projects/x402-data-api/outreach/sent")
OUR_AUTHORS = {"rezearcher"}  # issues we authored are our pitches, not inbound demand

# Search queries are DATA (editable, degrade-open) — buyer-intent phrasings, not a
# decision gate. Each is an open-issue search; results are classified by derived
# signal, never by which query matched.
QUERIES = [
    "x402 market data in:title,body state:open type:issue",
    "x402 price feed in:title,body state:open type:issue",
    "pay-per-call market data x402 in:title,body state:open type:issue",
    "buy paid signals over x402 in:title,body state:open type:issue",
    "add market data x402 source in:title,body state:open type:issue",
    "PaidHttpClient x402 in:title,body state:open type:issue",
    "x402 data provider in:title,body state:open type:issue",
]
# Only issues created within this window are considered (demand goes stale fast).
CREATED_AFTER = (datetime.datetime.utcnow() - datetime.timedelta(days=60)).strftime("%Y-%m-%d")

# Network inference keyword sets (derived signal). Base/EVM = we can serve.
BASE_EVM = re.compile(r"\b(base|evm|ethereum|usdc on base|base usdc|erc-?20|cdp|coinbase)\b", re.I)
OTHER_CHAIN = re.compile(r"\b(stellar|soroban|solana|aptos|sui|\bbnb\b|bsc|xrp|polygon only|near)\b", re.I)

# Analyst/observatory discriminator (derived signal). A repo-team issue about x402
# "market data" is NOT a buyer when it is a census/collector/observatory doing demand
# RESEARCH, or when it explicitly forbids paid requests. Those will never pay us —
# surfacing them as HOT (observed 2026-10-21: agent-market-lab, agentmine, x402-lab
# were all read-only analysts that constrain "no paid requests/self-payments") burns
# pulls. The signal is the issue's own stated constraint/role, not a repo roster.
NO_PAY = re.compile(r"no (paid|external) (requests|payments|services)|no self-?payment|without approval|read-?only collector", re.I)
ANALYST = re.compile(r"\b(observatory|census|collector|crawler|market research|demand research|scouting|scout the|catalog(ue)? scan|discovery (collector|index|scan)|operating ledger|ledger archive|market-size)\b", re.I)
PARKED = re.compile(r"\bPARKED\b|priority[- ]reset|paused\b|do not (create|build) another", re.I)

# Seller/competitor self-description discriminator (derived from the repo's OWN
# description — the ground-truth of what the repo IS, not a maintained roster). An
# insider issue on an active Base repo looks identical whether the team is building a
# data BUYER (demand, convertible) or a data/trust SELLER (a rival — never pays us).
# Observed 2026-10-21: all 3 "HOT" survivors were sellers — pulsefeed-x402 ("trust &
# safety LAYER for x402 ... Guard SDK"), industrial-platform-agent-tools ("integration
# TOOLKIT ... to ... data SERVICES"), so the insider+base+active gate alone is ~0%
# precision. These markers key on self-as-PROVIDER framing (sells/exposes/monetizes a
# service, or is a trust/guard/facilitator/gateway layer). Degrades open: no match =
# unchanged, still surfaced for manual judgement.
SELLER_SELF = re.compile(
    r"(trust ?& ?safety layer|guard sdk|\bfacilitator\b|pay-?per-?(call|tool|request) (micropayments?|server|api|infrastructure)"
    r"|monetiz|\bresell|\bgateway\b|\brouter\b|unified payment|data services via|our (api|endpoint|feed|service|data)"
    r"|sell (your|data|signals)|expose[sd]? .{0,20}paid|payment (execution )?layer|\bprovider\b.{0,20}(sdk|toolkit|platform))",
    re.I,
)


def gh(args):
    tok = subprocess.run(["gh", "auth", "token"], capture_output=True, text=True).stdout.strip()
    env = dict(os.environ, GH_TOKEN=tok)
    r = subprocess.run(["gh"] + args, capture_output=True, text=True, env=env, timeout=60)
    return r.returncode, r.stdout, r.stderr


def api_json(path_args):
    rc, out, err = gh(["api"] + path_args)
    if rc != 0:
        return None
    try:
        return json.loads(out)
    except Exception:
        return None


def slug(full_name):
    return "gh-" + re.sub(r"[^a-z0-9]+", "-", full_name.lower()).strip("-")


def already_contacted(full_name, number):
    if not os.path.isdir(SENT_DIR):
        return False
    s = slug(full_name)
    for f in os.listdir(SENT_DIR):
        fl = f.lower()
        # match repo slug with the issue number, tolerating the sent-file naming
        if s in fl and (str(number) in fl or fl.endswith(".md") and s in fl):
            # require the issue number to appear to avoid matching a different issue
            if re.search(r"[-_]" + str(number) + r"(\.|$|[-_])", fl) or s + "-" + str(number) in fl:
                return True
    return False


def infer_network(repo_meta, body):
    text = " ".join(filter(None, [
        repo_meta.get("description") or "",
        " ".join(repo_meta.get("topics") or []),
        body or "",
    ]))
    other = bool(OTHER_CHAIN.search(text))
    base = bool(BASE_EVM.search(text))
    if base and not other:
        return "base-evm"
    if other and not base:
        return "other-chain"
    if base and other:
        return "multi-or-ambiguous"
    return "unknown"


def main():
    want_json = "--json" in sys.argv
    seen = {}
    errors = 0
    for q in QUERIES:
        # jq with multiple objects returns newline-delimited JSON.
        rc, out, err = gh(["api", "-X", "GET", "search/issues", "-f",
                           f"q={q} created:>{CREATED_AFTER}", "--jq",
                           ".items[] | {num:.number, title:.title, body:(.body//\"\"), user:.user.login, "
                           "assoc:.author_association, "
                           "created:.created_at, repo:(.repository_url|split(\"/\")|.[-2:]|join(\"/\"))}"])
        if rc != 0:
            errors += 1
            continue
        for line in out.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                it = json.loads(line)
            except Exception:
                continue
            key = (it["repo"], it["num"])
            if key not in seen:
                seen[key] = it

    now = datetime.datetime.utcnow()
    targets = []
    for (repo, num), it in seen.items():
        if it["user"] in OUR_AUTHORS:
            continue  # our own pitch, not demand
        meta = api_json(["repos/" + repo, "--jq",
                         "{description:.description, topics:.topics, pushed_at:.pushed_at, "
                         "stargazers_count:.stargazers_count, language:.language}"]) or {}
        pushed = meta.get("pushed_at")
        age_days = None
        if pushed:
            try:
                age_days = (now - datetime.datetime.strptime(pushed, "%Y-%m-%dT%H:%M:%SZ")).days
            except Exception:
                pass
        net = infer_network(meta, it.get("body", ""))
        contacted = already_contacted(repo, num)
        active = age_days is not None and age_days <= 45
        # Chain-fit is the PROVEN replied->paid conversion killer. Measured against the
        # 58-reply corpus (2026-10-21): every explicit NO that named a reason gave chain
        # mismatch — Robinhood Chain (fly.ai), XRP (Sluzen/Agorean), BNB (pokter),
        # Solana/NEAR (noobshole). Our paid call requires signing a *Base* EIP-3009 USDC
        # authorization; an agent whose wallet/framework signs another chain replies
        # "interested" then cannot convert without cross-chain friction. So HOT now needs
        # POSITIVE Base/EVM evidence (net == base-evm), not merely absence of another chain.
        # "unknown"/"multi" = chain-fit UNCONFIRMED -> WARM (surfaced, never named the single
        # best target). Signal is derived per-repo from desc/topics/body, degrades open.
        strong_base = net == "base-evm"
        plausible_base = net in ("multi-or-ambiguous", "unknown")
        # Demand vs rival-seller: a repo OWNER/MEMBER/COLLABORATOR opening the issue is
        # the team building/planning a BUYER (demand-side). An outsider (assoc NONE)
        # posting an external endpoint + price is a rival SELLER pitching — not a buyer
        # for us. This is the key discriminator; without it the feed is ~80% rival noise.
        assoc = (it.get("assoc") or "NONE").upper()
        insider = assoc in ("OWNER", "MEMBER", "COLLABORATOR", "CONTRIBUTOR")
        body = it.get("body", "")
        text = (it.get("title", "") + "\n" + body)
        research = bool(NO_PAY.search(text) or ANALYST.search(text) or PARKED.search(text))
        # Seller-self keys on the REPO's own description (what it IS), not the issue text.
        seller_self = bool(SELLER_SELF.search(meta.get("description") or ""))

        if contacted:
            tier = "CONTACTED"
        elif not insider or seller_self:
            tier = "SELLER_PITCH"  # outsider pitching, OR an insider whose repo sells/exposes its own service — a rival, not demand
        elif research:
            tier = "RESEARCH"  # census/collector/observatory or forbids paid requests — never a payer
        elif net == "other-chain":
            tier = "COLD"  # their x402 client policy would refuse a Base challenge
        elif strong_base and active:
            tier = "HOT"  # positive Base/EVM evidence + active = genuinely convertible
        elif strong_base:
            tier = "WARM"  # Base-confirmed but stale
        elif plausible_base and active:
            tier = "WARM"  # active but chain-fit UNCONFIRMED — don't crown it the best target
        else:
            tier = "COLD"

        targets.append({
            "repo": repo, "issue": num, "url": f"https://github.com/{repo}/issues/{num}",
            "title": it["title"], "author": it["user"], "assoc": assoc, "created": it["created"],
            "network": net, "age_days": age_days, "stars": meta.get("stargazers_count"),
            "lang": meta.get("language"), "contacted": contacted, "tier": tier,
        })

    rank = {"HOT": 0, "WARM": 1, "COLD": 2, "RESEARCH": 3, "SELLER_PITCH": 4, "CONTACTED": 5}
    targets.sort(key=lambda t: (rank[t["tier"]], t["age_days"] if t["age_days"] is not None else 9999))

    out = {
        "generated_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "status": "ok" if errors == 0 else f"degraded:{errors}_query_errors",
        "created_after": CREATED_AFTER,
        "n_targets": len(targets),
        "hot": [t for t in targets if t["tier"] == "HOT"],
        "targets": targets,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(out, f, indent=2)

    if want_json:
        print(json.dumps(out, indent=2))
        return

    print(f"=== buyer-intent scanner ({out['status']}) — {len(targets)} open buyer-build issues since {CREATED_AFTER} ===")
    hot = out["hot"]
    print(f"HOT (Base-compatible + active + un-contacted): {len(hot)}")
    flags = {"HOT": "✦", "WARM": "~", "COLD": "·", "RESEARCH": "?", "SELLER_PITCH": "$", "CONTACTED": "✓"}
    for t in targets:
        if t["tier"] in ("RESEARCH", "SELLER_PITCH", "CONTACTED"):
            continue  # genuine Base-serviceable demand only in the human view; full set in JSON
        flag = flags[t["tier"]]
        age = f"{t['age_days']}d" if t["age_days"] is not None else "?"
        print(f"  [{flag} {t['tier']:9}] {t['repo']}#{t['issue']}  by={t['assoc']:12} net={t['network']:18} "
              f"age={age:>5} ★{t['stars']}  :: {t['title'][:60]}")
    print(f"\nwrote {OUT}")
    if hot:
        best = hot[0]
        print(f"\n>>> ACT THIS CYCLE: {best['url']}  ({best['title'][:80]})")
    else:
        print("\n>>> No HOT Base-compatible active target this cycle. WARM (stale-but-Base) or wait for feed to refresh.")


if __name__ == "__main__":
    main()
