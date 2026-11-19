#!/usr/bin/env python3
"""Google Search Console for the x402 Data API (api.greyridgesignals.ai), using the Grey Ridge service account.

This is the same literal-verdict instrument the ClaimFinder and HESI loops run, ported to the x402
product so it stops flying blind on Google. The 167 /research blog pages (buyer-intent content:
"is this x402 endpoint safe to pay", OFAC wallet screen, erc20 allowance, settlement proof) are the
x402 distribution engine, and until now nothing told us whether Google even knows they exist — every
x402 SEO sensor measures only Bing. Google is ~90% of search; this closes that blind spot.

x402 is a Cloudflare Worker, not a static site, so FILE verification is served by a Worker route that
echoes the token from the GSC_VERIFICATION_TOKEN var (public, non-secret). The sitemap is fetched over
HTTP from the live Worker (there is no local sitemap file).

  verify: gets the FILE verification token from Google and stashes it locally + prints it. You then put
          it in wrangler.toml [vars] GSC_VERIFICATION_TOKEN (the Worker route at /:token serves it),
          deploy, then run `claim`.
  claim:  completes verification and adds api.greyridgesignals.ai as a Search Console property (zero
          human step — the service account self-verifies via the token the Worker now serves).
  report: resubmits the sitemap (a real crawl/discovery signal) and saves indexed pages, clicks,
          impressions, top queries AND Google's literal per-URL coverageState to
          ~/.local/state/x402-gsc/search.json. The sensor publishes it so the loop reads Google's
          actual numbers. Run after each deploy; a failure is recorded there and shown as a sensor alert.

One-time bring-up (no human needed; CF_WORKERS_TOKEN deploys the Worker):
  python3 -I scripts/search_console.py verify     # -> prints GSC_VERIFICATION_TOKEN value
  # set that value in wrangler.toml [vars] + ensure the /:token route is deployed, then:
  bash scripts/deploy.sh                           # serves the token at api.greyridgesignals.ai/<token>
  python3 -I scripts/search_console.py claim       # Google fetches it, verifies, adds the property
  python3 -I scripts/search_console.py report      # submit sitemap + first Google indexation read
"""
import datetime as dt
import json
import logging
import os
import sys
import tempfile
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE_URL = os.environ.get("X402_BASE_URL", "https://api.greyridgesignals.ai")
SA_FILE = os.path.expanduser("~/.config/grsg/greyridge-worker-sa.json")
SCOPES = ["https://www.googleapis.com/auth/siteverification", "https://www.googleapis.com/auth/webmasters"]
PROPERTY = SITE_URL + "/"
ENC = urllib.parse.quote(PROPERTY, safe="")
GSC = "https://www.googleapis.com/webmasters/v3/sites/" + ENC
INSPECT = "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect"
INSPECT_LIMIT = 15        # URL Inspection quota is 2000/day; we sample the highest-intent pages
INSPECT_STALE_HOURS = 18  # re-inspect at most ~once/day so frequent redeploys stay fast
SMALL_SITE_PAGES = 100    # below this a site has no crawl-budget ceiling (Google's own guidance)
SITEMAP_URL = SITE_URL + "/sitemap.xml"


# ---- self-contained plumbing (no sensor import) --------------------------------------------------
def setup_logging(name):
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s",
                        stream=sys.stdout, force=True)
    return logging.getLogger(name)


log = setup_logging("search_console")


def utcnow():
    return dt.datetime.now(dt.timezone.utc)


def iso(t=None):
    return (t or utcnow()).astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def state_dir():
    d = Path(os.environ.get("X402_GSC_STATE_DIR") or Path.home() / ".local" / "state" / "x402-gsc")
    d.mkdir(parents=True, exist_ok=True)
    return d


def read_json(path, default=None):
    try:
        return json.loads(Path(path).read_text())
    except FileNotFoundError:
        return default
    except Exception as e:  # noqa: BLE001
        log.error("could not read %s: %s: %s", path, type(e).__name__, e)
        return default


def atomic_write_json(path, obj):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix="." + path.name + ".", suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(obj, f, indent=2, sort_keys=True, default=str)
            f.write("\n")
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    finally:
        with __import__("contextlib").suppress(OSError):
            os.unlink(tmp)


# ---- Google API ---------------------------------------------------------------------------------
def session():
    from google.auth.transport.requests import AuthorizedSession
    from google.oauth2 import service_account
    return AuthorizedSession(service_account.Credentials.from_service_account_file(SA_FILE, scopes=SCOPES))


def _ok(r, what):
    if not r.ok:
        raise RuntimeError(f"{what}: HTTP {r.status_code}: {r.text[:300]}")
    return r.json() if r.content else {}


def verify(s):
    """Get a FILE verification token. The Worker serves it via the GSC_VERIFICATION_TOKEN var; we only
    stash + print it here (a Worker has no local site/ dir to drop a file into)."""
    site = {"type": "SITE", "identifier": PROPERTY}
    token = _ok(s.post("https://www.googleapis.com/siteVerification/v1/token",
                       json={"site": site, "verificationMethod": "FILE"}, timeout=40), "token")["token"]
    (state_dir() / "token.txt").write_text(token)
    return token


def claim(s):
    site = {"type": "SITE", "identifier": PROPERTY}
    got = _ok(s.post("https://www.googleapis.com/siteVerification/v1/webResource?verificationMethod=FILE",
                     json={"site": site}, timeout=60), "verify")
    _ok(s.put(GSC, timeout=40), "add property")
    return got.get("id")


def _fetch_sitemap():
    """Fetch the live Worker sitemap over HTTP (x402 generates it dynamically; no local file)."""
    req = urllib.request.Request(SITEMAP_URL, headers={"User-Agent": "grsg-gsc/1.0"})
    with urllib.request.urlopen(req, timeout=40) as r:  # noqa: S310 — our own origin
        return r.read().decode("utf-8", "replace")


def _sitemap_urls(limit=INSPECT_LIMIT):
    """Highest-intent URLs DERIVED from the live sitemap by <priority> desc — not a hardcoded list,
    so it tracks reality and degrades open (falls back to the homepage if the fetch fails)."""
    import xml.etree.ElementTree as ET
    try:
        xml = _fetch_sitemap()
    except Exception as e:  # noqa: BLE001
        log.error("sitemap fetch failed: %s", e)
        return [PROPERTY]
    ns = "{http://www.sitemaps.org/schemas/sitemap/0.9}"
    items = []
    for u in ET.fromstring(xml).findall(f"{ns}url"):
        loc = u.findtext(f"{ns}loc")
        if loc:
            try:
                pri = float(u.findtext(f"{ns}priority") or 0.5)
            except ValueError:
                pri = 0.5
            items.append((pri, loc))
    items.sort(key=lambda x: -x[0])
    return [loc for _, loc in items[:limit]] or [PROPERTY]


def _site_total():
    try:
        import xml.etree.ElementTree as ET
        xml = _fetch_sitemap()
        ns = "{http://www.sitemaps.org/schemas/sitemap/0.9}"
        return len(ET.fromstring(xml).findall(f"{ns}url")) or None
    except Exception:  # noqa: BLE001
        return None


def _diagnose(buckets, site_total=None):
    """Map the DOMINANT coverageState to the fix family — Google's literal per-URL reason, not a guess."""
    if not buckets:
        return "no data"
    dom = max(buckets, key=buckets.get)
    d = dom.lower()
    if any(w in d for w in ("excluded", "noindex", "canonical", "redirect", "alternate", "blocked")):
        return f"BUG: '{dom}' dominates — a canonical/noindex/redirect/robots config error. Fix the config now; links and content do NOT help this."
    if "crawled" in d and "not indexed" in d:
        return f"QUALITY: '{dom}' dominates — Google crawled but judged the pages thin/duplicate. MORE pages won't help; consolidate or earn authority."
    if "discovered" in d and "not indexed" in d:
        if site_total is not None and site_total < SMALL_SITE_PAGES:
            return (f"QUALITY/NEWNESS: '{dom}' dominates on a small site ({site_total} pages, no crawl-budget ceiling) — "
                    "Google withholds crawl on a predictive-quality/newness judgment. Thicken per-page content "
                    "(unique facts, not boilerplate) and earn referring domains; do NOT trim the sitemap or add thin pages.")
        return f"AUTHORITY: '{dom}' dominates on a large site ({site_total} pages) — a crawl-budget/authority gate. Concentrate internal links, prune low-value URLs, earn referring domains."
    if "unknown" in d:
        return (f"DISCOVERY: '{dom}' dominates — Google has NO record of these URLs (never discovered, not merely un-crawled). "
                "Submit the sitemap to Search Console and earn at least one crawlable link so Googlebot finds them; then wait "
                "for the first crawl. Content/quality levers do nothing until discovery happens.")
    if "indexed" in d:
        return f"OK: '{dom}' dominates — pages are indexed. The lever is now ranking (depth/links), not indexation."
    return f"REVIEW: dominant state '{dom}'"


def inspect(s, urls=None, limit=INSPECT_LIMIT):
    """Google's literal per-URL index verdict via index:inspect. Degrades open: one URL never aborts the batch."""
    urls = urls or _sitemap_urls(limit)
    pages = []
    for u in urls:
        try:
            idx = _ok(s.post(INSPECT, json={"inspectionUrl": u, "siteUrl": PROPERTY}, timeout=60), "inspect") \
                .get("inspectionResult", {}).get("indexStatusResult", {})
            pages.append(dict(url=u, coverage=idx.get("coverageState"), verdict=idx.get("verdict"),
                              robots=idx.get("robotsTxtState"), indexing=idx.get("indexingState"),
                              last_crawl=idx.get("lastCrawlTime"),
                              google_canonical=idx.get("googleCanonical"), user_canonical=idx.get("userCanonical")))
        except Exception as e:  # noqa: BLE001 — never let one URL abort the batch or the deploy
            log.error("inspect %s failed: %s", u, e)
            pages.append(dict(url=u, error=f"{type(e).__name__}: {e}"[:200]))
    return dict(at=iso(), **_rollup(pages, _site_total()))


def _rollup(pages, site_total=None):
    buckets = {}
    for p in pages:
        k = p.get("coverage") or ("ERROR" if p.get("error") else "UNKNOWN")
        buckets[k] = buckets.get(k, 0) + 1
    indexed = sum(n for st, n in buckets.items() if "indexed" in st.lower() and "not indexed" not in st.lower())
    discovered_not_indexed = sum(n for st, n in buckets.items() if "discovered" in st.lower() and "not indexed" in st.lower())
    return dict(checked=len(pages), indexed=indexed, discovered_not_indexed=discovered_not_indexed,
                buckets=buckets, diagnosis=_diagnose(buckets, site_total), pages=pages, site_total=site_total)


def _inspection_fresh(prev, now=None):
    at = (prev or {}).get("inspection", {}).get("at")
    if not at:
        return False
    try:
        age = (now or utcnow()) - dt.datetime.fromisoformat(at.replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return False
    return age.total_seconds() < INSPECT_STALE_HOURS * 3600


def report(s, today=None, inspection=None):
    today = today or dt.date.today()
    sm = SITEMAP_URL
    sm_url = f"{GSC}/sitemaps/{urllib.parse.quote(sm, safe='')}"
    _ok(s.put(sm_url, timeout=40), "submit sitemap")
    info = _ok(s.get(sm_url, timeout=40), "read sitemap")
    content = (info.get("contents") or [{}])[0]
    body = {"startDate": (today - dt.timedelta(days=28)).isoformat(), "endDate": today.isoformat(),
            "rowLimit": 25, "dimensions": ["query"]}
    rows = _ok(s.post(f"{GSC}/searchAnalytics/query", json=body, timeout=60), "search analytics").get("rows", [])
    out = dict(submitted=int(content.get("submitted", 0) or 0), indexed=int(content.get("indexed", 0) or 0),
               last_read=info.get("lastDownloaded"),
               clicks=sum(int(r["clicks"]) for r in rows), impressions=sum(int(r["impressions"]) for r in rows),
               top_queries=[dict(q=r["keys"][0], clicks=int(r["clicks"]), impressions=int(r["impressions"]),
                                 position=round(r["position"], 1)) for r in rows[:10]])
    if inspection is not None:
        out["inspection"] = inspection
    return out


def save_report(s=None, today=None, now=None):
    """Never raises: search reporting must not fail a deploy. Errors land in the file the sensor reads."""
    prev = read_json(state_dir() / "search.json", {}) or {}
    try:
        s = s or session()
        if _inspection_fresh(prev, now):
            insp = prev.get("inspection")
            if isinstance(insp, dict) and insp.get("buckets"):
                st = _site_total()
                insp = dict(insp, site_total=st, diagnosis=_diagnose(insp["buckets"], st))
        else:
            insp = inspect(s)
        out = dict(ok=True, **report(s, today, inspection=insp))
    except Exception as e:  # noqa: BLE001
        log.error("search console report failed: %s: %s", type(e).__name__, e)
        out = dict(ok=False, error=f"{type(e).__name__}: {e}"[:400])
        if prev.get("inspection"):
            out["inspection"] = prev["inspection"]
    out["at"] = iso(now)
    atomic_write_json(state_dir() / "search.json", out)
    return out


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "report"
    if cmd == "verify":
        tok = verify(session())
        print("GSC_VERIFICATION_TOKEN=" + tok)
        print("# put that value in wrangler.toml [vars], ensure the /:token route serves it, deploy, then run claim")
    elif cmd == "claim":
        print("verified", claim(session()))
    elif cmd == "inspect":
        res = inspect(session())
        print(res["diagnosis"])
        print(json.dumps(dict(checked=res["checked"], buckets=res["buckets"]), indent=2))
        for p in res["pages"]:
            print(f"  {p.get('coverage') or p.get('error')}  <-  {p['url']}")
    else:
        print(json.dumps(save_report(), indent=2, default=str))
