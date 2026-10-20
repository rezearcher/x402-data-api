#!/usr/bin/env python3
"""Compute measured uptime/latency per endpoint from data/uptime_samples.jsonl -> docs/STATUS.md (Claims Law artifact)."""
import json, collections, statistics, datetime
rows=[json.loads(l) for l in open('data/uptime_samples.jsonl') if l.strip()]
by=collections.defaultdict(list)
for r in rows: by[r['ep']].append(r)
ts=sorted(r['t'] for r in rows)
def pct(v,p):
    v=sorted(v); return v[min(len(v)-1,int(round(p*(len(v)-1))))]
out=[f"# Measured status (auto-generated {datetime.datetime.now(datetime.UTC):%Y-%m-%dT%H:%MZ})","",
f"Source: `data/uptime_samples.jsonl`, {len(rows)} samples from {ts[0]} to {ts[-1]}, produced by `scripts/uptime_probe.py` hitting each free `/preview` path. Window is short; treat as a measurement, not an SLA.","",
"| endpoint | samples | success | p50 ms | p95 ms |","|---|---|---|---|---|"]
for ep,v in sorted(by.items()):
    ok=sum(1 for r in v if r['ok']); ms=[r['ms'] for r in v if r.get('ms') is not None]
    out.append(f"| {ep} | {len(v)} | {100*ok/len(v):.1f}% | {pct(ms,.5):.0f} | {pct(ms,.95):.0f} |")
open('docs/STATUS.md','w').write("\n".join(out)+"\n"); print("\n".join(out))
