"""Pure, dependency-free core for the Grey Ridge DeFi / market-data tools.

No CrewAI and no x402 imports live here, so the fetch + shaping logic can be
unit-tested offline and run keyless (preview tier) with nothing but the Python
standard library.

These wrap our OWN live x402 routes (near-100% margin, DefiLlama / Base-RPC
upstream, served from a sub-cent Cloudflare Worker): /defi/yields ($0.001),
/crypto/prices ($0.001), /chain/balance ($0.002) and the Base-RPC reads
(/chain/gas-price, /chain/block-number, /chain/token-balance, $0.002). This is
the DATA lane — the routes external agents actually pay for — not the pre-trade
safety gate.

The paid path is handled by :mod:`grey_ridge_x402_data.client` (lazy x402). The
keyless / preview path here uses only ``urllib`` so a CrewAI user who just wants
a sample never needs a wallet, ``eth_account`` or ``web3`` installed.
"""

from __future__ import annotations

import json
import re
import urllib.request
from typing import Any, Callable, Dict, List, Optional, Tuple

DATA_BASE = "https://x402-data-api.sigrunner.workers.dev"

# USDC on Base — the default token for a token-balance read when none is given
# (mirrors the server preview default).
BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"

_ADDR_RE = re.compile(r"^0x[a-fA-F0-9]{40}$")
_COINGECKO_ID_RE = re.compile(r"^[a-z0-9-]{1,40}$")

# Common ticker-symbol -> CoinGecko id aliases, mirrored from the server so the
# client accepts the same input the API does. An LLM asked "price of ETH" calls
# with "ETH", not the slug "ethereum"; without this the most natural query threw
# before any request. Unknown symbols pass through lowercased so a real id still
# resolves (degrade-open), never a silent gate.
_COIN_ALIASES: Dict[str, str] = {
    "btc": "bitcoin", "eth": "ethereum", "weth": "weth", "sol": "solana",
    "bnb": "binancecoin", "xrp": "ripple", "ada": "cardano", "doge": "dogecoin",
    "avax": "avalanche-2", "dot": "polkadot", "matic": "matic-network",
    "pol": "matic-network", "link": "chainlink", "uni": "uniswap", "ltc": "litecoin",
    "trx": "tron", "atom": "cosmos", "near": "near", "apt": "aptos", "arb": "arbitrum",
    "op": "optimism", "usdc": "usd-coin", "usdt": "tether", "dai": "dai",
    "wbtc": "wrapped-bitcoin", "cbbtc": "coinbase-wrapped-btc", "steth": "staked-ether",
    "aave": "aave", "mkr": "maker", "ldo": "lido-dao", "crv": "curve-dao-token",
    "snx": "havven", "comp": "compound-governance-token", "aero": "aerodrome-finance",
    "degen": "degen-base", "pepe": "pepe", "shib": "shiba-inu", "ena": "ethena",
    "sui": "sui", "ton": "the-open-network", "hype": "hyperliquid",
}

# A pay-getter returns ``(status_code, parsed_json_or_None)``. The keyless
# default (``plain_get``) only ever hits the free /preview routes.
PayGet = Callable[[str], Tuple[int, Optional[Any]]]


# ---------------------------------------------------------------------------
# Input normalisers
# ---------------------------------------------------------------------------
def normalize_coins(coins: Any) -> List[str]:
    """Normalise ``coins`` (``"a,b"`` or list) to a validated, de-duped id list.

    Raises on a bad id so a malformed call never silently costs a payment.
    """
    if isinstance(coins, (list, tuple)):
        raw = [str(c).strip() for c in coins]
    else:
        raw = [s.strip() for s in str(coins or "").split(",")]
    ids = [_COIN_ALIASES.get(c.lower(), c.lower()) for c in raw if c]
    if not ids:
        raise ValueError("coins must contain at least one CoinGecko id or ticker symbol")
    if len(ids) > 25:
        raise ValueError("coins accepts at most 25 ids")
    bad = [c for c in ids if not _COINGECKO_ID_RE.match(c)]
    if bad:
        raise ValueError(f"invalid coingecko id(s): {', '.join(bad)}")
    # de-dupe, preserve order
    seen: Dict[str, None] = {}
    for c in ids:
        seen.setdefault(c, None)
    return list(seen.keys())


def _clamp_limit(limit: Any, default: int = 20, maximum: int = 100) -> int:
    try:
        n = int(limit)
    except (TypeError, ValueError):
        return default
    if n <= 0:
        return default
    return min(n, maximum)


def _validate_addr(address: Any) -> str:
    a = str(address or "")
    if not _ADDR_RE.match(a):
        raise ValueError(f"invalid Base address: {address}")
    return a


# ---------------------------------------------------------------------------
# URL builders
# ---------------------------------------------------------------------------
def _qs(params: Dict[str, Any]) -> str:
    from urllib.parse import urlencode

    return urlencode({k: v for k, v in params.items() if v is not None})


def build_yields_url(limit: int = 20, project: Optional[str] = None,
                     chain: Optional[str] = None, stable: Any = None,
                     sort: str = "tvl", base: str = DATA_BASE) -> str:
    params: Dict[str, Any] = {"limit": _clamp_limit(limit)}
    if project:
        params["project"] = str(project)
    if chain:
        params["chain"] = str(chain)
    if stable is True or stable == "true":
        params["stable"] = "true"
    params["sort"] = "risk_adjusted" if sort == "risk_adjusted" else "tvl"
    return f"{base}/defi/yields?{_qs(params)}"


def build_yields_preview_url(base: str = DATA_BASE) -> str:
    return f"{base}/defi/yields/preview"


def build_prices_url(coins: Any, base: str = DATA_BASE) -> str:
    ids = normalize_coins(coins)
    return f"{base}/crypto/prices?{_qs({'coins': ','.join(ids)})}"


def build_prices_preview_url(coins: Any, base: str = DATA_BASE) -> str:
    ids = normalize_coins(coins)
    return f"{base}/crypto/prices/preview?{_qs({'coins': ids[0]})}"


def build_balance_url(address: str, base: str = DATA_BASE) -> str:
    return f"{base}/chain/balance?{_qs({'address': _validate_addr(address)})}"


def build_gas_price_url(base: str = DATA_BASE) -> str:
    return f"{base}/chain/gas-price"


def build_gas_price_preview_url(base: str = DATA_BASE) -> str:
    return f"{base}/chain/gas-price/preview"


def build_block_number_url(base: str = DATA_BASE) -> str:
    return f"{base}/chain/block-number"


def build_block_number_preview_url(base: str = DATA_BASE) -> str:
    return f"{base}/chain/block-number/preview"


def build_token_balance_url(address: str, token: Optional[str] = None,
                            base: str = DATA_BASE) -> str:
    tok = _validate_addr(token) if token else BASE_USDC
    return f"{base}/chain/token-balance?{_qs({'address': _validate_addr(address), 'token': tok})}"


def build_token_balance_preview_url(address: str, token: Optional[str] = None,
                                    base: str = DATA_BASE) -> str:
    tok = _validate_addr(token) if token else BASE_USDC
    return f"{base}/chain/token-balance/preview?{_qs({'address': _validate_addr(address), 'token': tok})}"


# ---------------------------------------------------------------------------
# usd() formatter + summarisers (one-line strings the model can relay verbatim)
# ---------------------------------------------------------------------------
def usd(n: Any) -> Optional[str]:
    if not isinstance(n, (int, float)) or isinstance(n, bool) or n != n:
        return None
    a = abs(n)
    if a >= 1e12:
        return f"${n / 1e12:.2f}T"
    if a >= 1e9:
        return f"${n / 1e9:.2f}B"
    if a >= 1e6:
        return f"${n / 1e6:.2f}M"
    if a >= 1e3:
        return f"${round(n):,}"
    return f"${n:.4f}" if a < 1 else f"${n:.2f}"


def summarize_yields(rows: Any) -> str:
    if not isinstance(rows, list) or not rows:
        return "no yield pools"
    t = rows[0] if isinstance(rows[0], dict) else {}
    bits: List[str] = []
    label = " ".join(str(t[k]) for k in ("project", "chain", "symbol") if t.get(k))
    if label:
        bits.append(label)
    if isinstance(t.get("apy"), (int, float)):
        bits.append(f"{t['apy']:.2f}% APY")
    tvl = usd(t.get("tvlUsd"))
    if tvl:
        bits.append(f"TVL {tvl}")
    if t.get("ilRisk") and t.get("ilRisk") != "no":
        bits.append(f"IL risk {t['ilRisk']}")
    return f"Top of {len(rows)}: {' · '.join(bits) or 'pool'}"


def summarize_prices(rows: Any) -> str:
    if not isinstance(rows, list) or not rows:
        return "no prices"
    out = []
    for p in rows[:4]:
        if not isinstance(p, dict):
            continue
        sym = p.get("symbol") or p.get("id")
        price = usd(p.get("price"))
        chg = ""
        c = p.get("change_24h")
        if isinstance(c, (int, float)):
            chg = f" ({'+' if c >= 0 else ''}{c:.2f}%)"
        out.append(f"{sym} {price}{chg}")
    return " · ".join(out)


def summarize_balance(out: Any) -> str:
    if not isinstance(out, dict) or out.get("balance_eth") is None:
        return "no balance"
    try:
        eth = float(out["balance_eth"])
    except (TypeError, ValueError):
        return "no balance"
    u = usd(out.get("balance_usd"))
    addr = f"{str(out['address'])[:10]}…" if out.get("address") else "address"
    return f"{addr} holds {eth:.4f} ETH{f' ({u})' if u else ''} on Base"


# ---------------------------------------------------------------------------
# Activation hint — shown when running WITHOUT a funded wallet
# ---------------------------------------------------------------------------
def fund_onramp_hint() -> str:
    return (
        "Grey Ridge data tools are running in FREE preview mode: you get a 1-row "
        "sample (or the full live value for Base-RPC reads). To unlock full "
        "results (up to 25 prices, 100 ranked yield pools, live Base balances), "
        "set PRIVATE_KEY to a Base wallet holding ~1 USDC (covers ~1000 calls at "
        "$0.001 each, paid inline per call via x402 — no API key, no subscription)."
    )


def _activation(reason: str, paid_url: str, price_usdc: str) -> Dict[str, Any]:
    return {
        "needed": True,
        "mode": "free_preview",
        "reason": reason,
        "hint": fund_onramp_hint(),
        "paid_url": paid_url,
        "price_usdc": price_usdc,
    }


# ---------------------------------------------------------------------------
# Keyless fetch (stdlib only) — used for the free /preview routes
# ---------------------------------------------------------------------------
def plain_get(url: str, timeout: float = 15.0) -> Tuple[int, Optional[Any]]:
    """GET ``url`` with the standard library. Returns ``(status, json|None)``.

    Never raises for an HTTP error status — returns ``(status, None)`` — so a
    runner can degrade rather than throw into the agent loop.
    """
    req = urllib.request.Request(url, headers={"accept": "application/json",
                                               "user-agent": "grey-ridge-x402-data/py"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310 (our own HTTPS host)
            status = resp.getcode() or 200
            body = resp.read().decode("utf-8")
            try:
                return status, json.loads(body)
            except json.JSONDecodeError:
                return status, None
    except urllib.error.HTTPError as e:  # type: ignore[attr-defined]
        return e.code, None
    except Exception:  # noqa: BLE001 — network/DNS/timeout all degrade the same way
        return 0, None


def default_pay_get() -> PayGet:
    """Keyless getter: plain stdlib GET. Only hits free /preview routes."""
    return plain_get


# ---------------------------------------------------------------------------
# Runners — one enriched dict a CrewAI tool can hand straight back to the model.
# Each NEVER raises into the agent runtime; a true outage returns an error dict.
# ---------------------------------------------------------------------------
def run_yields(pay_get: PayGet, *, has_key: bool = True, limit: int = 20,
               project: Optional[str] = None, chain: Optional[str] = None,
               stable: Any = None, sort: str = "tvl",
               base: str = DATA_BASE) -> Dict[str, Any]:
    paid_url = build_yields_url(limit=limit, project=project, chain=chain,
                                stable=stable, sort=sort, base=base)

    def take_preview(reason: str) -> Dict[str, Any]:
        _, out = plain_get(build_yields_preview_url(base))
        rows = out.get("preview") if isinstance(out, dict) else None
        rows = rows if isinstance(rows, list) else []
        res: Dict[str, Any] = {
            "yields": rows, "count": len(rows), "summary": summarize_yields(rows),
            "paid": False, "activation": _activation(reason, paid_url, "0.001"),
            "guard_reasons": [fund_onramp_hint()],
        }
        if isinstance(out, dict) and out.get("total_available") is not None:
            res["total_available"] = out["total_available"]
        return res

    try:
        if not has_key:
            return take_preview("no PRIVATE_KEY configured")
        status, out = pay_get(paid_url)
        if status == 200 and isinstance(out, list):
            return {"yields": out, "count": len(out),
                    "summary": summarize_yields(out), "paid": True}
        reason = ("wallet not funded (paid /defi/yields returned 402)"
                  if status == 402 else f"paid /defi/yields returned HTTP {status}")
        return take_preview(reason)
    except Exception as err:  # noqa: BLE001
        msg = f"defi/yields unavailable: {err}"
        return {"error": msg, "yields": [], "count": 0,
                "summary": f"ERROR: {msg}", "paid": False}


def run_prices(pay_get: PayGet, *, coins: Any, has_key: bool = True,
               base: str = DATA_BASE) -> Dict[str, Any]:
    try:
        paid_url = build_prices_url(coins, base)
    except ValueError as err:
        msg = f"crypto/prices bad input: {err}"
        return {"error": msg, "prices": [], "summary": f"ERROR: {msg}", "paid": False}

    def take_preview(reason: str) -> Dict[str, Any]:
        _, out = plain_get(build_prices_preview_url(coins, base))
        rows = out.get("preview") if isinstance(out, dict) else None
        rows = rows if isinstance(rows, list) else []
        return {"prices": rows, "summary": summarize_prices(rows), "paid": False,
                "activation": _activation(reason, paid_url, "0.001"),
                "guard_reasons": [fund_onramp_hint()]}

    try:
        if not has_key:
            return take_preview("no PRIVATE_KEY configured")
        status, out = pay_get(paid_url)
        if status == 200 and isinstance(out, list):
            return {"prices": out, "summary": summarize_prices(out), "paid": True}
        reason = ("wallet not funded (paid /crypto/prices returned 402)"
                  if status == 402 else f"paid /crypto/prices returned HTTP {status}")
        return take_preview(reason)
    except Exception as err:  # noqa: BLE001
        msg = f"crypto/prices unavailable: {err}"
        return {"error": msg, "prices": [], "summary": f"ERROR: {msg}", "paid": False}


def run_balance(pay_get: PayGet, *, address: str, has_key: bool = True,
                base: str = DATA_BASE) -> Dict[str, Any]:
    # No free preview for a live on-chain read → honest activation stub, never a
    # fabricated balance.
    try:
        paid_url = build_balance_url(address, base)
    except ValueError as err:
        msg = f"chain/balance bad input: {err}"
        return {"error": msg, "address": address, "paid": False,
                "summary": f"ERROR: {msg}"}
    try:
        if not has_key:
            return {"address": address, "paid": False,
                    "summary": "balance requires a funded wallet — running keyless",
                    "activation": _activation("no PRIVATE_KEY configured", paid_url, "0.002"),
                    "guard_reasons": [fund_onramp_hint()]}
        status, out = pay_get(paid_url)
        if status == 200 and isinstance(out, dict):
            return {**out, "paid": True, "summary": summarize_balance(out)}
        reason = ("wallet not funded (paid /chain/balance returned 402)"
                  if status == 402 else f"paid /chain/balance returned HTTP {status}")
        return {"address": address, "paid": False,
                "summary": f"balance unavailable — {reason}",
                "activation": _activation(reason, paid_url, "0.002"),
                "guard_reasons": [fund_onramp_hint()]}
    except Exception as err:  # noqa: BLE001
        msg = f"chain/balance unavailable: {err}"
        return {"error": msg, "address": address, "paid": False,
                "summary": f"ERROR: {msg}"}


def _run_full_preview_read(pay_get: PayGet, *, has_key: bool, paid_url: str,
                           preview_url: str, price_usdc: str,
                           label: str) -> Dict[str, Any]:
    """Base-RPC reads whose FREE preview is byte-identical to the paid route.

    A keyless install gets the REAL live value (never a stub); a funded wallet
    simply moves the read onto the metered paid route.
    """
    try:
        if not has_key:
            status, out = plain_get(preview_url)
            if status == 200 and isinstance(out, dict):
                return {**out, "paid": False}
            return {"error": f"{label} preview unavailable (HTTP {status})", "paid": False}
        status, out = pay_get(paid_url)
        if status == 200 and isinstance(out, dict):
            return {**out, "paid": True}
        # Degrade open: the preview carries the identical live value.
        status2, out2 = plain_get(preview_url)
        if status2 == 200 and isinstance(out2, dict):
            reason = ("wallet not funded (paid returned 402)" if status == 402
                      else f"paid returned HTTP {status}")
            return {**out2, "paid": False,
                    "activation": _activation(reason, paid_url, price_usdc)}
        return {"error": f"{label} unavailable (paid HTTP {status}, preview HTTP {status2})",
                "paid": False}
    except Exception as err:  # noqa: BLE001
        return {"error": f"{label} unavailable: {err}", "paid": False}


def run_gas_price(pay_get: PayGet, *, has_key: bool = True,
                  base: str = DATA_BASE) -> Dict[str, Any]:
    return _run_full_preview_read(
        pay_get, has_key=has_key, paid_url=build_gas_price_url(base),
        preview_url=build_gas_price_preview_url(base), price_usdc="0.002",
        label="chain/gas-price")


def run_block_number(pay_get: PayGet, *, has_key: bool = True,
                     base: str = DATA_BASE) -> Dict[str, Any]:
    return _run_full_preview_read(
        pay_get, has_key=has_key, paid_url=build_block_number_url(base),
        preview_url=build_block_number_preview_url(base), price_usdc="0.002",
        label="chain/block-number")


def run_token_balance(pay_get: PayGet, *, address: str, token: Optional[str] = None,
                      has_key: bool = True, base: str = DATA_BASE) -> Dict[str, Any]:
    try:
        paid_url = build_token_balance_url(address, token, base)
        preview_url = build_token_balance_preview_url(address, token, base)
    except ValueError as err:
        msg = f"chain/token-balance bad input: {err}"
        return {"error": msg, "address": address, "paid": False}
    return _run_full_preview_read(
        pay_get, has_key=has_key, paid_url=paid_url, preview_url=preview_url,
        price_usdc="0.002", label="chain/token-balance")


# ---------------------------------------------------------------------------
# Market-intelligence routes — perp funding, one-call market brief
# ---------------------------------------------------------------------------
# Higher-value routes that lift $/payer above the $0.001-$0.002 base tier and
# that external agents demonstrably bundle. /crypto/funding ($0.004) exposes a
# free 1-row preview (a REAL top-coin sample) so a keyless install still returns
# live data; /brief/market ($0.01) has NO preview, so keyless returns an
# activation stub — never a fabricated brief.
#
# NOTE on price truth: the /crypto/funding/preview note text still reads
# "$0.001", but the LIVE 402 gate charges 0.004 USDC (amount="4000", 6 dp).
# We trust the gate, not the stale preview note.

def build_funding_url(limit: int = 20, base: str = DATA_BASE) -> str:
    return f"{base}/crypto/funding?{_qs({'limit': _clamp_limit(limit)})}"


def build_funding_preview_url(base: str = DATA_BASE) -> str:
    return f"{base}/crypto/funding/preview"


def build_market_brief_url(base: str = DATA_BASE) -> str:
    return f"{base}/brief/market"


def summarize_funding(rows: Any) -> str:
    if not isinstance(rows, list) or not rows:
        return "no funding data"
    t = rows[0] if isinstance(rows[0], dict) else {}
    bits: List[str] = [str(t.get("coin") or "coin")]
    if isinstance(t.get("funding_spread_bps"), (int, float)):
        bits.append(f"arb spread {float(t['funding_spread_bps']):.2f}bps")
    if t.get("signal"):
        bits.append(str(t["signal"]))
    if t.get("best_long_venue") and t.get("best_short_venue"):
        bits.append(f"long@{t['best_long_venue']}/short@{t['best_short_venue']}")
    return f"Top of {len(rows)}: {' · '.join(bits)}"


def summarize_market_brief(out: Any) -> str:
    if not isinstance(out, dict) or out.get("fear_greed") is None:
        return "no market brief"
    bits: List[str] = []
    fg = out.get("fear_greed")
    if isinstance(fg, dict) and fg.get("value") is not None:
        cls = f" ({fg['classification']})" if fg.get("classification") else ""
        bits.append(f"F&G {fg['value']}{cls}")
    g = out.get("global") if isinstance(out.get("global"), dict) else {}
    cap = usd(g.get("total_market_cap_usd"))
    if cap:
        bits.append(f"mcap {cap}")
    if isinstance(g.get("btc_dominance_pct"), (int, float)):
        bits.append(f"BTC dom {g['btc_dominance_pct']:.1f}%")
    trend = out.get("trending")
    if isinstance(trend, list) and trend and isinstance(trend[0], dict):
        t0 = trend[0].get("symbol") or trend[0].get("name")
        if t0:
            bits.append(f"trending {t0}")
    return " · ".join(bits) or "market brief"


def run_funding(pay_get: PayGet, *, limit: int = 20, has_key: bool = True,
                base: str = DATA_BASE) -> Dict[str, Any]:
    """/crypto/funding ($0.004) — cross-venue perp funding + arb spread.

    DEGRADES OPEN to the free top-1 preview (a real top coin) when the paid call
    cannot be paid (no PRIVATE_KEY, or an unfunded wallet → 402). Only depth (up
    to 100 ranked coins) is withheld. Never raises into the agent runtime.
    """
    paid_url = build_funding_url(limit=limit, base=base)

    def take_preview(reason: str) -> Dict[str, Any]:
        _, out = plain_get(build_funding_preview_url(base))
        rows = out.get("preview") if isinstance(out, dict) else None
        rows = rows if isinstance(rows, list) else []
        res: Dict[str, Any] = {
            "funding": rows, "count": len(rows), "summary": summarize_funding(rows),
            "paid": False, "activation": _activation(reason, paid_url, "0.004"),
            "guard_reasons": [fund_onramp_hint()],
        }
        if isinstance(out, dict) and out.get("total_available") is not None:
            res["total_available"] = out["total_available"]
        return res

    try:
        if not has_key:
            return take_preview("no PRIVATE_KEY configured")
        status, out = pay_get(paid_url)
        if status == 200 and isinstance(out, list):
            return {"funding": out, "count": len(out),
                    "summary": summarize_funding(out), "paid": True}
        reason = ("wallet not funded (paid /crypto/funding returned 402)"
                  if status == 402 else f"paid /crypto/funding returned HTTP {status}")
        return take_preview(reason)
    except Exception as err:  # noqa: BLE001
        msg = f"crypto/funding unavailable: {err}"
        return {"error": msg, "funding": [], "count": 0,
                "summary": f"ERROR: {msg}", "paid": False}


def run_market_brief(pay_get: PayGet, *, has_key: bool = True,
                     base: str = DATA_BASE) -> Dict[str, Any]:
    """/brief/market ($0.01) — one-call sentiment + global cap + trending.

    There is NO free preview for this composite route, so a keyless / unfunded
    install gets an honest activation stub (no data) rather than a fabricated
    brief. Never raises into the agent runtime.
    """
    paid_url = build_market_brief_url(base)
    try:
        if not has_key:
            return {"paid": False,
                    "summary": "market brief requires a funded wallet — running keyless",
                    "activation": _activation("no PRIVATE_KEY configured", paid_url, "0.01"),
                    "guard_reasons": [fund_onramp_hint()]}
        status, out = pay_get(paid_url)
        if status == 200 and isinstance(out, dict):
            return {**out, "paid": True, "summary": summarize_market_brief(out)}
        reason = ("wallet not funded (paid /brief/market returned 402)"
                  if status == 402 else f"paid /brief/market returned HTTP {status}")
        return {"paid": False, "summary": f"market brief unavailable — {reason}",
                "activation": _activation(reason, paid_url, "0.01"),
                "guard_reasons": [fund_onramp_hint()]}
    except Exception as err:  # noqa: BLE001
        msg = f"brief/market unavailable: {err}"
        return {"error": msg, "paid": False, "summary": f"ERROR: {msg}"}


# ---------------------------------------------------------------------------
# Token-safety route — pre-trade rug/honeypot verdict
# ---------------------------------------------------------------------------
# /chain/token-report ($0.01) answers "is this Base ERC-20 safe to buy?" with a
# decision-grade verdict — SAFE | CAUTION | AVOID — plus a 0-100 risk_score and
# the reasons (honeypot/sellability simulation, buy/sell tax, owner-renounced +
# mint/pause/blacklist/fee-setter/upgradeable-proxy checks, owner supply %, and
# Uniswap-v3 WETH-pool liquidity in USD). The FREE preview returns the SAME full
# verdict for ANY Base token, but is capped at 3 real tokens/IP/day; the five
# demo tokens (WETH/USDC/cbBTC/AERO/DEGEN) are un-metered. So a keyless install
# returns a REAL verdict (never a stub) — on the default demo token when none is
# given, or on the caller's token until the daily trial is spent, after which it
# honestly reports the trial is exhausted and points at the paid route rather
# than fabricating a verdict. Lifts $/payer above the $0.001 data tier and
# matches GoPlus/honeypot.is/TokenSniffer — but keyless and key-free over x402.

# Aerodrome on Base — an un-metered demo token, used as the default so a keyless
# token-safety probe always returns a real verdict.
DEMO_TOKEN = "0x940181a94a35a4569e4529a3cdfb74e38fd98631"


def build_token_report_url(token: Optional[str] = None,
                           base: str = DATA_BASE) -> str:
    """Paid /chain/token-report URL. Raises on a malformed token so a bad call
    never silently costs a payment."""
    tok = _validate_addr(token) if token else DEMO_TOKEN
    return f"{base}/chain/token-report?{_qs({'token': tok})}"


def build_token_report_preview_url(token: Optional[str] = None,
                                   base: str = DATA_BASE) -> str:
    """FREE /chain/token-report/preview URL (same full verdict, capped 3 real
    tokens/IP/day; demo tokens un-metered)."""
    tok = _validate_addr(token) if token else DEMO_TOKEN
    return f"{base}/chain/token-report/preview?{_qs({'token': tok})}"


def summarize_token_report(out: Any) -> str:
    if not isinstance(out, dict):
        return "no token report"
    if out.get("trial_exhausted"):
        return "token-safety free trial exhausted for today (3/day/IP) — pay $0.01 for any token"
    if out.get("verdict") is None:
        note = out.get("note")
        return f"token report unavailable — {note}" if note else "no token report"
    meta = out.get("token_meta") if isinstance(out.get("token_meta"), dict) else {}
    sym = meta.get("symbol") or out.get("symbol") or "token"
    bits: List[str] = [f"{sym}: {out['verdict']}"]
    if isinstance(out.get("risk_score"), (int, float)):
        bits.append(f"risk {out['risk_score']}/100")
    reasons = out.get("reasons")
    if isinstance(reasons, list) and reasons:
        bits.append("; ".join(str(r) for r in reasons[:3]))
    return " · ".join(bits)


def _shape_token_report(out: Any, *, paid: bool) -> Dict[str, Any]:
    """Shape the preview/paid body into a compact, model-ready verdict object
    (keeps the structured fields an agent needs to gate a trade)."""
    meta = out.get("token_meta") if isinstance(out, dict) and isinstance(out.get("token_meta"), dict) else {}
    reasons = out.get("reasons") if isinstance(out, dict) else None
    result: Dict[str, Any] = {
        "token": out.get("token") if isinstance(out, dict) else None,
        "verdict": out.get("verdict") if isinstance(out, dict) else None,
        "risk_score": out.get("risk_score") if isinstance(out, dict) and isinstance(out.get("risk_score"), (int, float)) else None,
        "symbol": meta.get("symbol"),
        "reasons": [str(r) for r in reasons[:5]] if isinstance(reasons, list) else [],
        "security": out.get("security") if isinstance(out, dict) else None,
        "liquidity": out.get("liquidity") if isinstance(out, dict) else None,
        "paid": paid,
    }
    result["summary"] = summarize_token_report({**(out if isinstance(out, dict) else {}), **result})
    return result


def run_token_report(pay_get: PayGet, *, token: Optional[str] = None,
                     has_key: bool = True, base: str = DATA_BASE) -> Dict[str, Any]:
    """/chain/token-report ($0.01) — the pre-trade safety verdict.

    ``token`` defaults to an un-metered demo token so a keyless probe always
    returns a REAL verdict. A keyless / unfunded install reads the free preview
    (same full verdict, capped 3 real tokens/IP/day); when that daily trial is
    spent the preview returns 429 and this degrades OPEN to an honest
    ``{verdict: None, trial_exhausted: True}`` pointing at the paid route — never
    a fabricated verdict and never a raise into the agent runtime.
    """
    resolved_token = token or DEMO_TOKEN
    try:
        paid_url = build_token_report_url(token, base)
        preview_url = build_token_report_preview_url(token, base)
    except ValueError as err:
        msg = f"chain/token-report bad input: {err}"
        return {"error": msg, "token": token, "verdict": None, "risk_score": None,
                "reasons": [], "paid": False, "summary": f"ERROR: {msg}"}

    def take_preview(reason: str) -> Dict[str, Any]:
        status, out = plain_get(preview_url)
        trial = out.get("trial") if isinstance(out, dict) else None
        trial_left = trial.get("real_token_checks_left_today") if isinstance(trial, dict) else None
        if status == 429 or trial_left == 0:
            # Trial spent — honest degrade-open: no verdict, point at the paid route.
            return {
                "token": resolved_token, "verdict": None, "risk_score": None,
                "reasons": [], "trial_exhausted": True,
                "note": (out.get("error") if isinstance(out, dict) else None)
                or "free real-token trial exhausted (3/day/IP)",
                "paid_url": (out.get("paid_url") if isinstance(out, dict) else None) or paid_url,
                "paid": False,
                "summary": summarize_token_report({"trial_exhausted": True}),
                "activation": _activation(reason, paid_url, "0.01"),
                "guard_reasons": [fund_onramp_hint()],
            }
        if status != 200 or not isinstance(out, dict):
            msg = f"chain/token-report preview unavailable (HTTP {status})"
            return {"error": msg, "token": resolved_token, "verdict": None,
                    "risk_score": None, "reasons": [], "paid": False,
                    "summary": f"ERROR: {msg}"}
        shaped = _shape_token_report(out, paid=False)
        shaped["activation"] = _activation(reason, paid_url, "0.01")
        shaped["guard_reasons"] = [fund_onramp_hint()]
        return shaped

    try:
        if not has_key:
            return take_preview("no PRIVATE_KEY configured — free preview returns the full verdict (capped 3 real tokens/IP/day)")
        status, out = pay_get(paid_url)
        if status == 200 and isinstance(out, dict):
            return _shape_token_report(out, paid=True)
        reason = ("wallet not funded (paid /chain/token-report returned 402)"
                  if status == 402 else f"paid /chain/token-report returned HTTP {status}")
        return take_preview(reason)
    except Exception as err:  # noqa: BLE001
        msg = f"chain/token-report unavailable: {err}"
        return {"error": msg, "token": resolved_token, "verdict": None,
                "risk_score": None, "reasons": [], "paid": False,
                "summary": f"ERROR: {msg}"}
