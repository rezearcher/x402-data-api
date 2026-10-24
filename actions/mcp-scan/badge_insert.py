#!/usr/bin/env python3
"""Insert/update the Grey Ridge MCP injection-security badge in a README.

Reads BADGE_MD (the markdown) and README_PATH from the environment.
Idempotent, marker-delimited, degrade-open:
  rc 0  -> README written (badge inserted or updated)
  rc 10 -> no change (badge already current)
  rc 3  -> README could not be read (caller keeps the build green regardless)

Invoked by action.yml only when commit-badge=true. Never fails the build:
the caller treats every rc as advisory and still emits the step-summary badge.
"""
import os
import re
import sys

START = "<!-- grsg-badge:start -->"
END = "<!-- grsg-badge:end -->"


def main() -> int:
    path = os.environ["README_PATH"]
    badge = os.environ["BADGE_MD"]
    block = f"{START}\n{badge}\n{END}"
    try:
        txt = open(path, encoding="utf-8").read()
    except Exception as e:  # noqa: BLE001 — degrade-open, any read failure is advisory
        sys.stderr.write(f"readme read failed: {e}\n")
        return 3
    if START in txt and END in txt:
        new = re.sub(re.escape(START) + r".*?" + re.escape(END), block, txt,
                     count=1, flags=re.S)
    else:
        m = re.search(r"^#\s.*$", txt, flags=re.M)
        if m:
            i = m.end()
            new = txt[:i] + "\n\n" + block + txt[i:]
        else:
            new = block + "\n\n" + txt
    if new == txt:
        print("badge already current — no change")
        return 10
    open(path, "w", encoding="utf-8").write(new)
    print("badge written to " + path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
