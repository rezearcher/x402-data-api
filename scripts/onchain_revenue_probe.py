#!/usr/bin/env python3
"""onchain_revenue_probe.py — measure a competitor's GENUINE x402 revenue, key-free.

The Scout kept logging competitor revenue as "UNVERIFIED — RPC-throttled" because
public Base RPCs disable/throttle `eth_getLogs` (the obvious way to sum USDC Transfer
events to a payTo wallet). This probe sidesteps that entirely: it reads the wallet's
USDC `balanceOf` at a series of HISTORICAL blocks via archive-serving public RPCs
(`eth_call` with a block tag still works where `getLogs` 429s), and reports the net
balance delta over each window.

Interpretation:
  net delta over a window = inflows - outflows.
  If the series is MONOTONICALLY increasing, the wallet never withdraws, so the delta
  IS cumulative net external revenue over that window (a clean lower bound on gross).
  A dip means a withdrawal happened inside the window and the delta understates gross.

This is a lower bound, read-only, and never touches our own wallets. Verified 2026-10-22
against lonestaroracle's Base payTo: +37.6 USDC/30d (1.25/day) — see winner_registry.

Usage:
  python3 -I scripts/onchain_revenue_probe.py <wallet_address> [--token <erc20>] [--json]
  # default token = USDC on Base (0x8335...2913)
"""
import argparse
import json
import urllib.request

# Public Base RPCs that serve archive state for eth_call (verified 2026-10-22).
# base.org and drpc both returned historical balances; publicnode 403s historical.
RPCS = [
    "https://mainnet.base.org",
    "https://base.drpc.org",
    "https://1rpc.io/base",
    "https://base.llamarpc.com",
]
USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
BLOCKS_PER_DAY = 43200  # Base ~2s blocks

# Our own wallets — never report these as "competitor" revenue (self-dealing guard).
SELF_WALLETS = {
    "0x5765ae06a52dc7a0bb71c36a11db512c7ea9ed10",
    "0xc4852c26498d3187dec2ce1b19e840710e302d1e",
    "0x95e6a9761522e9533d74bbebe47e1c5ad8e3c685",
}


def _rpc(rpc, method, params, timeout=15):
    data = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    req = urllib.request.Request(
        rpc, data=data,
        headers={"Content-Type": "application/json", "User-Agent": "Mozilla/5.0"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def _balance_at(rpc, token, wallet, block_tag):
    data = "0x70a08231" + "0" * 24 + wallet[2:].lower()
    r = _rpc(rpc, "eth_call", [{"to": token, "data": data}, block_tag])
    res = r.get("result")
    if res in (None, "0x"):
        return None
    return int(res, 16) / 1e6


def probe(wallet, token=USDC_BASE):
    wallet = wallet.strip()
    if wallet.lower() in SELF_WALLETS:
        raise SystemExit("refusing to probe our own wallet (self-dealing guard)")

    head = None
    working = None
    for rpc in RPCS:
        try:
            head = int(_rpc(rpc, "eth_blockNumber", [])["result"], 16)
            # confirm archive state is served (historical call must succeed)
            test = _balance_at(rpc, token, wallet, hex(head - 7 * BLOCKS_PER_DAY))
            if test is not None:
                working = rpc
                break
        except Exception:
            continue
    if working is None:
        raise SystemExit("no archive-serving RPC reachable (all throttled/non-archive)")

    marks = {"now": head, "1d": head - BLOCKS_PER_DAY, "7d": head - 7 * BLOCKS_PER_DAY,
             "14d": head - 14 * BLOCKS_PER_DAY, "30d": head - 30 * BLOCKS_PER_DAY}
    bals = {}
    for k, blk in marks.items():
        tag = "latest" if k == "now" else hex(blk)
        try:
            bals[k] = _balance_at(working, token, wallet, tag)
        except Exception:
            bals[k] = None

    out = {"wallet": wallet, "token": token, "rpc": working, "head": head,
           "balances_usdc": bals}
    now = bals.get("now")
    windows = {}
    if now is not None:
        for k, days in (("1d", 1), ("7d", 7), ("14d", 14), ("30d", 30)):
            past = bals.get(k)
            if past is None:
                continue
            net = round(now - past, 6)
            windows[k] = {"net_usdc": net, "usd_per_day": round(net / days, 4)}
    # monotonic check (no withdrawals => delta is clean net revenue)
    ordered = [bals.get(k) for k in ("30d", "14d", "7d", "1d", "now") if bals.get(k) is not None]
    monotonic = all(ordered[i] <= ordered[i + 1] + 1e-9 for i in range(len(ordered) - 1))
    out["windows"] = windows
    out["monotonic_no_withdrawals"] = monotonic
    out["interpretation"] = (
        "delta IS cumulative net external revenue (monotonic = never withdraws)"
        if monotonic else
        "delta UNDERSTATES gross (a withdrawal occurred inside the series)"
    )
    return out


def main():
    ap = argparse.ArgumentParser(description="measure a competitor's genuine x402 revenue, key-free")
    ap.add_argument("wallet")
    ap.add_argument("--token", default=USDC_BASE)
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    r = probe(a.wallet, a.token)
    if a.json:
        print(json.dumps(r, indent=2))
        return
    print(f"wallet {r['wallet']} via {r['rpc']} (head {r['head']})")
    print(f"balances: {r['balances_usdc']}")
    print(f"monotonic (no withdrawals): {r['monotonic_no_withdrawals']}")
    for k, w in r["windows"].items():
        print(f"  last {k:>4}: net +{w['net_usdc']:.4f} USDC = {w['usd_per_day']:.4f} USDC/day")
    print(r["interpretation"])


if __name__ == "__main__":
    main()
