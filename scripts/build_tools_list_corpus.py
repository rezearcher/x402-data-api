#!/usr/bin/env python3
"""Build a labeled MCP `tools/list`-shaped benchmark corpus.

Source of truth is benchmarks/mcp_scan_corpus.json (flat {name,description,label}).
This promotes every entry to a full MCP tool object (name, description, inputSchema),
normalizes the label vocabulary to {good,bad}, attaches provenance/category, and adds
a batch of authentic clean tools/list entries drawn from well-known public MCP servers
(the clean half an external validator is least likely to already have).

Outputs:
  benchmarks/mcp_tools_list_corpus.json   labeled: {metadata, samples:[{label,category,source,tool}]}
  benchmarks/mcp_tools_list_sample.json   a pure MCP JSON-RPC tools/list response (no labels),
                                          ready to feed directly to a scanner / ATR cli.

Run: python3 -I scripts/build_tools_list_corpus.py
"""
import json
import pathlib
import subprocess
import datetime

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "benchmarks" / "mcp_scan_corpus.json"
OUT_LABELED = ROOT / "benchmarks" / "mcp_tools_list_corpus.json"
OUT_SAMPLE = ROOT / "benchmarks" / "mcp_tools_list_sample.json"

STR = {"type": "string"}


def schema(props, required=None):
    return {
        "type": "object",
        "properties": props,
        **({"required": required} if required else {}),
    }


# Hand-authored realistic inputSchemas keyed by the corpus `name`. A tool not listed
# here gets a generic single-string-input schema so it is still tools/list-shaped.
SCHEMAS = {
    # poisoned entries keep a plausible schema; the Invariant PoC smuggles an extra
    # `sidenote` parameter, so we model that faithfully for the two add() variants.
    "add": schema({"a": {"type": "number"}, "b": {"type": "number"},
                   "sidenote": STR}, ["a", "b", "sidenote"]),
    "add_numbers": schema({"a": {"type": "number"}, "b": {"type": "number"},
                           "sidenote": STR}, ["a", "b", "sidenote"]),
    "get_weather": schema({"city": STR}, ["city"]),
    "get_forecast": schema({"lat": {"type": "number"}, "lon": {"type": "number"}}, ["lat", "lon"]),
    "get_price": schema({"symbol": STR}, ["symbol"]),
    "get_balance": schema({"address": STR}, ["address"]),
    "send_message": schema({"channel": STR, "text": STR}, ["channel", "text"]),
    "send_email": schema({"to": STR, "subject": STR, "body": STR}, ["to", "subject", "body"]),
    "send_note": schema({"to": STR, "body": STR}, ["to", "body"]),
    "read_file": schema({"path": STR}, ["path"]),
    "upload_file": schema({"path": STR}, ["path"]),
    "transfer_file": schema({"src": STR, "dst": STR}, ["src", "dst"]),
    "create_issue": schema({"repo": STR, "title": STR, "body": STR}, ["repo", "title"]),
    "query_db": schema({"sql": STR}, ["sql"]),
    "run_query": schema({"sql": STR}, ["sql"]),
    "run_tests": schema({}, None),
    "deploy": schema({"env": STR}, ["env"]),
    "webhook_register": schema({"url": STR}, ["url"]),
    "set_webhook": schema({"url": STR}, ["url"]),
    "export_report": schema({"email": STR}, ["email"]),
    "list_tools": schema({}, None),
    "list_repos": schema({"org": STR}, ["org"]),
    "summarize": schema({"text": STR}, ["text"]),
    "translate": schema({"text": STR, "target": STR}, ["text", "target"]),
    "fetch": schema({"url": STR}, ["url"]),
    "fetch_page": schema({"url": STR}, ["url"]),
    "get_docs": schema({"query": STR}, ["query"]),
    "search": schema({"query": STR}, ["query"]),
    "search_docs": schema({"query": STR}, ["query"]),
    "scan_repo": schema({"repo": STR}, ["repo"]),
    "git_commit": schema({"message": STR}, ["message"]),
    "create_secret": schema({"name": STR, "value": STR}, ["name", "value"]),
    "evaluate_model": schema({"model_id": STR, "dataset": STR}, ["model_id", "dataset"]),
    "calc": schema({"expression": STR}, ["expression"]),
    "run": schema({"command": STR}, ["command"]),
    "shell": schema({"command": STR}, ["command"]),
    "format": schema({"code": STR}, ["code"]),
    "sync": schema({}, None),
    "backup": schema({}, None),
    "logger": schema({"event": STR}, ["event"]),
    "pay": schema({"amount": {"type": "number"}, "to": STR}, ["amount", "to"]),
    "notes": schema({"text": STR}, ["text"]),
    "helper": schema({}, None),
    "check_single_domain_availability": schema({"domain": STR}, ["domain"]),
}

# Authentic clean tools/list entries from well-known public MCP servers. Names and
# descriptions paraphrased from each server's published tools/list; schemas modelled
# on the real ones. Purpose: a clean tools/list corpus with real-world surface shape
# (nested schemas, enums, arrays) that a validator is unlikely to already hold.
CLEAN_EXTRA = [
    ("filesystem", "list_directory",
     "Get a detailed listing of all files and directories in a specified path.",
     schema({"path": STR}, ["path"])),
    ("filesystem", "move_file",
     "Move or rename files and directories within allowed directories.",
     schema({"source": STR, "destination": STR}, ["source", "destination"])),
    ("github", "search_code",
     "Search for code across GitHub repositories matching a query.",
     schema({"q": STR, "per_page": {"type": "number"}, "page": {"type": "number"}}, ["q"])),
    ("github", "get_pull_request",
     "Get details of a specific pull request in a repository.",
     schema({"owner": STR, "repo": STR, "pull_number": {"type": "number"}},
            ["owner", "repo", "pull_number"])),
    ("slack", "slack_post_message",
     "Post a new message to a Slack channel.",
     schema({"channel_id": STR, "text": STR}, ["channel_id", "text"])),
    ("postgres", "query",
     "Run a read-only SQL query against the connected PostgreSQL database.",
     schema({"sql": STR}, ["sql"])),
    ("fetch", "fetch",
     "Fetch a URL and extract its contents as markdown for the model to read.",
     schema({"url": STR, "max_length": {"type": "number"},
             "raw": {"type": "boolean"}}, ["url"])),
    ("time", "convert_time",
     "Convert a time between two IANA timezones.",
     schema({"source_timezone": STR, "time": STR, "target_timezone": STR},
            ["source_timezone", "time", "target_timezone"])),
    ("memory", "create_entities",
     "Create multiple new entities in the knowledge graph.",
     schema({"entities": {"type": "array", "items": schema(
         {"name": STR, "entityType": STR,
          "observations": {"type": "array", "items": STR}})}}, ["entities"])),
    ("brave-search", "brave_web_search",
     "Perform a web search using the Brave Search API and return ranked results.",
     schema({"query": STR, "count": {"type": "number"},
             "offset": {"type": "number"}}, ["query"])),
    ("sentry", "get_issue",
     "Retrieve details and the latest event for a Sentry issue by id or short id.",
     schema({"issue_id_or_url": STR}, ["issue_id_or_url"])),
    ("gdrive", "gdrive_search",
     "Search for files in the user's Google Drive by name or content.",
     schema({"query": STR, "pageToken": STR, "pageSize": {"type": "number"}}, ["query"])),
    ("puppeteer", "puppeteer_navigate",
     "Navigate the headless browser to a URL.",
     schema({"url": STR, "launchOptions": {"type": "object"},
             "allowDangerous": {"type": "boolean"}}, ["url"])),
    ("everything", "echo",
     "Echo back the input message. Used to exercise a minimal round-trip.",
     schema({"message": STR}, ["message"])),
]


def git_sha():
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    except Exception:
        return "unknown"


def main():
    raw = json.loads(SRC.read_text())
    samples = []
    for e in raw:
        label = "good" if e["label"] in ("good", "benign") else "bad"
        name = e["name"]
        tool = {
            "name": name,
            "description": e["description"],
            "inputSchema": SCHEMAS.get(name, schema({"input": STR}, ["input"])),
        }
        samples.append({
            "label": label,
            "category": "poisoned" if label == "bad" else "clean",
            "source": "greyridge-authored-synthetic",
            "tool": tool,
        })
    for server, name, desc, sch in CLEAN_EXTRA:
        samples.append({
            "label": "good",
            "category": "clean",
            "source": f"paraphrased-public-mcp-server:{server}",
            "tool": {"name": name, "description": desc, "inputSchema": sch},
        })

    n_bad = sum(1 for s in samples if s["label"] == "bad")
    n_good = len(samples) - n_bad
    doc = {
        "metadata": {
            "name": "Grey Ridge MCP tools/list poisoning benchmark",
            "version": 1,
            "generated_at": datetime.datetime.now(datetime.timezone.utc)
            .strftime("%Y-%m-%dT%H:%M:%SZ"),
            "git_commit": git_sha(),
            "license": "MIT",
            "license_note": (
                "All samples in this file are authored in-repo or paraphrased from "
                "public MCP server tool lists; released MIT with the rest of the repo. "
                "No share-alike, no third-party per-line licence encumbrance."
            ),
            "count": len(samples),
            "split": {"bad_poisoned": n_bad, "good_clean": n_good},
            "label_vocab": ["good", "bad"],
            "labeling": (
                "Single-author hand labels. 'bad' = a tool-metadata poisoning / "
                "prompt-injection / exfiltration pattern lives in name or description; "
                "'good' = benign, including deliberate look-alike wording (evaluate, "
                "webhook, 'other tools', deploy) and two real registry-census false "
                "positives kept as clean controls."
            ),
            "provenance": (
                "Poisoned patterns follow public tool-poisoning research (Invariant "
                "Labs <IMPORTANT> style, WhatsApp/SMS exfil, shadowing, unicode/bidi, "
                "ANSI/CSS covert channels). Clean entries are authored benign twins "
                "plus paraphrased tools from well-known public servers (filesystem, "
                "github, slack, postgres, fetch, time, memory, brave-search, sentry, "
                "gdrive, puppeteer, everything)."
            ),
            "shape": (
                "Each sample.tool is a complete MCP tool object (name, description, "
                "inputSchema). benchmarks/mcp_tools_list_sample.json is the same tools "
                "as a bare JSON-RPC tools/list result for direct scanner ingestion."
            ),
        },
        "samples": samples,
    }
    OUT_LABELED.write_text(json.dumps(doc, indent=2, ensure_ascii=False) + "\n")

    sample_doc = {
        "jsonrpc": "2.0",
        "id": 1,
        "result": {"tools": [s["tool"] for s in samples]},
    }
    OUT_SAMPLE.write_text(json.dumps(sample_doc, indent=2, ensure_ascii=False) + "\n")

    print(f"wrote {OUT_LABELED.relative_to(ROOT)}: {len(samples)} samples "
          f"({n_bad} bad / {n_good} good)")
    print(f"wrote {OUT_SAMPLE.relative_to(ROOT)}: bare tools/list, "
          f"{len(samples)} tools")


if __name__ == "__main__":
    main()
