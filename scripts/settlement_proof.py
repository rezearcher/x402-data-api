#!/usr/bin/env python3
# ---------------------------------------------------------------------------
# settlement_proof.py — turn self-documented x402 settlements into a
# paste-ready, on-chain-verified proof block for a registry/buyer trust-ask.
#
# Reads the authed /internal/traffic-stats?settlements=1 view (every settled
# PAID row now self-documents its facilitator settlement txHash — see
# src/index.ts TrafficLog.getSettlements + the feat(trust) commit). For each
# settlement it does a point-lookup eth_getTransactionReceipt on Base (which
# works at any public RPC — unlike wide getLogs, see cycle 17), decodes the
# USDC Transfer event (indexed `from`/`to` + value), and emits a Markdown
# evidence block ready to drop into a registry proposal or a buyer reply.
#
# This automates by hand the exact work that X402blockchains registry #16/#19
# forced last cycle (manual chain-scan for a named Base mainnet settlement +
# decoded receipt). Now every future external settlement self-documents and
# this script renders the proof on demand.
#
# Run (needs the 1Password service-account `op`, Division vault, for the authed
# traffic-stats secret — same item as scripts/demand_signal.sh):
#     python3 -I scripts/settlement_proof.py [--window-hours 720] [--external-only]
#
# No private keys, no payment authorizations — reads public on-chain data and
# our own aggregate settlement store only.
# ---------------------------------------------------------------------------
import argparse
import json
import subprocess
import sys
import time
import urllib.request

BASE = "https://x402-data-api.sigrunner.workers.dev"
RPC_URL = "https://mainnet.base.org"
USDC_ADDR = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"
TRANSFER_TOPIC_PREFIX = "0xddf252ad"
PAY_TO = "0x5765ae06a52dc7a0bb71c36a11db512c7ea9ed10"

# Known self-traffic addresses — a settlement from one of these is an operator
# canary/test, NOT an external buyer. Label it as such (the registry explicitly
# accepts a labelled operator test; a buyer reply wants a real external payer).
SELF_ADDRS = {
    "0xc4852c26498d3187dec2ce1b19e840710e302d1e",  # buyer-wallet funder
    "0x5765ae06a52dc7a0bb71c36a11db512c7ea9ed10",  # PAY_TO receiving wallet
    "0x95e6a9761522e9533d74bbebe47e1c5ad8e3c685",  # secondary self wallet
}
OP_SECRET_ITEM = "byllgy4p3b27hrscwcdxofe6e4"


def get_secret() -> str:
    try:
        out = subprocess.run(
            ["op", "item", "get", OP_SECRET_ITEM, "--vault", "Division",
             "--fields", "credential", "--reveal"],
            capture_output=True, text=True, timeout=30,
        )
        return out.stdout.strip()
    except Exception as e:  # noqa: BLE001
        print(f"ERROR: could not read traffic-stats secret from 1Password: {e}", file=sys.stderr)
        return ""


def http_json(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": "settlement-proof/1.0"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode())


def rpc(method: str, params: list):
    payload = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    req = urllib.request.Request(
        RPC_URL, data=payload,
        headers={"Content-Type": "application/json", "User-Agent": "curl/8.12.1"},
        method="POST",
    )
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = json.loads(resp.read().decode())
            if "error" in data:
                return None
            return data.get("result")
        except Exception:  # noqa: BLE001
            time.sleep(0.2 * (attempt + 1))
    return None


def decode_transfer(tx_hash: str) -> dict | None:
    """Point-lookup the receipt and decode the USDC Transfer (from/to/value)."""
    receipt = rpc("eth_getTransactionReceipt", [tx_hash])
    if not receipt:
        return None
    for log in receipt.get("logs", []):
        if log.get("address", "").lower() != USDC_ADDR:
            continue
        topics = log.get("topics", [])
        if len(topics) < 3 or not topics[0].lower().startswith(TRANSFER_TOPIC_PREFIX):
            continue
        frm = ("0x" + topics[1][-40:]).lower()
        to = ("0x" + topics[2][-40:]).lower()
        value_atomic = int(log.get("data", "0x0"), 16)
        return {
            "from": frm,
            "to": to,
            "value_atomic": value_atomic,
            "value_usdc": value_atomic / 1_000_000,
            "block": int(receipt.get("blockNumber", "0x0"), 16),
            "status": receipt.get("status"),
            "relayer": receipt.get("from", "").lower(),
        }
    return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--window-hours", type=int, default=720)
    ap.add_argument("--external-only", action="store_true",
                    help="only render settlements from non-self (external) payers")
    args = ap.parse_args()

    secret = get_secret()
    if not secret:
        return 1

    url = f"{BASE}/internal/traffic-stats?settlements=1&window_hours={args.window_hours}&secret={secret}"
    try:
        data = http_json(url)
    except Exception as e:  # noqa: BLE001
        print(f"ERROR: settlements fetch failed: {e}", file=sys.stderr)
        return 1

    settlements = data.get("settlements", [])
    if not settlements:
        print(f"# No self-documented settlements in the last {args.window_hours}h.")
        print("# (The `tx` column is forward-looking — it populates as new paid "
              "calls settle. Pre-feature paid rows have no captured txHash.)")
        return 0

    print(f"# x402 settlement proof — {len(settlements)} self-documented settlement(s), "
          f"last {args.window_hours}h\n")
    rendered = 0
    for s in settlements:
        tx = s.get("tx", "")
        payer_hint = s.get("payer", "").lower()
        path = s.get("path", "")
        dec = decode_transfer(tx)
        frm = (dec or {}).get("from", payer_hint)
        is_self = frm in SELF_ADDRS
        if args.external_only and is_self:
            continue
        rendered += 1
        label = "operator test (self)" if is_self else "EXTERNAL payer"
        print(f"## {path} — {label}")
        print(f"- Tx: https://basescan.org/tx/{tx}")
        if dec:
            to_ok = dec["to"] == PAY_TO
            print(f"- Decoded USDC Transfer: `{frm}` → `{dec['to']}` "
                  f"= **{dec['value_usdc']:.6f} USDC** ({dec['value_atomic']} atomic)")
            print(f"- To == merchant PAY_TO: {'yes' if to_ok else 'NO (mismatch!)'}")
            print(f"- Relayer (tx.from, facilitator): `{dec['relayer']}`")
            print(f"- Block {dec['block']}, receipt status {dec['status']}")
        else:
            print(f"- Payer (from settle header): `{payer_hint}`")
            print("- [warn] receipt lookup failed — tx may be very recent or RPC throttled")
        print()
        time.sleep(0.2)

    if args.external_only and rendered == 0:
        print("# No EXTERNAL settlements in window (all captured settlements are "
              "operator tests). No real external payer has settled since the "
              "self-documenting feature went live.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
