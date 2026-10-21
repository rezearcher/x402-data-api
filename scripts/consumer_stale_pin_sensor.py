#!/usr/bin/env python3
"""
consumer_stale_pin_sensor.py — Find external repos that CONSUME our API but pin a
skill/catalog revision that still curls the 403-ing custom domain, so each one is
a ready wire-PR target (the proven conversion path: Haven, ArbiVault, hermes-agent,
nastech-agent all started as code-search hits we wired).

WHY (measured, recurring): agent frameworks list our token-safety skill in a
plugin-catalog yaml that PINS an exact commit sha (their loader detaches at that
commit, not HEAD). The old pins (e.g. d3586eb) have the skill curl
`api.greyridgesignals.ai`, which Cloudflare bot-challenges to HTTP 403 from the
datacenter ASNs where hosted agents actually run -> the safety check silently
fails -> no conversion. The fixed skill HEAD (3a7848e+) curls
`x402-data-api.sigrunner.workers.dev` (200 from any ASN). Found in 2 catalogs so
far (hermes-agent c44 PR #142479, nastech-agent c46 PR #164). This sensor finds
the rest automatically instead of us re-discovering them by hand each cycle.

SIGNAL (ground-truth, no hardcoded roster): discover consumers at RUNTIME via
`gh search code` for our custom domain and the known-broken pin, then for each
hit classify:
  - STALE_PIN  -> file still references `api.greyridgesignals.ai` (403 risk) = wire-PR target
  - FIXED      -> references workers.dev only
  - SELF       -> owned by us (rezearcher / greyridge*) = skip
  - DATA       -> census/dataset/analytics mention, not a live consumer = skip
A repo is a wire-PR TARGET iff it is a non-self, non-data consumer whose
referencing file still names the custom domain.

OUTPUT: ~/.hermes/data/x402_consumers/stale_pins.json
  { generated_at, queries, consumers:[{repo, path, klass, pushed_at, stars}],
    targets:[...STALE_PIN non-self...], n_consumers, n_targets, alert }
alert=True when n_targets >= 1 (a fresh wire-PR is available this cycle).

0 self-pay, read-only (gh search + contents API). Exit 0 always (sensor).
Usage: python3 -I scripts/consumer_stale_pin_sensor.py
Requires: gh CLI authenticated (uses `gh auth token`).
"""
import json
import os
import subprocess
import datetime
import pathlib

CUSTOM_DOMAIN = "api.greyridgesignals.ai"
WORKER_HOST = "x402-data-api.sigrunner.workers.dev"
# Known-broken pin(s): the custom-domain-era skill commits. Extend as discovered;
# lives in data (editable) not as a decision gate -- degrades open if empty.
STALE_PINS = ["d3586eb2488f14a69a41a394ab185d24bdab273d"]
# Queries that surface consumers (not the string we ourselves publish everywhere).
QUERIES = [CUSTOM_DOMAIN] + [p[:16] for p in STALE_PINS]

OUT_DIR = pathlib.Path(os.path.expanduser("~/.hermes/data/x402_consumers"))
OUT = OUT_DIR / "stale_pins.json"


def gh_json(args, default):
    try:
        r = subprocess.run(["gh"] + args, capture_output=True, text=True, timeout=60)
        if r.returncode != 0 or not r.stdout.strip():
            return default
        return json.loads(r.stdout)
    except Exception:
        return default


def is_self(repo):
    r = repo.lower()
    return r.startswith("rezearcher/") or "greyridge" in r


# GROUND-TRUTH PROBE (measured, not assumed): a stale-pinned skill only hurts
# conversion if the custom domain it curls *actually* fails to serve. Earlier
# cycles assumed `api.greyridgesignals.ai` 403s from datacenter ASNs ("proved on
# GH Actions runners"), but on 2026-10-21 it returned HTTP 200 + full JSON from
# two independent datacenter vantages (this host + the web-fetch agent). So we
# probe it live each run instead of hard-coding "custom domain == broken". If it
# serves, a pinned-old-sha manifest is NOT a conversion killer -> not a wire-PR
# target. Degrades OPEN: if the probe cannot run (network error), assume broken
# so we don't silently drop a genuine target.
import urllib.request  # noqa: E402

PROBE_URL = "https://" + CUSTOM_DOMAIN + "/gate/swap/preview?token=degen"


def custom_domain_serves():
    """Return (serves_ok: bool, status: str). serves_ok=True iff the custom
    domain returns 200 with a JSON verdict body (i.e. agents on it convert)."""
    try:
        req = urllib.request.Request(PROBE_URL, headers={"User-Agent": "curl/8"})
        with urllib.request.urlopen(req, timeout=20) as resp:
            code = resp.getcode()
            body = resp.read(400).decode("utf-8", "replace")
            ok = code == 200 and ('"verdict"' in body or '"decision"' in body)
            return ok, f"HTTP {code}"
    except urllib.error.HTTPError as e:  # 403/5xx = genuinely broken for agents
        return False, f"HTTP {e.code}"
    except Exception as e:  # network/probe failure -> degrade open (assume broken)
        return False, f"probe-error:{type(e).__name__}"


# A genuine wire-PR target is a repo whose agent is TOLD to call our API by a
# plugin/skill manifest -- not a repo that merely records our receiving address
# as on-chain analytics. The ground-truth distinction is the referencing file's
# role: a manifest/skill instructs a curl; a receiver/subgraph/census just lists
# an address. Detected from path shape + fragment, no per-repo roster.
MANIFEST_HINTS = ("catalog", "plugin", "skill", "skills/", ".yaml", ".yml",
                  "manifest", "tools/", "action", "eliza")
ANALYTICS_HINTS = ("subgraph", "receivers", "census", "dataset", "/data/",
                   "snapshot", "observ", "payto", "recipients", "index.json")
ANALYTICS_FRAG = ("summedendpointpayers", "calls30d", "census", "payers30d",
                  "endpoints\":", "summedendpoint")


def classify(repo, path, fragment):
    """Return (klass, note). Signal = the referencing file's ROLE, not a roster."""
    if is_self(repo):
        return "SELF", "owned by us"
    p = (path or "").lower()
    frag = (fragment or "").lower()
    is_manifest = any(k in p for k in MANIFEST_HINTS)
    is_analytics = any(k in p for k in ANALYTICS_HINTS) or any(k in frag for k in ANALYTICS_FRAG)
    # analytics/address-index that isn't also a manifest = not a live consumer
    if is_analytics and not is_manifest:
        return "DATA", "receiver/analytics index, not a skill consumer"
    host_broken = CUSTOM_DOMAIN in frag or any(sp[:12] in frag for sp in STALE_PINS)
    host_fixed = WORKER_HOST in frag
    if is_manifest and host_broken:
        return "STALE_PIN", "consumer manifest still names 403-ing custom domain / broken pin"
    if is_manifest and host_fixed:
        return "FIXED", "consumer manifest references workers.dev"
    if is_manifest:
        return "UNKNOWN", "consumer manifest, host not visible in fragment"
    # not a manifest, not clearly analytics -> can't confirm it's a wire-PR target
    return "DATA", "non-manifest reference, not a skill consumer"


def has_open_rez_pr(repo):
    """True if we already have an OPEN PR on this repo (don't re-flag in-flight)."""
    prs = gh_json(["pr", "list", "--repo", repo, "--state", "open",
                   "--author", "rezearcher", "--json", "number"], [])
    return bool(prs)


def repo_meta(repo):
    d = gh_json(["repo", "view", repo, "--json", "pushedAt,stargazerCount"], {})
    return d.get("pushedAt"), d.get("stargazerCount")


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    # Measure the real signal ONCE: does the custom domain actually serve agents?
    domain_ok, domain_status = custom_domain_serves()
    seen = {}  # (repo,path) -> record
    for q in QUERIES:
        hits = gh_json(["search", "code", q, "--limit", "40", "--json",
                        "repository,path,textMatches"], [])
        for h in hits:
            repo = h.get("repository", {}).get("nameWithOwner", "")
            path = h.get("path", "")
            frag = " ".join(tm.get("fragment", "") for tm in h.get("textMatches", []))
            key = (repo, path)
            if key in seen:
                continue
            klass, note = classify(repo, path, frag)
            seen[key] = {"repo": repo, "path": path, "klass": klass, "note": note}

    # enrich non-self/non-data with repo meta (freshness, stars)
    for rec in seen.values():
        if rec["klass"] in ("STALE_PIN", "UNKNOWN", "FIXED"):
            rec["pushed_at"], rec["stars"] = repo_meta(rec["repo"])

    consumers = sorted(seen.values(), key=lambda r: (r["klass"], r["repo"]))
    # targets = broken consumer manifests with NO open wire-PR from us yet (net-new)
    # BUT only if the custom domain genuinely fails to serve (measured, not assumed).
    # If the domain serves 200, a pinned-old-sha skill still converts -> no target.
    targets = []
    for c in consumers:
        if c["klass"] != "STALE_PIN":
            continue
        if domain_ok:
            # ground truth says the pinned skill's domain works -> not a killer
            c["klass"] = "STALE_PIN_BUT_DOMAIN_OK"
            c["note"] = (f"pins old sha but custom domain serves {domain_status} "
                         "from datacenter vantages -> skill still converts, not a "
                         "wire-PR priority (cosmetic sha-bump only)")
            continue
        c["pr_open"] = has_open_rez_pr(c["repo"])
        if not c["pr_open"]:
            targets.append(c)

    out = {
        "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "queries": QUERIES,
        "custom_domain_serves": domain_ok,
        "custom_domain_status": domain_status,
        "consumers": consumers,
        "targets": targets,
        "n_consumers": len(consumers),
        "n_stale": sum(1 for c in consumers if str(c["klass"]).startswith("STALE_PIN")),
        "n_targets": len(targets),
        "alert": len(targets) >= 1,
        "note": "targets = non-self consumer manifests still naming the custom "
                "domain AND measured to FAIL (non-200) AND with no open rezearcher "
                "wire-PR. If custom_domain_serves=true the pinned skill still "
                "converts, so stale pins are cosmetic (not a conversion killer).",
    }
    OUT.write_text(json.dumps(out, indent=2))
    print(f"custom_domain_serves={domain_ok} ({domain_status}) | "
          f"consumers={len(consumers)} targets={len(targets)} alert={out['alert']} -> {OUT}")
    for t in targets:
        print(f"  WIRE-PR TARGET: {t['repo']}  ({t['path']}) stars={t.get('stars')} pushed={t.get('pushed_at')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
