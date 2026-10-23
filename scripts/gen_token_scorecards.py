#!/usr/bin/env python3
"""
Generate and publish per-token Base rug/honeypot scorecard pages to the Grey Ridge
Pages site (rezearcher/greyridge-x402-tools/docs — the Google-crawlable surface).

The token-side twin of gen_mcp_scorecards.py. Programmatic SEO: one crawlable,
measured scorecard per real Base token, each targeting the navigational
"is <SYMBOL> a honeypot / <SYMBOL> rug check / is <SYMBOL> safe to buy (Base)"
query (where honeypot.is / tokensniffer / rugcheck compete but rarely for the
exact Base contract), funneling the free on-chain verdict -> the interactive
/check?token= page -> the $0.01 paid exit-simulation unlock. Pages carry only
MEASURED, dated claims (Claims Law) and read in the Grey Ridge human voice
(PRODUCT BAR — no AI tells).

The token roster is DISCOVERED AT RUNTIME, never hardcoded: GeckoTerminal's
trending Base pools are the ground-truth signal of which tokens humans are
searching for right now. (No hardcoded-list-as-logic — the list rots the moment
a new token trends; we read the live signal instead.)

Data source for the scorecard = our own LIVE engine (keyless preview), two calls:
  GET {BASE}/chain/token-report/preview?token=0x..   (honeypot / tax / mint / pause / blacklist / liquidity)
  GET {BASE}/gate/swap/preview?token=0x..            (engine GO/HOLD/BLOCK decision + risk_score)

Usage:
  python3 scripts/gen_token_scorecards.py --dry-run            # discover + scan, render locally, no push
  python3 scripts/gen_token_scorecards.py --publish            # discover + scan + PUT to Pages + sitemap + IndexNow
  python3 scripts/gen_token_scorecards.py --publish --cap 15   # cap how many tokens to publish this run
"""
import argparse, base64, json, re, subprocess, time, urllib.parse, urllib.request, urllib.error, datetime, os

BASE = os.environ.get("X402_BASE", "https://x402-data-api.sigrunner.workers.dev")
REPO = "rezearcher/greyridge-x402-tools"
DOCS = "docs"
SITE = "https://rezearcher.github.io/greyridge-x402-tools"
UA = {"User-Agent": "Mozilla/5.0 (compatible; GreyRidgeTokenScorecards/1.0)"}
GECKO_TRENDING = "https://api.geckoterminal.com/api/v2/networks/base/trending_pools?page=1"

ADDR_RE = re.compile(r"^0x[0-9a-fA-F]{40}$")

# Curated anchor set of well-known Base tokens addressable by the engine's demo KEYWORD,
# which is a free, UN-metered preview path (the per-token 3/day/IP trial applies only to
# arbitrary 0x addresses). High-search-volume navigational queries ("is DEGEN safe",
# "is AERO a good buy") with no incumbent per-contract answer. This is display-anchor polish,
# NOT a coverage gate — the long tail is discovered at runtime from GeckoTerminal.
SEED_KEYWORDS = ["weth", "usdc", "cbbtc", "aero", "degen"]
INDEXNOW_HOST = "rezearcher.github.io"
INDEXNOW_KEY = "aa3ee6fa313780532656391c0c73664f"


# ---------------------------------------------------------------- discovery
def discover_tokens(cap):
    """Runtime-discovered roster: the base tokens of the currently-trending Base pools.
    Returns an ordered, de-duplicated list of validated 0x contract addresses."""
    req = urllib.request.Request(GECKO_TRENDING, headers={"Accept": "application/json", **UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        d = json.load(r)
    out, seen = [], set()
    for pool in d.get("data", []):
        rel = pool.get("relationships", {})
        tid = (rel.get("base_token", {}).get("data", {}) or {}).get("id", "")
        # GeckoTerminal ids look like "base_0xabc...": strip the network prefix.
        addr = tid.split("_", 1)[-1] if "_" in tid else tid
        addr = addr.strip()
        if not ADDR_RE.match(addr):
            continue
        a = addr.lower()
        if a in seen:
            continue
        seen.add(a)
        out.append(addr)
        if len(out) >= cap:
            break
    return out


# ---------------------------------------------------------------- scan
def _get(url, tries=4):
    """GET JSON with polite backoff on 429 (our own preview routes are rate-limited)."""
    last = None
    for i in range(tries):
        req = urllib.request.Request(url, headers=UA)
        try:
            with urllib.request.urlopen(req, timeout=45) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            last = e
            if e.code == 429 and i < tries - 1:
                time.sleep(4 * (i + 1))
                continue
            raise
    raise last


def scan_token(addr, want_detail=True):
    """The free preview is capped at 3 real-token checks/day/IP (a deliberate conversion
    control — never bypass it). So the AUTHORITATIVE gate verdict is the one required call;
    the detailed token-report is fetched only opportunistically and skipped on quota (429).
    The page renders fully from the gate alone."""
    q = urllib.parse.quote(addr, safe="")
    gate = _get(f"{BASE}/gate/swap/preview?token={q}")
    rep = {}
    if want_detail:
        time.sleep(1.0)
        try:
            rep = _get(f"{BASE}/chain/token-report/preview?token={q}", tries=1)
        except Exception:
            rep = {}  # quota/other — gate alone is enough
    return {"addr": addr, "report": rep, "gate": gate}


def scan_seed(keyword):
    """Scan a well-known token via its demo KEYWORD — a free, un-metered path. The engine
    resolves it to the real 0x address in the response `token` field, which we use for the
    page slug and the /check?token= link so the page is a real per-contract scorecard."""
    q = urllib.parse.quote(keyword, safe="")
    gate = _get(f"{BASE}/gate/swap/preview?token={q}")
    time.sleep(0.8)
    try:
        rep = _get(f"{BASE}/chain/token-report/preview?token={q}", tries=2)
    except Exception:
        rep = {}
    addr = (rep.get("token") or gate.get("token") or "").strip()
    if not ADDR_RE.match(addr):
        return None
    return {"addr": addr, "report": rep, "gate": gate}


# ---------------------------------------------------------------- sanitise (attacker-controlled meta)
_CTRL = re.compile(r"[\x00-\x1f\x7f]")


def clean(s, maxlen=48):
    """Token symbol/name are set by the (untrusted) deployer. Strip control chars,
    neutralise markdown/HTML-breaking characters, and clamp length."""
    if not s:
        return ""
    s = _CTRL.sub("", str(s))
    s = s.replace("<", "").replace(">", "").replace("`", "'").replace("|", "/")
    s = s.replace("[", "(").replace("]", ")").replace("\n", " ").replace("\r", " ")
    s = " ".join(s.split())
    return s[:maxlen]


def slugify_symbol(sym):
    s = (sym or "token").lower()
    s = "".join(c if c.isalnum() else "-" for c in s)
    while "--" in s:
        s = s.replace("--", "-")
    return s.strip("-") or "token"


def slug_for(sym, addr):
    return f"token-{slugify_symbol(sym)}-{addr.lower()[2:8]}-honeypot-check"


# ---------------------------------------------------------------- render (Claims Law: measured only)
def _fmt_usd(v):
    try:
        v = float(v)
    except (TypeError, ValueError):
        return None
    if v >= 1_000_000:
        return f"${v/1_000_000:.2f}M"
    if v >= 1_000:
        return f"${v/1_000:.0f}k"
    return f"${v:,.0f}"


def _measured_flags(sec):
    """Return (clean_flags, risk_flags) from only the fields the scan actually measured."""
    lines = []
    risk = []
    m = {
        "isHoneypot": ("sell simulation succeeded (not a honeypot)", "sell simulation FAILED — token may be a honeypot"),
        "canMint": ("owner cannot mint new supply", "owner CAN mint new supply (dilution risk)"),
        "canPause": ("transfers cannot be paused", "owner CAN pause transfers (freeze risk)"),
        "hasBlacklist": ("no blacklist function found", "contract HAS a blacklist function (your wallet can be blocked)"),
    }
    # isHoneypot inverted: True is bad.
    for key, (good, bad) in m.items():
        v = sec.get(key)
        if v is None:
            continue
        bad_state = v if key != "isHoneypot" else v  # honeypot True == bad; canX True == bad
        if bad_state:
            risk.append(bad)
        else:
            lines.append(good)
    # ownership
    if sec.get("ownerRenounced") is True:
        lines.append("ownership renounced")
    elif sec.get("ownerRenounced") is False:
        risk.append("ownership NOT renounced — the deployer still controls the contract")
    if sec.get("upgradeableProxy") is True:
        risk.append("upgradeable proxy — the contract logic can be swapped after you buy")
    # transfer tax (measured)
    tt = sec.get("transferTaxBps")
    if isinstance(tt, (int, float)):
        if tt > 0:
            risk.append(f"measured transfer fee of {tt/100:.2f}% on a plain transfer")
        else:
            lines.append("0% measured transfer fee")
    return lines, risk


def render(entry, today):
    addr = entry["addr"]
    rep = entry["report"] or {}
    gate = entry["gate"] or {}
    meta = rep.get("token_meta") or gate.get("token_meta") or {}
    sym = clean(meta.get("symbol")) or "this token"
    name = clean(meta.get("name"))
    sec = rep.get("security") or {}
    liq = rep.get("liquidity") or {}
    liq_usd = liq.get("wethPoolUsd")
    if liq_usd is None:
        liq_usd = gate.get("liquidity_usd")
    liq_str = _fmt_usd(liq_usd)

    decision = (gate.get("decision") or "").upper()
    risk_score = gate.get("risk_score")
    reason = clean(gate.get("reason"), 200)
    sim = sec.get("simStatus")

    clean_flags, risk_flags = _measured_flags(sec)

    disp = f"{sym}" + (f" ({name})" if name and name != sym else "")
    title = f"Is {sym} a honeypot? On-chain rug check for the Base token"
    desc_bits = []
    if decision:
        desc_bits.append(f"engine verdict {decision}")
    if isinstance(risk_score, (int, float)):
        desc_bits.append(f"risk {int(risk_score)}/100")
    if liq_str:
        desc_bits.append(f"{liq_str} pool liquidity")
    desc = (f"Independent on-chain honeypot / rug check for {disp} on Base "
            f"({addr}), measured {today}: " + ", ".join(desc_bits) +
            ". Re-run it yourself in one keyless call." if desc_bits else
            f"Independent on-chain honeypot / rug check for {disp} on Base ({addr}), measured {today}.")

    # verdict headline — engine-authoritative, never fabricated
    if decision == "GO":
        head = f"On the measured on-chain checks below, **{sym} passed** — our engine returned a GO."
    elif decision == "HOLD":
        head = f"Our engine returned **HOLD** for {sym} — at least one measured signal warrants caution before you buy."
    elif decision == "BLOCK":
        head = f"Our engine returned **BLOCK** for {sym} — a measured on-chain signal below is a hard red flag."
    else:
        head = f"Here is what an on-chain read of {sym} measured on {today}."

    # build measured-fact lists
    def _bullets(items):
        return "\n".join(f"- {x}" for x in items) if items else "- _(nothing measured in this group)_"

    risk_block = ""
    if risk_flags:
        risk_block = "### Red / caution flags measured\n\n" + _bullets(risk_flags) + "\n\n"
    clean_block = ""
    if clean_flags:
        clean_block = "### Checks it passed\n\n" + _bullets(clean_flags) + "\n\n"

    liq_line = (f"Deepest Uniswap v3 WETH pool held about **{liq_str}** of liquidity when measured"
                if liq_str else "WETH-pool liquidity could not be measured for this token")

    sim_note = ""
    if sim and sim != "tested":
        sim_note = (f"\n> The on-chain sell simulation came back `{clean(sim)}` for this token, so the "
                    f"honeypot/sellable result is not conclusive — treat the liquidity and ownership "
                    f"signals above as the stronger evidence here.\n")

    rs = f" · risk `{int(risk_score)}/100`" if isinstance(risk_score, (int, float)) else ""
    dv = f" · verdict `{decision}`" if decision else ""

    # Quote YAML frontmatter values — title/desc contain ':' and ',' that would otherwise
    # break Jekyll's YAML parse and fail the Pages build.
    def _yq(s):
        return '"' + str(s).replace('\\', ' ').replace('"', "'") + '"'

    body = f"""---
title: {_yq(title)}
description: {_yq(desc)}
---
# Is {sym} a honeypot? — on-chain rug check (Base)

**Token:** `{addr}`
**Chain:** Base · **Measured:** {today}{dv}{rs}

{head}

{reason + '.' if reason and reason[-1] not in '.!?' else reason}

{risk_block}{clean_block}{liq_line}.{sim_note}

## See the live verdict and size your exit

The numbers above are a point-in-time read — a token's contract and its liquidity can change,
so check it fresh before you trade. The interactive card shows the current GO / HOLD / BLOCK,
and the paid unlock simulates what you would actually recover selling $100 / $1k / $10k / $50k
of {sym} into this pool after slippage:

**[Open the live {sym} safety card ->]({BASE}/check?token={addr})**

## Re-run this check yourself

No account, no key:

```bash
curl "{BASE}/chain/token-report/preview?token={addr}"
curl "{BASE}/gate/swap/preview?token={addr}"
```

The free response gives the verdict, risk score and measured security flags. The `$0.01 USDC`
[x402](https://x402.org) unlock on Base adds the exit-slippage simulation for real trade sizes —
no account needed.

## What this checks, stated plainly

The scan reads the contract and its Uniswap liquidity on-chain: it simulates a `transfer()` to
measure the transfer fee and whether a sell would revert (honeypot), and it reads the mint, pause,
blacklist, ownership-renounced and upgradeable-proxy capabilities. DEX buy/sell swap tax is **not**
measured — only the transfer fee. Base only. This is a heuristic signal to help you avoid obvious
traps, **not financial advice**.

## More Base token checks

- [All token rug checks](token-rug-checks.html)
- [Honeypot check API for Base tokens](honeypot-check-api-base.html)
- [Pre-trade safety gate for AI agents](pre-trade-safety-gate-ai-agents.html)

Independent on-chain scan by [Grey Ridge Signals](https://github.com/rezearcher/greyridge-x402-tools).
Measured on {today}; re-run the commands above for a current result. Questions: contact@greyridgesignals.ai
"""
    return body, desc, disp, decision


# ---------------------------------------------------------------- index page
def render_index(cards, today):
    rows = []
    for c in sorted(cards, key=lambda x: x["disp"].lower()):
        v = f" — {c['decision']}" if c["decision"] else ""
        rows.append(f"- [{c['disp']}]({c['slug']}.html){v}")
    body = f"""---
title: "Base token rug & honeypot checks — measured on-chain"
description: "Independent, measured on-chain honeypot / rug checks for trending Base tokens. Free verdict, keyless re-run, paid exit-slippage simulation."
---
# Base token rug & honeypot checks

Independent, on-chain honeypot and rug checks for currently-trending Base tokens — each one
measures the contract's sell simulation, transfer fee, mint / pause / blacklist capability,
ownership and Uniswap liquidity, then returns a GO / HOLD / BLOCK verdict you can re-run yourself
with no account.

Updated {today}.

{chr(10).join(rows)}

Check any other Base token free: `curl "{BASE}/chain/token-report/preview?token=0xYourToken"` —
or open the [live safety card]({BASE}/check). Not financial advice.

By [Grey Ridge Signals](https://github.com/rezearcher/greyridge-x402-tools) · contact@greyridgesignals.ai
"""
    return body


# ---------------------------------------------------------------- GitHub + IndexNow plumbing
def gh_get_sha(path):
    try:
        out = subprocess.check_output(
            ["gh", "api", f"repos/{REPO}/contents/{path}"],
            stderr=subprocess.DEVNULL, env=ENV)
        return json.loads(out).get("sha")
    except subprocess.CalledProcessError:
        return None


def gh_put(path, content, msg):
    b64 = base64.b64encode(content.encode()).decode()
    sha = gh_get_sha(path)
    args = ["gh", "api", f"repos/{REPO}/contents/{path}", "-X", "PUT",
            "-f", f"message={msg}", "-f", f"content={b64}"]
    if sha:
        args += ["-f", f"sha={sha}"]
    subprocess.check_output(args, stderr=subprocess.STDOUT, env=ENV)


def all_docs_html():
    """Ground-truth: every .md in docs/ -> its .html, so the sitemap never starves
    existing pages (MCP scorecards, token scorecards, static articles)."""
    try:
        out = subprocess.check_output(
            ["gh", "api", f"repos/{REPO}/contents/{DOCS}", "--paginate"],
            stderr=subprocess.DEVNULL, env=ENV)
        names = [x.get("name", "") for x in json.loads(out)]
        return sorted({n[:-3] + ".html" for n in names if n.endswith(".md")})
    except Exception as e:
        print(f"sitemap: could not list docs/ ({e})")
        return []


def publish_sitemap(today):
    locs = [f"{SITE}/"]
    for h in all_docs_html():
        if h == "index.html":
            continue
        locs.append(f"{SITE}/{h}")
    seen, ordered = set(), []
    for loc in locs:
        if loc not in seen:
            seen.add(loc)
            ordered.append(loc)
    rows = "\n".join(f"<url><loc>{loc}</loc><lastmod>{today}</lastmod></url>" for loc in ordered)
    xml = ('<?xml version="1.0" encoding="UTF-8"?>\n'
           '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
           f"{rows}\n</urlset>\n")
    gh_put(f"{DOCS}/sitemap.xml", xml, f"sitemap: {len(ordered)} URLs incl. token rug checks ({today})")
    print(f"PUT {DOCS}/sitemap.xml ({len(ordered)} urls)")
    return ordered


def ping_indexnow(urls):
    payload = json.dumps({
        "host": INDEXNOW_HOST, "key": INDEXNOW_KEY,
        "keyLocation": f"{SITE}/{INDEXNOW_KEY}.txt", "urlList": urls,
    }).encode()
    req = urllib.request.Request("https://api.indexnow.org/IndexNow", data=payload,
                                 headers={"Content-Type": "application/json; charset=utf-8", **UA}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            print(f"IndexNow: submitted {len(urls)} URLs -> HTTP {r.status}")
            return True
    except Exception as e:
        print(f"IndexNow: submit failed ({e}) -- sitemap still updated, non-fatal")
        return False


# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--publish", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--cap", type=int, default=3,
                    help="max tokens this run. Free preview is 3 real-token checks/day/IP, so 3 gate-only tokens fits one day.")
    ap.add_argument("--detail", action="store_true",
                    help="also fetch the itemized token-report for the first discovered token (costs an extra daily-quota slot)")
    ap.add_argument("--no-seeds", action="store_true",
                    help="skip the free well-known keyword seeds; only publish runtime-discovered trending tokens")
    args = ap.parse_args()
    if not (args.publish or args.dry_run):
        args.dry_run = True
    today = datetime.date.today().isoformat()

    cards, put_urls, seen_addr = [], [], set()

    def _emit(entry):
        addr = entry["addr"]
        if addr.lower() in seen_addr:
            return
        meta = (entry["report"] or {}).get("token_meta") or (entry["gate"] or {}).get("token_meta") or {}
        sym = clean(meta.get("symbol"))
        if not sym:
            print(f"  skip {addr}: no symbol (metadata read failed)")
            return
        seen_addr.add(addr.lower())
        body, _desc, disp, decision = render(entry, today)
        sl = slug_for(sym, addr)
        cards.append({"slug": sl, "disp": disp, "decision": decision})
        print(f"  {sym:>10}  {decision or '-':<5}  {sl}")
        if args.publish:
            gh_put(f"{DOCS}/{sl}.md", body, f"token scorecard: {disp} rug/honeypot check ({today})")
            put_urls.append(f"{SITE}/{sl}.html")

    # 1) well-known keyword seeds — free, un-metered; always safe to (re)publish
    if not args.no_seeds:
        for kw in SEED_KEYWORDS:
            try:
                entry = scan_seed(kw)
            except Exception as e:
                print(f"  seed {kw} failed: {e}")
                continue
            if entry:
                _emit(entry)
            time.sleep(1.5)

    # 2) runtime-discovered trending tokens — bounded by the 3/day/IP free-preview quota
    addrs = discover_tokens(args.cap)
    print(f"discovered {len(addrs)} trending Base tokens from GeckoTerminal")
    for i, addr in enumerate(addrs):
        try:
            entry = scan_token(addr, want_detail=(args.detail and i == 0))
        except Exception as e:
            print(f"  scan failed {addr}: {e}")
            continue
        _emit(entry)
        time.sleep(2.5)

    if not cards:
        print("no publishable tokens this run")
        return

    if args.publish:
        gh_put(f"{DOCS}/token-rug-checks.md", render_index(cards, today),
               f"token rug-check index: {len(cards)} tokens ({today})")
        put_urls.append(f"{SITE}/token-rug-checks.html")
        publish_sitemap(today)
        ping_indexnow(put_urls)
        print(f"PUBLISHED {len(cards)} token scorecards + index")
    else:
        print(f"DRY RUN: would publish {len(cards)} token scorecards + index (use --publish)")


if __name__ == "__main__":
    ENV = dict(os.environ)
    tok = subprocess.run(["bash", "scripts/gh_token.sh"], capture_output=True, text=True).stdout.strip()
    if tok:
        ENV["GH_TOKEN"] = tok
    main()
