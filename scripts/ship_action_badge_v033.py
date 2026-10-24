#!/usr/bin/env python3
"""Ship the injection-security README badge into the PUBLISHED CI Action.

The action consumers actually run is the ROOT action.yml of
rezearcher/greyridge-x402-tools (uses: rezearcher/greyridge-x402-tools@v0).
This pushes the upgraded action.yml + badge_insert.py to that repo's default
branch via the Contents API (no local clone / no cross-fork), then cuts
release tag v0.3.3 and moves the floating major tag v0 to it.

Idempotent: re-PUT only when content differs; tag refs are updated in place.
Local source of truth: .work/greyridge-x402-tools/{action.yml,badge_insert.py}.
"""
import base64
import json
import subprocess
import sys
import urllib.error
import urllib.request

TOK = subprocess.run(["bash", "scripts/gh_token.sh"], capture_output=True, text=True).stdout.strip()
OWNER = "rezearcher"
REPO = "greyridge-x402-tools"
BRANCH = "main"
FILES = ["action.yml", "badge_insert.py"]
SRC = ".work/greyridge-x402-tools"
NEW_TAG = "v0.3.3"
MAJOR_TAG = "v0"


def api(method, path, body=None):
    url = f"https://api.github.com{path}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"token {TOK}")
    req.add_header("Accept", "application/vnd.github+json")
    if data:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}")


def put_file(path):
    local = open(f"{SRC}/{path}", "rb").read()
    want_b64 = base64.b64encode(local).decode()
    st, meta = api("GET", f"/repos/{OWNER}/{REPO}/contents/{path}?ref={BRANCH}")
    sha = None
    if st == 200:
        sha = meta.get("sha")
        have = base64.b64decode(meta["content"]).decode(errors="replace")
        if have == local.decode(errors="replace"):
            print(f"[{path}] already current — skip")
            return meta.get("sha"), False
    body = {"message": f"feat(action): README injection-security badge — {path}",
            "content": want_b64, "branch": BRANCH}
    if sha:
        body["sha"] = sha
    st, res = api("PUT", f"/repos/{OWNER}/{REPO}/contents/{path}", body)
    if st not in (200, 201):
        print(f"[{path}] PUT failed {st}: {res}", file=sys.stderr)
        sys.exit(1)
    newsha = res["commit"]["sha"]
    print(f"[{path}] committed {newsha[:10]}")
    return newsha, True


def set_tag(tag, commit_sha):
    ref = f"refs/tags/{tag}"
    st, _ = api("GET", f"/repos/{OWNER}/{REPO}/git/ref/tags/{tag}")
    if st == 200:
        st, res = api("PATCH", f"/repos/{OWNER}/{REPO}/git/{ref}",
                      {"sha": commit_sha, "force": True})
        print(f"[tag {tag}] moved -> {commit_sha[:10]} ({st})")
    else:
        st, res = api("POST", f"/repos/{OWNER}/{REPO}/git/refs",
                      {"ref": ref, "sha": commit_sha})
        print(f"[tag {tag}] created -> {commit_sha[:10]} ({st})")
    if st not in (200, 201):
        print(f"[tag {tag}] FAILED {st}: {res}", file=sys.stderr)


def main():
    if not TOK:
        print("no github token", file=sys.stderr)
        sys.exit(1)
    head = None
    for f in FILES:
        head, _ = put_file(f)
    # head is the commit sha of the last PUT (branch HEAD); tag it.
    st, br = api("GET", f"/repos/{OWNER}/{REPO}/branches/{BRANCH}")
    if st == 200:
        head = br["commit"]["sha"]
    print(f"branch HEAD = {head[:10]}")
    set_tag(NEW_TAG, head)
    set_tag(MAJOR_TAG, head)
    print("done")


if __name__ == "__main__":
    main()
