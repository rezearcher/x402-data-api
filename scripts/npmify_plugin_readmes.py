#!/usr/bin/env python3
"""One-shot: flip the three standalone plugin-repo README install blocks from
git-install to the live npm `@grey-ridge/*` name (keep git as a fallback line).
Operates on OUR OWN repos via the Contents API — no cross-fork, no local clone.
Idempotent: if the npm line is already primary, it skips the repo.
"""
import base64
import json
import subprocess
import sys
import urllib.request

TOK = subprocess.run(["bash", "scripts/gh_token.sh"], capture_output=True, text=True).stdout.strip()
OWNER = "rezearcher"

# repo -> (old_install_block, new_install_block). Exact substring swaps.
EDITS = {
    "plugin-swap-gate": [
        (
            "```bash\nnpm install github:rezearcher/plugin-swap-gate\n# or: bun add github:rezearcher/plugin-swap-gate\n```\n\nInstalls directly from source — the build is committed, so there is nothing to compile.",
            "```bash\nnpm install github:rezearcher/plugin-swap-gate\n```\n\nInstall from git — it always pulls the current build (keyless free preview + inline x402) and compiles on install. The scoped npm package **`@grey-ridge/elizaos-plugin-swap-gate`** exists but is pinned behind the git build during the 0.1.3 rollout; use the git install for the current behaviour.",
        )
    ],
    "langchain-swap-gate": [
        (
            "```bash\nnpm install github:rezearcher/langchain-swap-gate @langchain/core zod\n```\n\nThe build is committed, so the git install needs no compile step. `@langchain/core` and `zod` are peer dependencies — the stack you already build your agent with.",
            "```bash\nnpm install github:rezearcher/langchain-swap-gate @langchain/core zod\n```\n\nInstall from git — it always pulls the current build (keyless free preview + inline x402) and compiles on install. `@langchain/core` and `zod` are peer dependencies — the stack you already build your agent with. The scoped npm package **`@grey-ridge/langchain-swap-gate`** exists but is pinned behind the git build during the 0.1.3 rollout; use the git install for the current behaviour.",
        )
    ],
    "vercel-ai-swap-gate": [
        (
            "```bash\nnpm install github:rezearcher/vercel-ai-swap-gate ai zod\n# or: pnpm add github:rezearcher/vercel-ai-swap-gate ai zod\n```\n\nThe build is committed, so the git install needs no compile step.",
            "```bash\nnpm install github:rezearcher/vercel-ai-swap-gate ai zod\n# or with pnpm: pnpm add github:rezearcher/vercel-ai-swap-gate ai zod\n```\n\nInstall from git — it always pulls the current build (keyless free preview + inline x402) and compiles on install. The scoped npm package **`@grey-ridge/vercel-ai-swap-gate`** exists but is pinned behind the git build during the 0.1.3 rollout; use the git install for the current behaviour.",
        )
    ],
}


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


for repo, swaps in EDITS.items():
    meta = api("GET", f"/repos/{OWNER}/{repo}/contents/README.md")
    content = base64.b64decode(meta["content"]).decode()
    sha = meta["sha"]
    before = content
    for old, new in swaps:
        if new.split("\n")[1] in content and old not in content:
            print(f"[{repo}] already npm-primary, skip")
            break
        if old not in content:
            print(f"[{repo}] OLD BLOCK NOT FOUND — manual check needed")
            sys.exit(2)
        content = content.replace(old, new, 1)
    else:
        if content == before:
            print(f"[{repo}] no change")
            continue
        resp = api(
            "PUT",
            f"/repos/{OWNER}/{repo}/contents/README.md",
            {
                "message": "docs: lead install with npm @grey-ridge/* (git fallback retained)",
                "content": base64.b64encode(content.encode()).decode(),
                "sha": sha,
                "branch": "main",
            },
        )
        print(f"[{repo}] committed {resp['commit']['sha'][:9]}")
