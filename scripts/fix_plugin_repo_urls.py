#!/usr/bin/env python3
"""Point each standalone swap-gate mirror's package.json `repository` at ITS OWN
repo, not the x402-data-api monorepo.

Why: the mirrors are published/listed as standalone plugins (the ElizaOS registry
and `elizaos publish` read `repository` to locate/clone the source, and the npm
"Repository" link resolves from it). The monorepo value
(git+https://github.com/rezearcher/x402-data-api.git [+ a `directory`]) makes a
consumer clone the whole monorepo and look for the plugin at root — where it
isn't — so a registry install is DOA. Each mirror IS the plugin at root, so its
`repository` must be `github:rezearcher/<mirror-repo>` with no `directory`.

Operates on OUR OWN repos via the Contents API — no cross-fork, no local clone.
Idempotent: skips a repo whose `repository` is already the standalone form.
Run again after any mirror re-sync to re-assert the correct source URL.
"""
import base64
import json
import subprocess
import sys
import urllib.error
import urllib.request

TOK = subprocess.run(["bash", "scripts/gh_token.sh"], capture_output=True, text=True).stdout.strip()
OWNER = "rezearcher"

# mirror repo (at root) -> the standalone source the plugin must advertise.
# elizaos `publish` wants the short `github:owner/repo` form; npm accepts it too.
MIRRORS = [
    "plugin-swap-gate",         # @grey-ridge/elizaos-plugin-swap-gate (ElizaOS)
    "langchain-swap-gate",      # @grey-ridge/langchain-swap-gate
    "vercel-ai-swap-gate",      # @grey-ridge/vercel-ai-swap-gate
]


def api(method, path, body=None):
    url = f"https://api.github.com{path}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"token {TOK}")
    req.add_header("Accept", "application/vnd.github+json")
    if data:
        req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())


def main():
    if not TOK:
        print("no github token (scripts/gh_token.sh) — abort", file=sys.stderr)
        sys.exit(1)
    changed = 0
    for repo in MIRRORS:
        want = f"github:{OWNER}/{repo}"
        try:
            meta = api("GET", f"/repos/{OWNER}/{repo}/contents/package.json")
        except urllib.error.HTTPError as e:
            print(f"[{repo}] package.json fetch failed: {e.code} — skip")
            continue
        raw = base64.b64decode(meta["content"]).decode()
        pkg = json.loads(raw)
        cur = pkg.get("repository")
        if cur == want:
            print(f"[{repo}] already standalone ({want}) — skip")
            continue
        # String form is exactly what elizaos/npm want; drops any stale `directory`.
        pkg["repository"] = want
        new = json.dumps(pkg, indent=2) + "\n"
        resp = api(
            "PUT",
            f"/repos/{OWNER}/{repo}/contents/package.json",
            {
                "message": "fix(pkg): point repository at this standalone repo (was monorepo url) — registry/elizaos clone correctness",
                "content": base64.b64encode(new.encode()).decode(),
                "sha": meta["sha"],
                "branch": "main",
            },
        )
        print(f"[{repo}] committed {resp['commit']['sha'][:9]}  repository {cur!r} -> {want!r}")
        changed += 1
    print(f"done — {changed} mirror(s) updated")


if __name__ == "__main__":
    main()
