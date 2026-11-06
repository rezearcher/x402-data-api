#!/usr/bin/env python3
"""Leading-sensor: is our skill discoverable on skills.sh for the queries that
describe what a FUNDED agent is about to do?

Revenue on x402-data-api is gated by DISCOVERY in a pre-demand market. skills.sh
(the Vercel/Algolia skill registry behind `npx skills`) is the channel that sits
in front of funded AgentKit/Coinbase wallets. An agent that holds a wallet and is
about to spend searches it with intent phrases ("safe to pay", "funding rates").
Ranking is semantic relevance + install count, and we cannot out-install OKX or
Alchemy on commodity terms — but the SECURITY/verify lane is uncontested, and the
DATA lane has clear per-route query intent. This sensor records, for each target
query, whether a grey-ridge/rezearcher skill surfaces and at what rank, plus the
live install counts, so a stateless cycle can read whether a description change
actually moved discoverability (the leading metric BEFORE a payer arrives) instead
of only reading total_external_usdc (locked under open experiments).

Degrades open: a query that errors is recorded rank=None, never crashes.
Writes a dated snapshot to data/skills_index.jsonl and a flat mirror to
~/.hermes/data/skills_index/latest.json for the improvement ledger.
Keyless; no account. Usage: python3 -I scripts/skills_index_sensor.py
"""
import datetime
import json
import pathlib
import sys
import urllib.parse
import urllib.request

API = "https://skills.sh/api/search"
# Substring that identifies a skill we own in the API `id` field (owner/repo/skillId).
OURS = "rezearcher"
OUT = pathlib.Path(__file__).resolve().parent.parent / "data" / "skills_index.jsonl"
LATEST = pathlib.Path.home() / ".hermes" / "data" / "skills_index" / "latest.json"

# High-intent, low-competition queries that map to what we actually ship.
# Security (our uncontested moat) first, then the proven DATA earners.
QUERIES = [
    "x402 verify payment",
    "safe to pay x402",
    "sanctions screen wallet",
    "scam drainer wallet check",
    "prompt injection x402",
    "x402 settlement proof",
    "defi yields",
    "funding rates",
    "funding rate arbitrage",
    "token prices",
]
TOP_N = 10  # a rank outside the first page is effectively invisible


def _get(url: str, timeout: int = 20):
    req = urllib.request.Request(url, headers={"user-agent": "skills-index-sensor"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def probe(query: str) -> dict:
    try:
        url = API + "?" + urllib.parse.urlencode({"q": query})
        skills = _get(url).get("skills", [])
        rank = None
        skill_id = None
        for i, it in enumerate(skills):
            if OURS in (str(it.get("id", "")) + str(it.get("source", ""))):
                rank = i
                skill_id = it.get("id")
                break
        return {
            "query": query,
            "rank": rank,  # 0-based index in results; None = absent
            "on_first_page": rank is not None and rank < TOP_N,
            "skill_id": skill_id,
            "n_results": len(skills),
        }
    except Exception as e:  # noqa: BLE001 - degrade open
        return {"query": query, "rank": None, "on_first_page": None, "error": str(e)[:120]}


def our_installs() -> dict:
    """Best-effort total install count across our indexed skills."""
    seen = {}
    try:
        for q in ("x402", "defi data", "verify payment"):
            url = API + "?" + urllib.parse.urlencode({"q": q})
            for it in _get(url).get("skills", []):
                sid = str(it.get("id", ""))
                if OURS in sid:
                    seen[sid] = it.get("installs") or 0
    except Exception as e:  # noqa: BLE001 - degrade open
        return {"total": None, "error": str(e)[:120]}
    return {"total": sum(seen.values()), "by_skill": seen}


def main() -> int:
    probes = [probe(q) for q in QUERIES]
    installs = our_installs()
    surfaced = sum(1 for p in probes if p.get("on_first_page"))
    snap = {
        "ts": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "queries_total": len(QUERIES),
        "surfaced_first_page": surfaced,
        "installs": installs,
        "probes": probes,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("a") as f:
        f.write(json.dumps(snap) + "\n")
    latest = {
        "ts": snap["ts"],
        "surfaced_first_page": surfaced,
        "queries_total": len(QUERIES),
        "total_installs": installs.get("total") if isinstance(installs.get("total"), int) else 0,
    }
    LATEST.parent.mkdir(parents=True, exist_ok=True)
    LATEST.write_text(json.dumps(latest, indent=2))
    print(json.dumps(snap, indent=2))
    # Fail only if the registry itself was unreachable for every query (real outage).
    all_err = all("error" in p for p in probes)
    return 1 if all_err else 0


if __name__ == "__main__":
    sys.exit(main())
