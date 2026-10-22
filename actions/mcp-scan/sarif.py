#!/usr/bin/env python3
"""Convert a Grey Ridge /scan/mcp/preview response into SARIF 2.1.0.

Reads the preview JSON from the SCAN_JSON env var and the scanned target from
SARIF_TARGET, writes a SARIF document to stdout. The free preview exposes only
per-severity counts and the verdict (itemized findings are the paid scan), so we
emit one aggregate result per non-empty severity bucket. A clean verdict emits an
empty results array, which clears any prior code-scanning alerts for this tool.
"""
import json
import os
import hashlib

d = json.loads(os.environ["SCAN_JSON"])
target = os.environ.get("SARIF_TARGET", "mcp-server")
verdict = d.get("verdict", "error")
risk = d.get("risk_score", -1)
sev = d.get("severity_breakdown", {}) or {}
upsell = d.get("upsell", "")
lvl = {"critical": "error", "high": "error", "medium": "warning", "low": "note"}

results = []
for s in ("critical", "high", "medium", "low"):
    n = int(sev.get(s, 0) or 0)
    if n <= 0:
        continue
    fp = hashlib.sha256(f"{target}|{s}".encode()).hexdigest()[:16]
    results.append({
        "ruleId": "greyridge-mcp-tool-poisoning",
        "level": lvl[s],
        "message": {"text": (
            f"MCP server '{target}': {n} {s}-severity tool-poisoning / prompt-injection "
            f"finding(s). Verdict={verdict}, risk {risk}/100. Itemized findings with evidence "
            f"and OWASP LLM01/LLM08 mapping: paid scan $0.05 USDC on Base; continuous drift "
            f"monitoring $9.99/mo. {upsell}")},
        "partialFingerprints": {"greyridge/v1": fp},
        "locations": [{"physicalLocation": {
            "artifactLocation": {"uri": "mcp-server-scan"},
            "region": {"startLine": 1}}}],
    })

sarif = {
    "$schema": "https://json.schemastore.org/sarif-2.1.0.json",
    "version": "2.1.0",
    "runs": [{
        "tool": {"driver": {
            "name": "Grey Ridge MCP Scan",
            "informationUri": "https://github.com/rezearcher/x402-data-api/tree/main/actions/mcp-scan",
            "version": "1.0.0",
            "rules": [{
                "id": "greyridge-mcp-tool-poisoning",
                "name": "McpToolPoisoning",
                "shortDescription": {"text": "MCP tool-poisoning / prompt-injection in advertised tool metadata"},
                "fullDescription": {"text": "Static scan of an MCP server's advertised tools (tools/list) for prompt-injection and tool-poisoning patterns (OWASP LLM01/LLM08), hidden-unicode, ANSI terminal escapes and CSS passive resource-fetch exfiltration."},
                "helpUri": "https://rezearcher.github.io/greyridge-x402-tools/",
                "defaultConfiguration": {"level": "error"},
            }],
        }},
        "results": results,
    }],
}
print(json.dumps(sarif))
