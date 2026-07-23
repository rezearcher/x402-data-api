#!/usr/bin/env python3
"""
verify_revenue_ledger.py — Forensic self-traffic classification of revenue_ledger.

Reads ~/.hermes/data/<play_name>-revenue/ledger.jsonl, resolves each row's
USDC Transfer event `from` address via eth_getTransactionReceipt on Base
mainnet public RPC (same technique as check_paid_calls.sh), classifies rows
as self_traffic vs external, and writes a verified summary sidecar file.

Usage:
  python3 scripts/verify_revenue_ledger.py [play_name]

The play_name defaults to "x402-data-api". The summary is written to
~/.hermes/data/<play>-revenue/ledger_verified_summary.json.
"""

import json
import os
import sys
import time
import urllib.request

# ── configuration ──────────────────────────────────────────────────
RPC_URL = "https://mainnet.base.org"
USDC_ADDR = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913".lower()
TRANSFER_TOPIC_PREFIX = "0xddf252ad"

# Known self-traffic addresses (see check_paid_calls.sh SELF_ADDRS comment):
#   0xc4852c26498d3187dec2ce1b19e840710e302d1e = buyer-wallet.json funder
#   0x5765ae06a52dc7a0bb71c36a11db512c7ea9ed10 = PAY_TO self-address
SELF_ADDRS = {
    "0xc4852c26498d3187dec2ce1b19e840710e302d1e",
    "0x5765ae06a52dc7a0bb71c36a11db512c7ea9ed10",
}

LEDGER_BASE = os.path.expanduser("~/.hermes/data")

# Rate limiting: public RPC can throttle. 1 call per tx receipt, ~26 txs.
RPC_DELAY_S = 0.2
MAX_RETRIES = 3


# ── helpers ────────────────────────────────────────────────────────
def rpc_call(method: str, params: list) -> dict | None:
    """Execute a JSON-RPC call to the Base public RPC."""
    payload = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    req = urllib.request.Request(
        RPC_URL,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "User-Agent": "curl/8.12.1",
        },
        method="POST",
    )
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = json.loads(resp.read().decode())
            if "error" in data:
                print(f"  [RPC error] {method}: {data['error']}", file=sys.stderr)
                return None
            return data.get("result")
        except Exception as e:
            if attempt < MAX_RETRIES:
                time.sleep(RPC_DELAY_S * attempt)
            else:
                print(f"  [RPC failed after {MAX_RETRIES} attempts] {e}", file=sys.stderr)
                return None


def resolve_usdc_from(tx_hash: str) -> str | None:
    """
    Fetch the transaction receipt and extract the USDC Transfer event's
    indexed `from` address (topic[1]).

    NOTE: In an x402 gasless EIP-3009 flow, tx.from is the relayer/facilitator,
    NOT the payer. Only the USDC Transfer event's indexed `from` topic reflects
    who actually paid — this is the same technique check_paid_calls.sh uses.

    Returns the lowercase 0x-hex address, or None if unresolved.
    """
    receipt = rpc_call("eth_getTransactionReceipt", [tx_hash])
    if not receipt:
        return None

    logs = receipt.get("logs", [])
    for log in logs:
        addr = log.get("address", "").lower()
        topics = log.get("topics", [])
        if addr == USDC_ADDR and len(topics) >= 3 and topics[0].lower().startswith(TRANSFER_TOPIC_PREFIX):
            # topic[1] is a 32-byte indexed address, rightmost 20 bytes
            raw_from = topics[1]
            # Ensure it's 40 hex chars (0x prefix + 40 hex = 42 total)
            from_addr = ("0x" + raw_from[-40:]).lower()
            return from_addr

    print(f"  [warn] no USDC Transfer log found for tx {tx_hash}", file=sys.stderr)
    return None


# ── main ───────────────────────────────────────────────────────────
def main(play: str):
    ledger_path = os.path.join(LEDGER_BASE, f"{play}-revenue", "ledger.jsonl")
    summary_path = os.path.join(LEDGER_BASE, f"{play}-revenue", "ledger_verified_summary.json")

    if not os.path.isfile(ledger_path):
        print(f"ERROR: ledger not found at {ledger_path}", file=sys.stderr)
        sys.exit(1)

    # Read all rows
    rows = []
    with open(ledger_path) as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))

    print(f"Ledger: {len(rows)} rows at {ledger_path}")
    print(f"RPC endpoint: {RPC_URL}")
    print(f"Self-traffic addresses: {', '.join(sorted(SELF_ADDRS))}")
    print()

    total_reported_usd = 0.0
    classified_rows = []
    self_count = 0
    external_count = 0
    unresolved_count = 0

    for i, row in enumerate(rows, 1):
        tx_hash = row.get("ref", "")
        amount = row.get("amount", 0.0)
        total_reported_usd += amount

        print(f"[{i}/{len(rows)}] tx={tx_hash[:20]}... amount=${amount:.4f}", end="")

        from_addr = resolve_usdc_from(tx_hash)

        if from_addr is None:
            classification = "unresolved"
            unresolved_count += 1
            print(f" -> UNRESOLVED (RPC error or no USDC log)")
        elif from_addr in SELF_ADDRS:
            classification = "self_traffic"
            self_count += 1
            print(f" -> SELF_TRAFFIC (from={from_addr})")
        else:
            classification = "external"
            external_count += 1
            print(f" -> EXTERNAL (from={from_addr})")

        classified_rows.append({
            "ref": tx_hash,
            "amount": amount,
            "event": row.get("event", "?"),
            "ts": row.get("ts", "?"),
            "from": from_addr or "unresolved",
            "self_traffic": True if classification == "self_traffic" else False if classification == "external" else None,
            "classification": classification,
        })

        time.sleep(RPC_DELAY_S)  # be kind to public RPC

    # Compute verified external total
    total_verified_external_usd = sum(
        r["amount"] for r in classified_rows if r["classification"] == "external"
    )
    total_self_usd = sum(
        r["amount"] for r in classified_rows if r["classification"] == "self_traffic"
    )
    total_unresolved_usd = sum(
        r["amount"] for r in classified_rows if r["classification"] == "unresolved"
    )

    # Contamination percentage
    contamination_pct = round(
        (total_self_usd / total_reported_usd * 100) if total_reported_usd > 0 else 0.0,
        2,
    )
    external_pct = round(
        (total_verified_external_usd / total_reported_usd * 100) if total_reported_usd > 0 else 0.0,
        2,
    )

    # Build summary
    summary = {
        "play": play,
        "total_ledger_rows": len(rows),
        "total_reported_usd": round(total_reported_usd, 6),
        "total_verified_external_usd": round(total_verified_external_usd, 6),
        "total_self_traffic_usd": round(total_self_usd, 6),
        "total_unresolved_usd": round(total_unresolved_usd, 6),
        "contamination_pct": contamination_pct,
        "external_pct": external_pct,
        "counts": {
            "self_traffic": self_count,
            "external": external_count,
            "unresolved": unresolved_count,
        },
        "rows": classified_rows,
        "verified_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }

    # Write summary
    os.makedirs(os.path.dirname(summary_path), exist_ok=True)
    with open(summary_path, "w") as f:
        json.dump(summary, f, indent=2)
        f.write("\n")

    print()
    print("═" * 60)
    print(f"VERIFIED SUMMARY — play={play}")
    print(f"  Total rows:           {len(rows)}")
    print(f"  Total reported USDC:  ${total_reported_usd:.6f}")
    print(f"  Self-traffic USDC:    ${total_self_usd:.6f} ({self_count} rows)")
    print(f"  External USDC:        ${total_verified_external_usd:.6f} ({external_count} rows)")
    print(f"  Unresolved USDC:      ${total_unresolved_usd:.6f} ({unresolved_count} rows)")
    print(f"  Contamination:        {contamination_pct}%")
    print(f"  True external:        {external_pct}% of reported")
    print(f"  Written to:           {summary_path}")
    print("═" * 60)


if __name__ == "__main__":
    play = sys.argv[1] if len(sys.argv) > 1 else "x402-data-api"
    main(play)
