#!/usr/bin/env python3
"""Fail if any x402 resource.description exceeds the CDP Facilitator limit.

CDP docs (x402/seller/get-discovered): "Keep it to 500 characters or fewer,
because the CDP Facilitator rejects verify and settle requests whose
description exceeds that limit." An over-limit description means a real buyer's
verify+settle is REJECTED on that route — i.e. the route cannot earn.

Scans src/index.ts for the description string attached to each
declareDiscoveryExtension discovery resource. Exits non-zero (and prints the
offenders) if any is >500 chars, so it can gate a deploy / run as a sensor.
"""
import re
import sys
import pathlib

LIMIT = 500
SRC = pathlib.Path(__file__).resolve().parent.parent / "src" / "index.ts"


def main() -> int:
    text = SRC.read_text()
    lines = text.split("\n")
    sites = [i for i, ln in enumerate(lines) if "declareDiscoveryExtension" in ln]
    over = []
    # 1. x402 v2 resource.description (what the Facilitator reads on verify+settle)
    for idx in sites:
        block = "\n".join(lines[max(0, idx - 15):idx])
        m = re.search(r'description:\s*\n?\s*"((?:[^"\\]|\\.)*)"', block)
        if m and len(m.group(1)) > LIMIT:
            over.append((idx + 1, len(m.group(1)), m.group(1)[:60]))
    # 2. mk() route descriptions (feed the paid-route registry).
    #    mk("/path","METHOD","price","amount","<description>",[tags])
    for i, ln in enumerate(lines):
        if "mk(" not in ln:
            continue
        args = re.findall(r'"((?:[^"\\]|\\.)*)"', ln)
        # 5th string arg is the description (path, method, price, amount, desc)
        if len(args) >= 5 and len(args[4]) > LIMIT:
            over.append((i + 1, len(args[4]), "mk: " + args[4][:56]))
    # 3. openapi paid()/free() summaries. The openapi `description` is built as
    #    `${summary} Paid via x402 (...). Price: $X.` (~120-char suffix), and
    #    x402scan ingests openapi.json. Flag any summary whose resulting openapi
    #    description would exceed the limit (summary + suffix).
    OPENAPI_SUFFIX = 120  # length of the paid() boilerplate appended after summary
    for i, ln in enumerate(lines):
        m = re.search(r'\b(paid|free)\(\s*"((?:[^"\\]|\\.)*)"', ln)
        if not m:
            continue
        summary = m.group(2)
        effective = len(summary) + (OPENAPI_SUFFIX if m.group(1) == "paid" else 0)
        if effective > LIMIT:
            over.append((i + 1, effective,
                         f"{m.group(1)}()->openapi: " + summary[:44]))
    if over:
        print(f"FAIL: {len(over)} x402 resource.description(s) over {LIMIT} chars "
              f"(CDP Facilitator will reject verify+settle):")
        for ln, n, head in over:
            print(f"  src/index.ts ~line {ln}: {n} chars  \"{head}...\"")
        return 1
    print(f"OK: all discovery resource.descriptions <= {LIMIT} chars "
          f"({len(sites)} discovery sites scanned)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
