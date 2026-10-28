#!/usr/bin/env python3
"""cdp_settlement_ledger.py — INSERT-ONLY, tamper-evident ledger for x402 settlements.

WHY THIS EXISTS (learned the hard way on 2026-10-28):
  logs/cdp-settlement-tx.log is a single volatile file that each run *rewrites*.
  The second settlement of the day (tx 0xc2e023e9…) replaced the first one's three
  lines (git diff: 3 deletions / 2 insertions); the first run survives only because
  someone copied the file to `cdp-settlement-tx.log.confirmed-*` and because git
  still has the old blob. On top of that, `settle_once.js` implements its "refuse to
  run twice" guard by *grepping that same log* — so archiving the log to keep the
  evidence also disables the guard. A log that doubles as an idempotency key is a
  control that destroys its own audit trail.

  The ledger is therefore append-only by construction and independent of the log:
    * entries are never edited or deleted; `append` refuses if the chain fails
    * every entry commits to the previous entry's sha256 (hash chain), so any
      retrospective edit of any entry is detectable offline with no trusted server
    * a duplicate tx_hash is rejected — the guard that actually holds
    * the chain truth is re-derivable from Base at any time (`audit`), so an
      entry that contradicts the chain is provable fraud rather than a typo

SUBCOMMANDS
  guard    --route ROUTE [--window-days N]   idempotency gate: exit 0 clear / 2 already settled / 1 fail closed
  init     [--file PATH]                     create an empty (unsettled) day file, deliberately, once
  audit    [--days N]                        enumerate every buyer->payTo USDC transfer on Base
  verify   [--file PATH]                     recompute the hash chain; exit 1 on any mutation
  append   [--file PATH] --entry JSON        append one entry (JSON on argv or stdin via '-')
  show     [--file PATH]                     print a summary table

`guard` is what `scripts/settle_once.js` calls before it spends anything. It is
deliberately FAIL-CLOSED: a missing ledger, an unreadable ledger, or a chain that
does not verify all mean "I cannot prove this route was not already settled", and
that is a refusal — not a pass. Exit 2 means a duplicate was found (the guard that
actually holds); exit 1 means the guard itself could not do its job.

Ledger file default: ledger/cdp-settlement-<UTC date>.json  (one file per day).

Entry fields required by the card guardrail: tx_hash, amount_usdc, endpoint,
settled_at, re_listing. `append` enforces them.

Every amount in this ledger is a SELF-SETTLEMENT: payer is our controlled buyer
wallet, payee is our own PAY_TO. It is capital *spend* (audit trail), never
revenue. scripts/verify_revenue_ledger.py excludes both addresses as SELF_ADDRS
and the relay writes no revenue row, so nothing here may be counted as income.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time
import urllib.request
from datetime import datetime, timezone

PROJECT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LEDGER_DIR = os.path.join(PROJECT, "ledger")
USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
BUYER = "0xC4852c26498d3187dEc2ce1b19e840710e302d1e"
PAY_TO = "0x5765ae06a52dc7A0BB71c36A11db512c7ea9ed10"
TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
RPC_ENDPOINTS = [
    "https://base-rpc.publicnode.com",
    "https://1rpc.io/base",
    "https://base.drpc.org",
    "https://mainnet.base.org",
]
REQUIRED = ("tx_hash", "amount_usdc", "endpoint", "settled_at", "re_listing")
SCHEMA = "cdp-settlement-ledger/v1"


# ---------------------------------------------------------------- canonicalisation
def body_hash(entry: dict, prev_hash: str | None) -> str:
    """sha256 over (prev_hash, canonical body). Body excludes the two hash fields."""
    body = {k: v for k, v in entry.items() if k not in ("entry_sha256", "prev_entry_sha256")}
    blob = json.dumps(
        {"prev_entry_sha256": prev_hash, "body": body},
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    )
    return hashlib.sha256(blob.encode()).hexdigest()


def default_path() -> str:
    return os.path.join(LEDGER_DIR, "cdp-settlement-%s.json" % datetime.now(timezone.utc).strftime("%Y-%m-%d"))


def load(path: str) -> dict:
    if not os.path.exists(path):
        return {
            "schema": SCHEMA,
            "insert_only": True,
            "policy": (
                "Append-only. Never edit or delete an entry. Each entry commits to the previous "
                "entry's sha256 (prev_entry_sha256 -> entry_sha256), so any retrospective edit is "
                "detectable by `verify`. One file per UTC day; a day's file is never rewritten after "
                "it is closed. Chain truth is re-derivable via `audit`."
            ),
            "payer": BUYER,
            "payee": PAY_TO,
            "entries": [],
        }
    with open(path, "r", encoding="utf-8") as fh:
        doc = json.load(fh)
    if doc.get("schema") != SCHEMA:
        raise SystemExit("refusing: %s is not a %s ledger" % (path, SCHEMA))
    return doc


def save(path: str, doc: dict) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    os.replace(tmp, path)  # atomic; the old file is never partially visible


def verify(doc: dict) -> list[str]:
    """Return a list of problems. Empty list == intact."""
    problems, prev = [], None
    for i, entry in enumerate(doc.get("entries", []), start=1):
        if entry.get("seq") != i:
            problems.append("entry %d: seq field is %r, expected %d" % (i, entry.get("seq"), i))
        if entry.get("prev_entry_sha256") != prev:
            problems.append(
                "entry %d (%s): prev_entry_sha256 does not link to the previous entry"
                % (i, entry.get("tx_hash", "?")[:12])
            )
        want = body_hash(entry, prev)
        if entry.get("entry_sha256") != want:
            problems.append("entry %d (%s): entry_sha256 mismatch — entry was modified" % (i, entry.get("tx_hash", "?")[:12]))
        prev = entry.get("entry_sha256")
    return problems


def ledger_files() -> list[str]:
    """Every day-file in the ledger directory, oldest first. Never invents one."""
    if not os.path.isdir(LEDGER_DIR):
        return []
    names = [n for n in os.listdir(LEDGER_DIR) if n.startswith("cdp-settlement-") and n.endswith(".json")]
    return sorted(os.path.join(LEDGER_DIR, n) for n in names)


def parse_settled_at(value) -> float | None:
    """ISO-8601 'Z' timestamp -> epoch seconds. None when absent/unparseable."""
    if not value:
        return None
    text = str(value).strip()
    try:
        return datetime.strptime(text, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc).timestamp()
    except ValueError:
        pass
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


# ------------------------------------------------------------------------ chain audit
def rpc(method: str, params: list):
    last = None
    for endpoint in RPC_ENDPOINTS:
        for attempt in range(2):
            try:
                req = urllib.request.Request(
                    endpoint,
                    data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode(),
                    headers={
                        "content-type": "application/json",
                        "accept": "application/json",
                        "user-agent": "Mozilla/5.0 (X11; Linux x86_64) cdp-settlement-ledger/1",
                    },
                )
                with urllib.request.urlopen(req, timeout=45) as fh:
                    doc = json.load(fh)
                if "error" in doc:
                    last = RuntimeError("%s: %r" % (endpoint, doc["error"]))
                    break
                return doc["result"]
            except Exception as exc:  # noqa: BLE001 - endpoint rotation is the point
                last = exc
                time.sleep(1.0 + attempt)
    raise SystemExit("all Base RPC endpoints failed: %r" % (last,))


def audit(days: float = 1.0) -> list[dict]:
    latest = int(rpc("eth_blockNumber", []), 16)
    span = int(days * 43200)  # Base ~2s blocks
    logs = rpc(
        "eth_getLogs",
        [
            {
                "fromBlock": hex(latest - span),
                "toBlock": "latest",
                "address": USDC,
                "topics": [TRANSFER_TOPIC, "0x" + "0" * 24 + BUYER[2:].lower()],
            }
        ],
    )
    out = []
    for lg in logs:
        tx = lg["transactionHash"]
        receipt = rpc("eth_getTransactionReceipt", [tx])
        block = rpc("eth_getBlockByNumber", [receipt["blockNumber"], False])
        out.append(
            {
                "tx_hash": tx,
                "block": int(receipt["blockNumber"], 16),
                "tx_status": "success" if receipt["status"] == "0x1" else receipt["status"],
                "settled_at": datetime.fromtimestamp(int(block["timestamp"], 16), timezone.utc)
                .isoformat()
                .replace("+00:00", "Z"),
                "from": "0x" + lg["topics"][1][-40:],
                "to": "0x" + lg["topics"][2][-40:],
                "amount_usdc": int(lg["data"], 16) / 1e6,
                "facilitator_submitter": receipt["from"],
                "log_index": int(lg["logIndex"], 16),
            }
        )
    return sorted(out, key=lambda r: (r["settled_at"], r["log_index"]))


# ------------------------------------------------------------------------- subcommands
def cmd_append(args) -> int:
    path = args.file or default_path()
    raw = sys.stdin.read() if args.entry == "-" else args.entry
    entry = json.loads(raw)
    missing = [k for k in REQUIRED if k not in entry]
    if missing:
        raise SystemExit("refusing: entry is missing required field(s): %s" % ", ".join(missing))

    doc = load(path)
    problems = verify(doc)
    if problems:
        raise SystemExit("refusing: existing ledger fails verification, fix the chain first:\n  " + "\n  ".join(problems))
    if any(e.get("tx_hash") == entry["tx_hash"] for e in doc["entries"]):
        raise SystemExit("refusing: tx %s is already in the ledger (INSERT-only, no duplicates)" % entry["tx_hash"])

    prev = doc["entries"][-1]["entry_sha256"] if doc["entries"] else None
    entry["seq"] = len(doc["entries"]) + 1
    entry["recorded_at"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    entry["prev_entry_sha256"] = prev
    entry["entry_sha256"] = body_hash(entry, prev)
    doc["entries"].append(entry)
    save(path, doc)
    print("appended seq=%d tx=%s sha256=%s" % (entry["seq"], entry["tx_hash"], entry["entry_sha256"]))
    return 0


def cmd_verify(args) -> int:
    path = args.file or default_path()
    doc = load(path)
    problems = verify(doc)
    entries = doc.get("entries", [])
    total = sum(float(e.get("amount_usdc") or 0) for e in entries)
    if problems:
        print("LEDGER INTACT: NO")
        for p in problems:
            print("  FAIL", p)
        return 1
    print("LEDGER INTACT: YES  entries=%d  total_spend_usdc=%.6f  file=%s" % (len(entries), total, path))
    if entries:
        print("head=%s  tail=%s" % (entries[0]["entry_sha256"][:16], entries[-1]["entry_sha256"][:16]))
    return 0


def cmd_guard(args) -> int:
    """Fail-closed idempotency gate over the ledger.

    0 = clear to settle, 2 = this route was already settled inside the window,
    1 = the guard could not prove anything (missing/corrupt/unverifiable ledger).
    """
    route, window = args.route, args.window_days
    # `not (window >= 0)` rather than `window < 0` so NaN (a typo'd --window-days) is
    # refused too: NaN compared against a timestamp silently matches nothing, i.e. it
    # would read as "clear".
    if not (window >= 0):
        print("GUARD: BLOCKED route=%s reason=bad_window_days=%s" % (route, window))
        return 1

    if args.file:
        # load() synthesises an empty document for a missing path — fine for `append`,
        # fatal for a guard: an absent ledger would read as "nothing settled, go".
        if not os.path.exists(args.file):
            print("GUARD: BLOCKED route=%s reason=ledger_missing file=%s" % (route, args.file))
            print("  fail closed: the named ledger does not exist, so nothing can prove %s was not already settled." % route)
            return 1
        files = [args.file]
    else:
        files = ledger_files()
    if not files:
        print("GUARD: BLOCKED route=%s reason=no_ledger_files dir=%s" % (route, LEDGER_DIR))
        print("  fail closed: no cdp-settlement-*.json exists, so nothing can prove %s was not already settled." % route)
        print("  the only way past this is a deliberate, recorded bootstrap: python3 scripts/cdp_settlement_ledger.py init")
        return 1

    cutoff = time.time() - window * 86400.0
    broken: list[str] = []
    matches: list[tuple[str, dict]] = []
    scanned = 0

    for path in files:
        try:
            doc = load(path)
        except SystemExit as exc:  # load() hard-fails on a foreign schema
            broken.append("%s: %s" % (os.path.basename(path), exc))
            continue
        except (OSError, ValueError) as exc:
            broken.append("%s: unreadable (%s)" % (os.path.basename(path), exc))
            continue
        problems = verify(doc)
        if problems:
            broken.extend("%s: %s" % (os.path.basename(path), p) for p in problems)
            continue
        for entry in doc.get("entries", []):
            scanned += 1
            if (entry.get("endpoint") or {}).get("route") != route:
                continue
            ts = parse_settled_at(entry.get("settled_at"))
            # An entry we cannot date cannot be excluded from the window: fail closed.
            if ts is None or ts >= cutoff:
                matches.append((path, entry))

    if broken:
        print("GUARD: BLOCKED route=%s reason=ledger_untrustworthy files=%d" % (route, len(files)))
        for line in broken:
            print("  FAIL %s" % line)
        print("  fail closed: the ledger is the idempotency key, so a ledger that does not")
        print("  verify cannot prove anything. Repair the chain (never delete entries) first.")
        return 1

    if matches:
        matches.sort(key=lambda m: parse_settled_at(m[1].get("settled_at")) or 0.0, reverse=True)
        print("GUARD: BLOCKED route=%s window_days=%g matches=%d" % (route, window, len(matches)))
        for path, entry in matches:
            print(
                "  seq=%s settled_at=%s tx=%s usdc=%.6f ext=%s file=%s"
                % (
                    entry.get("seq", "?"),
                    entry.get("settled_at", "?"),
                    entry.get("tx_hash", "?"),
                    float(entry.get("amount_usdc") or 0),
                    entry.get("extension_status", "?"),
                    os.path.relpath(path, PROJECT),
                )
            )
        print("  this route is inside its re-listing window; it must not be settled again.")
        return 2

    print(
        "GUARD: CLEAR route=%s window_days=%g scanned=%d entries in %d ledger file(s)"
        % (route, window, scanned, len(files))
    )
    return 0


def cmd_init(args) -> int:
    """Create an empty day file. INSERT-only means init never touches an existing one."""
    path = args.file or default_path()
    if os.path.exists(path):
        print("refusing: %s already exists (init never modifies an existing ledger)" % path)
        return 1
    save(path, load(path))
    print("initialised empty ledger %s" % path)
    print("  verify: python3 scripts/cdp_settlement_ledger.py verify --file %s" % path)
    return 0


def cmd_show(args) -> int:
    path = args.file or default_path()
    doc = load(path)
    print("%-4s %-22s %-11s %-9s %-42s %s" % ("seq", "settled_at", "usdc", "block", "route", "index/relisting"))
    for e in doc.get("entries", []):
        rl = e.get("re_listing") or {}
        print(
            "%-4d %-22s %-11.4f %-9s %-42s %s"
            % (
                e.get("seq", 0),
                (e.get("settled_at") or "")[:19],
                float(e.get("amount_usdc") or 0),
                e.get("block", "?"),
                (e.get("endpoint") or {}).get("route", "?"),
                rl.get("verdict", "?"),
            )
        )
    print("total=%.6f USDC (all self-settlement: buyer->own payTo; not revenue)" % sum(
        float(e.get("amount_usdc") or 0) for e in doc.get("entries", [])
    ))
    return 0


def cmd_audit(args) -> int:
    rows = audit(days=args.days)
    print(json.dumps({"rpc": RPC_ENDPOINTS[0], "transfers": rows, "count": len(rows),
                      "total_usdc": round(sum(r["amount_usdc"] for r in rows), 6)}, indent=2))
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("append"); a.add_argument("--file"); a.add_argument("--entry", required=True); a.set_defaults(fn=cmd_append)
    v = sub.add_parser("verify"); v.add_argument("--file"); v.set_defaults(fn=cmd_verify)
    g = sub.add_parser("guard"); g.add_argument("--route", required=True); g.add_argument("--window-days", type=float, default=25.0); g.add_argument("--file"); g.set_defaults(fn=cmd_guard)
    n = sub.add_parser("init"); n.add_argument("--file"); n.set_defaults(fn=cmd_init)
    s = sub.add_parser("show"); s.add_argument("--file"); s.set_defaults(fn=cmd_show)
    au = sub.add_parser("audit"); au.add_argument("--days", type=float, default=1.0); au.set_defaults(fn=cmd_audit)
    args = ap.parse_args()
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
