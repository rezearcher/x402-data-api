#!/usr/bin/env python3
"""Offline regression for the MCP scorecard maintenance + supply-chain drift grade —
the continuous-risk dimension that beats the one-shot competitors (Glama has no
maintenance grade; Snyk/mcp-scan is one-shot). Pins the pure grading helpers and the
degrade-open contract: any missing repo/packages/API read yields UNKNOWN (neutral),
never a fabricated F. Also pins that the rendered page carries the section + the
$9.99/mo monitoring hook (the B3 recurring-value tie).

Run: python3 scripts/test_scorecard_maintenance_supplychain.py
"""
import datetime
import importlib.util
import sys

spec = importlib.util.spec_from_file_location("gmc", "scripts/gen_mcp_scorecards.py")
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

FAILS = []
NOW = datetime.datetime(2026, 10, 27, tzinfo=datetime.timezone.utc)


def check(name, cond, msg):
    if not cond:
        FAILS.append(f"[{name}] {msg}")


def _repo(pushed_days_ago=None, archived=False, disabled=False, oi=0):
    d = {"archived": archived, "disabled": disabled, "open_issues_count": oi}
    if pushed_days_ago is not None:
        d["pushed_at"] = (NOW - datetime.timedelta(days=pushed_days_ago)).isoformat().replace("+00:00", "Z")
    return d


# --- parse_github_repo_url ---------------------------------------------------
check("gh-plain", m.parse_github_repo_url("https://github.com/modelcontextprotocol/servers")
      == ("modelcontextprotocol", "servers"), "plain github url must parse")
check("gh-git", m.parse_github_repo_url("https://github.com/owner/repo.git")
      == ("owner", "repo"), ".git suffix must be stripped")
check("gh-extra", m.parse_github_repo_url("https://github.com/owner/repo/tree/main")
      == ("owner", "repo"), "extra path segments must be ignored")
check("gh-nongithub", m.parse_github_repo_url("https://gitlab.com/owner/repo") is None,
      "non-github host must return None")
check("gh-none", m.parse_github_repo_url(None) is None, "None url must return None")
check("gh-short", m.parse_github_repo_url("https://github.com/owner") is None,
      "owner-only url must return None")

# --- maintenance_bucket ------------------------------------------------------
check("maint-none", m.maintenance_bucket(None, NOW)["grade"] is None,
      "no repo meta must be UNKNOWN (grade None), never a false F")
check("maint-none-bucket", m.maintenance_bucket(None, NOW)["bucket"] == "UNKNOWN",
      "no repo meta bucket must be UNKNOWN")
check("maint-archived", m.maintenance_bucket(_repo(pushed_days_ago=5, archived=True), NOW)["grade"] == "F",
      "archived repo must be F regardless of recent push")
check("maint-disabled", m.maintenance_bucket(_repo(pushed_days_ago=5, disabled=True), NOW)["bucket"] == "ABANDONED",
      "disabled repo must be ABANDONED")
check("maint-fresh", m.maintenance_bucket(_repo(pushed_days_ago=10), NOW)["grade"] == "A",
      "<30d push must be A (fresh)")
check("maint-active", m.maintenance_bucket(_repo(pushed_days_ago=90), NOW)["grade"] == "B",
      "30-180d push must be B (active)")
check("maint-slowing", m.maintenance_bucket(_repo(pushed_days_ago=270), NOW)["grade"] == "C",
      "180-365d push must be C (slowing)")
check("maint-stale", m.maintenance_bucket(_repo(pushed_days_ago=500), NOW)["grade"] == "D",
      ">365d push must be D (stale)")
check("maint-nopush", m.maintenance_bucket({"archived": False}, NOW)["grade"] is None,
      "repo meta with no pushed_at must be UNKNOWN, never a false grade")
check("maint-oi", "open issue" in m.maintenance_bucket(_repo(pushed_days_ago=10, oi=42), NOW)["reason"],
      "open-issue count should enrich the maintenance reason when present")

# --- supplychain_grade -------------------------------------------------------
check("sc-nopkg", m.supplychain_grade([], [], had_packages=False)["grade"] is None,
      "no declared packages must be UNKNOWN (grade None)")
check("sc-nopkg-level", m.supplychain_grade([], [], had_packages=False)["level"] == "UNKNOWN",
      "no declared packages level must be UNKNOWN")
check("sc-clean", m.supplychain_grade([], [], had_packages=True)["grade"] == "A",
      "0 advisories + not deprecated must be clean (A)")
check("sc-one", m.supplychain_grade(["GHSA-xxx"], [], had_packages=True)["grade"] == "C",
      "1 advisory must be CAUTION (C)")
check("sc-two", m.supplychain_grade(["GHSA-a", "GHSA-b"], [], had_packages=True)["level"] == "CAUTION",
      "2 advisories must be CAUTION")
check("sc-three", m.supplychain_grade(["a", "b", "c"], [], had_packages=True)["grade"] == "D",
      "3+ advisories must be HIGH (D)")
check("sc-dedup", m.supplychain_grade(["GHSA-a", "GHSA-a", "GHSA-a"], [], had_packages=True)["grade"] == "C",
      "duplicate advisory IDs must dedup to one -> CAUTION not HIGH")
check("sc-deprecated", m.supplychain_grade([], ["left-pad"], had_packages=True)["grade"] == "C",
      "a deprecated latest release alone must be CAUTION")

# --- _osv_ecosystem ----------------------------------------------------------
check("osv-npm", m._osv_ecosystem("npm") == "npm", "npm must map to OSV npm")
check("osv-pypi", m._osv_ecosystem("pypi") == "PyPI", "pypi must map to OSV PyPI")
check("osv-unknown", m._osv_ecosystem("oci") is None, "unindexed ecosystem must map to None (skipped)")

# --- maintenance_section render (degrade-open + the $9.99 recurring hook) -----
sec_unknown = m.maintenance_section("DeepWiki", "mcp.deepwiki.com", None, None)
check("sec-unknown-maint", "not measurable" in sec_unknown,
      "UNKNOWN maintenance must read 'not measurable', never a pass")
check("sec-hook", "$9.99/mo" in sec_unknown and "/pricing" in sec_unknown,
      "section must tie to the $9.99/mo monitoring subscription (the B3 recurring value)")
check("sec-noF", "grade `F`" not in sec_unknown,
      "UNKNOWN inputs must never render an F grade")

sec_bad = m.maintenance_section(
    "Acme", "acme.example",
    {"bucket": "stale", "grade": "D", "reason": "last commit pushed 500 day(s) ago"},
    {"level": "HIGH", "grade": "D", "vuln_ids": ["GHSA-1", "GHSA-2", "GHSA-3"],
     "deprecated": [], "advisory_count": 3})
check("sec-maint-D", "Maintenance grade `D`" in sec_bad, "stale maintenance must render grade D")
check("sec-supply-D", "Supply chain grade `D`" in sec_bad, "HIGH supply chain must render grade D")
check("sec-ids", "GHSA-1" in sec_bad, "advisory IDs must be shown")

# --- full render carries the section ----------------------------------------
body, _ = m.render(
    "DeepWiki", "deepwiki", "https://mcp.deepwiki.com/mcp", "vendor",
    {"verdict": "clear", "tools_scanned": 3, "issue_count": 0,
     "directory_readiness": {"ready": True, "blocker_count": 0,
                             "hard_blockers": 0, "soft_blockers": 0, "status": "ready"},
     "_tools": [{"name": "ask", "description": "Ask a question about a repo wiki page."}],
     "_instructions": "",
     "_maintenance": {"bucket": "fresh", "grade": "A", "reason": "last commit pushed 3 day(s) ago"},
     "_supplychain": {"level": "clean", "grade": "A", "vuln_ids": [], "deprecated": [], "advisory_count": 0}},
    "2026-10-27")
check("render-section", "Maintenance & supply-chain" in body,
      "rendered page must carry the maintenance & supply-chain section")
check("render-maint-A", "Maintenance grade `A`" in body, "rendered page must show the measured maintenance grade")

if FAILS:
    print("FAIL:")
    for f in FAILS:
        print("  " + f)
    sys.exit(1)
print("OK: maintenance + supply-chain drift grade (33 assertions)")
