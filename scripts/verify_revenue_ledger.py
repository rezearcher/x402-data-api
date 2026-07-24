#!/usr/bin/env python3
"""
verify_revenue_ledger.py — Forensic self-traffic classification of revenue_ledger.

Normal mode (no --probe-check):
  Reads ~/.hermes/data/<play>-revenue/ledger.jsonl, resolves each row's
  USDC Transfer event `from` address via eth_getTransactionReceipt on Base
  mainnet public RPC, classifies rows as self_traffic vs external, and writes
  a verified summary sidecar file.

Probe-check mode (--probe-check):
  Reads the existing ledger_verified_summary.json, takes every address
  classified as external (self_traffic=false), probes them via Base Blockscout
  API and eth_getTransactionCount, and computes a probe/bot-fingerprint score
  from three heuristics:
    1. nonce_tx_count — total tx count (eth_getTransactionCount)
    2. repeated_method_burst — count of identical-method calls to any single
       contract within a 120-second window (sybil/farming automation signature)
    3. farm_token_receipt_count — count of unsolicited low-value token transfers
       received from addresses never otherwise interacted with
  Writes probe_check_summary.json (sidecar, does NOT mutate existing files).

Usage:
  python3 scripts/verify_revenue_ledger.py [play_name]
  python3 scripts/verify_revenue_ledger.py --probe-check [play_name]
"""

import json
import os
import sys
import time
import urllib.parse
import urllib.request
import urllib.error
from collections import defaultdict
from datetime import datetime

# ── configuration ──────────────────────────────────────────────────
RPC_URL = "https://mainnet.base.org"
BLOCKSCOUT_API = "https://base.blockscout.com/api/v2"
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

# Rate limiting: public RPC can throttle.
RPC_DELAY_S = 0.2
BLOCKSCOUT_DELAY_S = 0.3
MAX_RETRIES = 3

# ── RPC helpers ────────────────────────────────────────────────────

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


def eth_get_transaction_count(addr: str) -> int | None:
    """Get the nonce / total tx count for an address via eth_getTransactionCount."""
    result = rpc_call("eth_getTransactionCount", [addr, "latest"])
    if result is None:
        return None
    # result is hex "0x..."
    try:
        return int(result, 16)
    except (ValueError, TypeError):
        return None


# ── Blockscout API helpers ─────────────────────────────────────────

def blockscout_get(path: str) -> dict | None:
    """Fetch a resource from the free, keyless Base Blockscout API."""
    url = f"{BLOCKSCOUT_API}{path}"
    req = urllib.request.Request(url, headers={"User-Agent": "curl/8.12.1"})
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                return json.loads(resp.read().decode())
        except urllib.error.HTTPError as e:
            if e.code == 429:
                print(f"  [Blockscout rate-limited, backing off] {path}", file=sys.stderr)
                time.sleep(2 * attempt)
                continue
            print(f"  [Blockscout HTTP {e.code}] {path}", file=sys.stderr)
            return None
        except Exception as e:
            if attempt < MAX_RETRIES:
                time.sleep(BLOCKSCOUT_DELAY_S * attempt)
            else:
                print(f"  [Blockscout failed after {MAX_RETRIES} attempts] {e}", file=sys.stderr)
                return None
    return None


def fetch_all_blockscout_items(base_path: str, max_pages: int = 5) -> list[dict]:
    """
    Fetch a paginated Blockscout endpoint.
    base_path: e.g. "/addresses/0x.../transactions"
    Returns concatenated items array.
    """
    items = []
    next_url = base_path
    for page in range(max_pages):
        if next_url is None:
            break
        data = blockscout_get(next_url)
        if data is None:
            break
        batch = data.get("items", [])
        items.extend(batch)
        next_link = data.get("next_page_params")
        if next_link and isinstance(next_link, dict):
            params = "&".join(
                f"{k}={v}" if not isinstance(v, str) else f"{k}={urllib.parse.quote(v)}"
                for k, v in next_link.items()
                if v is not None
            )
            next_url = f"{base_path}?{params}"
        else:
            next_url = None
        time.sleep(BLOCKSCOUT_DELAY_S)
    return items


# ── USDC from-address resolver ─────────────────────────────────────

def resolve_usdc_from(tx_hash: str) -> str | None:
    """
    Fetch the transaction receipt and extract the USDC Transfer event's
    indexed `from` address (topic[1]).

    NOTE: In an x402 gasless EIP-3009 flow, tx.from is the relayer/facilitator,
    NOT the payer. Only the USDC Transfer event's indexed `from` topic reflects
    who actually paid.
    """
    receipt = rpc_call("eth_getTransactionReceipt", [tx_hash])
    if not receipt:
        return None

    logs = receipt.get("logs", [])
    for log in logs:
        addr = log.get("address", "").lower()
        topics = log.get("topics", [])
        if addr == USDC_ADDR and len(topics) >= 3 and topics[0].lower().startswith(TRANSFER_TOPIC_PREFIX):
            raw_from = topics[1]
            from_addr = ("0x" + raw_from[-40:]).lower()
            return from_addr

    print(f"  [warn] no USDC Transfer log found for tx {tx_hash}", file=sys.stderr)
    return None


# ── Helper: address extraction ──────────────────────────────────────

def _addr(obj) -> str:
    """Extract address hash from dict or string; always lowercase."""
    if isinstance(obj, dict):
        return obj.get("hash", "").lower()
    return str(obj).lower() if obj else ""


# ── Probe-check heuristics ─────────────────────────────────────────

def _addr(obj):
    """Extract address hash from Blockscout's dict format or plain string."""
    if isinstance(obj, dict):
        return obj.get("hash", "").lower()
    return str(obj).lower() if obj else ""


def compute_probe_score(addr: str) -> dict:
    """
    Compute a probe/bot-fingerprint score for an Ethereum address.

    Returns a dict with:
      - address
      - nonce_tx_count (int | None)
      - repeated_method_burst: {count, method, contract, window_seconds}
      - farm_token_receipt_count (int)
      - probe_score (float, 0.0-1.0, 1.0 = almost certainly bot)
      - probe_likely (bool)
      - details (str)
    """
    addr_lower = addr.lower()
    result = {
        "address": addr_lower,
        "nonce_tx_count": None,
        "repeated_method_burst": None,
        "farm_token_receipt_count": 0,
        "probe_score": 0.0,
        "probe_likely": False,
        "details": [],
        "errors": [],
    }

    # ── Heuristic 1: nonce_tx_count ────────────────────────────────
    print(f"\n  [H1] Fetching nonce for {addr_lower}...")
    nonce = eth_get_transaction_count(addr_lower)
    if nonce is None:
        result["errors"].append("nonce_tx_count: RPC call failed")
        print("  [H1] RPC FAILED")
    else:
        result["nonce_tx_count"] = nonce
        print(f"  [H1] nonce = {nonce}")
        # Threshold: nonce >= 1000 is high-activity (bot/probe territory)
        if nonce >= 1000:
            result["probe_score"] += 0.4
            result["details"].append(f"high nonce ({nonce}): +0.4")

    # ── Heuristic 2: repeated_method_burst ─────────────────────────
    print(f"  [H2] Fetching transactions for {addr_lower}...")
    txs = fetch_all_blockscout_items(f"/addresses/{addr_lower}/transactions", max_pages=3)
    print(f"  [H2] Found {len(txs)} transactions in Blockscout")

    if txs:
        # Group calls by (to_address, method_signature) within 120s windows
        calls = []
        for tx in txs:
            # Only consider transactions SENT by the target address (outgoing)
            from_hash = _addr(tx.get("from"))
            if from_hash != addr_lower:
                continue

            to_hash = _addr(tx.get("to"))
            if not to_hash:
                continue

            # Get method signature: prefer tx.method, fallback to input[:10]
            inp = tx.get("input", "0x") or "0x"
            method_sig = tx.get("method") or (inp[:10] if inp.startswith("0x") and len(inp) >= 10 else "0x")

            if method_sig == "0x" or method_sig is None:
                continue

            ts_str = tx.get("timestamp", "")
            try:
                if ts_str:
                    ts = int(datetime.fromisoformat(ts_str.replace("Z", "+00:00")).timestamp())
                else:
                    ts = 0
            except (ValueError, TypeError):
                ts = 0

            if ts > 0:
                calls.append({
                    "to": to_hash,
                    "method": method_sig,
                    "ts": ts,
                })

        # Find bursts: for each (to, method) pair, find count within any 120s window
        bursts = []
        grouped = defaultdict(list)
        for c in calls:
            grouped[(c["to"], c["method"])].append(c["ts"])

        for (to_addr, method_sig), timestamps in grouped.items():
            timestamps.sort()
            for i in range(len(timestamps)):
                window_end = timestamps[i] + 120
                count = sum(1 for t in timestamps[i:] if t <= window_end)
                if count >= 3:  # minimum burst threshold
                    # Actual window: timestamp of last call in burst minus first
                    last_idx = i + count - 1
                    window_s = timestamps[last_idx] - timestamps[i] if last_idx > i else 1
                    bursts.append({
                        "contract": to_addr,
                        "method": method_sig,
                        "count": count,
                        "window_seconds": max(window_s, 1),
                    })
                    break  # one entry per unique (to,method)

        if bursts:
            # Sort by count descending, take the biggest burst
            bursts.sort(key=lambda b: b["count"], reverse=True)
            top_burst = bursts[0]
            result["repeated_method_burst"] = top_burst
            print(f"  [H2] Top burst: {top_burst['count']}x {top_burst['method'][:10]} -> "
                  f"{top_burst['contract'][:20]}... in {top_burst['window_seconds']}s")

            if top_burst["count"] >= 5:
                result["probe_score"] += 0.35
                result["details"].append(
                    f"method burst: {top_burst['count']}x {top_burst['method'][:10]} "
                    f"to {top_burst['contract'][:20]}... in {top_burst['window_seconds']}s: +0.35"
                )
        else:
            print("  [H2] No bursts found (min threshold: 3 calls in 120s)")
    else:
        print("  [H2] No transactions available")

    # ── Heuristic 3: farm_token_receipt_count ──────────────────────
    print(f"  [H3] Fetching token transfers for {addr_lower}...")
    transfers = fetch_all_blockscout_items(f"/addresses/{addr_lower}/token-transfers", max_pages=3)
    print(f"  [H3] Found {len(transfers)} token transfers in Blockscout")

    if transfers:
        # Identify "received" transfers (the address is the `to` field)
        received = [t for t in transfers
                    if _addr(t.get("to")) == addr_lower]
        # The sender address from the transfer
        senders_seen = set()
        farm_count = 0
        farm_tokens = []

        for t in received:
            sender = _addr(t.get("from"))
            if not sender:
                continue

            # Check if this sender appears in the address's own transaction history
            # (i.e., the address ever sent a tx to this sender)
            sent_to_sender = any(
                _addr(c.get("from")) == addr_lower
                and _addr(c.get("to")) == sender
                for c in (txs or [])
            )

            if not sent_to_sender and sender not in senders_seen:
                farm_count += 1
                senders_seen.add(sender)
                token_name = "?"
                if isinstance(t.get("token"), dict):
                    token_name = t["token"].get("symbol", "?") or t["token"].get("name", "?")
                farm_tokens.append({
                    "sender": sender,
                    "token": token_name,
                    "tx_hash": t.get("tx_hash", "")[:20],
                })

        result["farm_token_receipt_count"] = farm_count
        result["farm_tokens"] = farm_tokens
        print(f"  [H3] Unsolicited farm-token receipts: {farm_count}")

        if farm_count >= 1:
            result["probe_score"] += min(0.25, farm_count * 0.1)
            result["details"].append(
                f"farm token receipts: {farm_count} unsolicited transfers: +{min(0.25, farm_count * 0.1):.2f}"
            )
    else:
        print("  [H3] No token transfers available")

    # ── Final verdict ──────────────────────────────────────────────
    # Clamp score to [0.0, 1.0]
    result["probe_score"] = min(1.0, round(result["probe_score"], 3))
    result["probe_likely"] = result["probe_score"] >= 0.5
    verdict = "PROBE/FARMING BOT" if result["probe_likely"] else "LIKELY GENUINE"
    print(f"\n  => Probe score: {result['probe_score']:.3f} — {verdict}")

    return result


# ── Main: normal audit mode ────────────────────────────────────────

def run_audit(play: str):
    """Original audit: resolve USDC from-address for each ledger row."""
    ledger_path = os.path.join(LEDGER_BASE, f"{play}-revenue", "ledger.jsonl")
    summary_path = os.path.join(LEDGER_BASE, f"{play}-revenue", "ledger_verified_summary.json")

    if not os.path.isfile(ledger_path):
        print(f"ERROR: ledger not found at {ledger_path}", file=sys.stderr)
        sys.exit(1)

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
            print(" -> UNRESOLVED (RPC error or no USDC log)")
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

        time.sleep(RPC_DELAY_S)

    total_verified_external_usd = sum(
        r["amount"] for r in classified_rows if r["classification"] == "external"
    )
    total_self_usd = sum(
        r["amount"] for r in classified_rows if r["classification"] == "self_traffic"
    )
    total_unresolved_usd = sum(
        r["amount"] for r in classified_rows if r["classification"] == "unresolved"
    )

    contamination_pct = round(
        (total_self_usd / total_reported_usd * 100) if total_reported_usd > 0 else 0.0,
        2,
    )
    external_pct = round(
        (total_verified_external_usd / total_reported_usd * 100) if total_reported_usd > 0 else 0.0,
        2,
    )

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


# ── Main: probe-check mode ────────────────────────────────────────

def run_probe_check(play: str):
    """Probe-check mode: fingerprint external addresses for bot/farming activity."""
    summary_path = os.path.join(LEDGER_BASE, f"{play}-revenue", "ledger_verified_summary.json")
    probe_path = os.path.join(LEDGER_BASE, f"{play}-revenue", "probe_check_summary.json")

    if not os.path.isfile(summary_path):
        print(f"ERROR: verified summary not found at {summary_path}", file=sys.stderr)
        print("Run `python3 scripts/verify_revenue_ledger.py` first.", file=sys.stderr)
        sys.exit(1)

    with open(summary_path) as f:
        summary = json.load(f)

    # Collect unique external addresses
    external_addrs = set()
    for row in summary.get("rows", []):
        if row.get("classification") == "external" and row.get("from"):
            external_addrs.add(row["from"].lower())

    if not external_addrs:
        print("No external addresses found in verified summary. Nothing to probe.")
        probe_output = {
            "play": play,
            "checked_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "probe_addrs_checked": 0,
            "probe_likely_count": 0,
            "results": [],
        }
        os.makedirs(os.path.dirname(probe_path), exist_ok=True)
        with open(probe_path, "w") as f:
            json.dump(probe_output, f, indent=2)
            f.write("\n")
        print(f"\nProbe check summary written to {probe_path}")
        return

    print(f"\n{'=' * 60}")
    print(f"PROBE CHECK — {play}")
    print(f"External addresses to probe: {', '.join(sorted(external_addrs))}")
    print(f"{'=' * 60}")

    results = []
    for addr in sorted(external_addrs):
        print(f"\n{'─' * 60}")
        print(f"Probing {addr}...")
        print(f"{'─' * 60}")
        score_result = compute_probe_score(addr)
        results.append(score_result)
        print(f"{'─' * 60}")

    probe_likely_count = sum(1 for r in results if r["probe_likely"])

    probe_output = {
        "play": play,
        "checked_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "probe_addrs_checked": len(results),
        "probe_likely_count": probe_likely_count,
        "results": results,
    }

    os.makedirs(os.path.dirname(probe_path), exist_ok=True)
    with open(probe_path, "w") as f:
        json.dump(probe_output, f, indent=2)
        f.write("\n")

    print(f"\n{'=' * 60}")
    print(f"PROBE CHECK COMPLETE — {play}")
    print(f"  Addresses probed: {len(results)}")
    print(f"  Probe-likely:     {probe_likely_count}")
    for r in results:
        label = "PROBE" if r["probe_likely"] else "GENUINE"
        print(f"    {r['address'][:20]}... score={r['probe_score']:.3f} [{label}]")
    print(f"  Written to:       {probe_path}")
    print(f"{'=' * 60}")


# ── Entry point ────────────────────────────────────────────────────

def main():
    args = sys.argv[1:]
    probe_check = "--probe-check" in args
    play = "x402-data-api"

    # Parse play name from remaining args
    remaining = [a for a in args if a != "--probe-check"]
    if remaining:
        play = remaining[0]

    if probe_check:
        run_probe_check(play)
    else:
        run_audit(play)


if __name__ == "__main__":
    main()
