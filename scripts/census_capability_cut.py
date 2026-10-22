#!/usr/bin/env python3
"""Second cut of the MCP registry census: of the servers that answer tools/list
with no credentials, how many advertise a tool that performs a STATE-CHANGING or
SENSITIVE-ACCESS action (write/exec/credential/send) versus read-only lookup?

High-precision keyword classification: a tool counts for a class only on a strong,
verb-anchored pattern (not bare nouns like "url"/"path"/"token" that over-match
benign read-only directory tools). Every matched (tool name + class) is written to
the output JSONL so each claim is inspectable (Claims Law). Run with network.
"""
import json
import re
import urllib.request
import concurrent.futures
from collections import Counter

# High-precision, verb-anchored patterns. Tuned after a first pass over-matched
# read-only directory servers (search/listing tools) on bare nouns.
CLASSES = {
    "shell/exec":        r"(execute (a )?(command|code|script|shell)|run (a )?(command|shell|script|bash|code)|arbitrary code|subprocess|spawn a process|\bbash\b|terminal command)",
    "file-write":        r"(write (a |to )?file|create (a )?file|delete (a )?file|edit (a )?file|save (a )?file|upload (a )?file|modify (a )?file|overwrite)",
    "credential-access": r"(api[_ -]?key|private key|access token|secret(s)? (manager|store|value)|read .*\.env|credential(s)?|password)",
    "send/notify":       r"(send (an? )?(email|message|sms|webhook)|post to slack|send to (telegram|discord)|dispatch (an? )?(email|notification))",
    "db-write":          r"(insert (into|a row)|update (a )?(row|record)|delete (a )?(row|record)|drop table|execute (sql|query) )",
}
CLASS_RE = {k: re.compile(v, re.I) for k, v in CLASSES.items()}

RPC = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}}).encode()


def fetch_tools(url, timeout=12):
    req = urllib.request.Request(url, data=RPC, method="POST", headers={
        "content-type": "application/json",
        "accept": "application/json, text/event-stream",
        "user-agent": "Mozilla/5.0 (compatible; GreyRidgeCensus/1.0)",
    })
    try:
        raw = urllib.request.urlopen(req, timeout=timeout).read().decode("utf-8", "replace")
    except Exception as e:
        return None, f"fetch-error:{type(e).__name__}"
    txt = raw
    if "data:" in raw and not raw.lstrip().startswith("{"):
        for line in raw.splitlines():
            if line.strip().startswith("data:"):
                txt = line.strip()[5:].strip()
                break
    try:
        obj = json.loads(txt)
    except Exception:
        return None, "non-json"
    tools = (obj.get("result") or {}).get("tools")
    if tools is None:
        return None, "no-tools-field"
    return tools, None


def classify_tool(t):
    blob = f"{t.get('name','')} {t.get('description','')}".lower()
    sch = t.get("inputSchema") or t.get("input_schema") or {}
    for pn, pv in (sch.get("properties") or {}).items():
        blob += " " + pn + " " + str((pv or {}).get("description", ""))
    return [cls for cls, rex in CLASS_RE.items() if rex.search(blob)]


def main():
    urls = json.load(open("/tmp/readable_urls.json"))
    out = open("benchmarks/registry_census/capability_cut.jsonl", "w")
    results = {}

    def work(u):
        tools, err = fetch_tools(u)
        if err:
            return u, None, err
        return u, tools, None

    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as ex:
        for u, tools, err in ex.map(work, urls):
            if err:
                out.write(json.dumps({"url": u, "error": err}) + "\n")
                continue
            hits = []  # (tool_name, classes)
            server_classes = set()
            for t in tools:
                c = classify_tool(t)
                if c:
                    hits.append({"tool": t.get("name", ""), "classes": c})
                    server_classes.update(c)
            rec = {"url": u, "n_tools": len(tools), "classes": sorted(server_classes), "hits": hits}
            out.write(json.dumps(rec) + "\n")
            results[u] = rec
    out.close()

    n_ok = len(results)
    n_tools_total = sum(r["n_tools"] for r in results.values())
    print(f"re-fetched OK: {n_ok} servers, {n_tools_total} tools")
    if not n_ok:
        return
    cls_counts = Counter()
    any_sensitive = 0
    for r in results.values():
        if r["classes"]:
            any_sensitive += 1
        for c in r["classes"]:
            cls_counts[c] += 1
    print(f"\nservers exposing >=1 STATE-CHANGING/SENSITIVE tool (unauth tools/list): {any_sensitive}/{n_ok} = {100*any_sensitive/n_ok:.0f}%")
    print("read-only (no sensitive-class tool advertised): "
          f"{n_ok-any_sensitive}/{n_ok} = {100*(n_ok-any_sensitive)/n_ok:.0f}%")
    print("\nby class (share of re-fetched readable servers):")
    for c in CLASSES:
        v = cls_counts[c]
        print(f"  {c:20s} {v:3d}/{n_ok}  {100*v/n_ok:4.0f}%")
    print("\n=== every matched tool (inspect for false positives) ===")
    for u, r in sorted(results.items()):
        for h in r["hits"]:
            print(f"  {u}  [{','.join(h['classes'])}]  {h['tool']}")


if __name__ == "__main__":
    main()
