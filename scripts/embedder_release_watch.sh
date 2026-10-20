#!/usr/bin/env bash
# Watches embedder repos for a release published after our integration merged.
# Output: ~/.hermes/data/x402_embedder_releases/latest.json
# usage: embedder_release_watch.sh   (repo|merged_at list in data/embedders.txt)
set -u
cd "$(dirname "$0")/.."
OUT=~/.hermes/data/x402_embedder_releases; mkdir -p "$OUT"
export GH_TOKEN=$(printf 'protocol=https\nhost=github.com\n\n' | git credential fill | sed -n 's/^password=//p')
python3 - "$OUT/latest.json" <<'P'
import json,subprocess,sys,datetime
rows=[]
for l in open('data/embedders.txt'):
    l=l.strip()
    if not l or l.startswith('#'): continue
    repo,merged=l.split('|')
    r=subprocess.run(['gh','api',f'repos/{repo}/releases?per_page=5','--jq','.[]|{tag:.tag_name,at:.published_at}|tojson'],capture_output=True,text=True)
    rel=[json.loads(x) for x in r.stdout.splitlines() if x.startswith('{')]
    new=[x for x in rel if x['at']>merged]
    rows.append({'repo':repo,'merged_at':merged,'released_after_merge':new,'live':bool(new)})
json.dump({'fetched_at':datetime.datetime.utcnow().isoformat()+'Z','embedders':rows,'alert':any(r['live'] for r in rows)},open(sys.argv[1],'w'),indent=1)
print(open(sys.argv[1]).read())
P
