#!/usr/bin/env python3
"""Compare Oct 20 snapshot vs Oct 28 catalog scan. Verify re-listing status."""
import json
import sys
from pathlib import Path

def main():
    snap_path = Path('/home/rez/projects/x402-data-api/data/bazaar_full_2026-10-20.json')
    scan_path = Path('/tmp/locate_all.json')

    # Load Oct 20 snapshot (extract our routes)
    try:
        snap_data = json.load(open(snap_path))
        oct20_routes = {r['resource']: {'index': i, 'ts': r.get('lastUpdated')}
                        for i, r in enumerate(snap_data)
                        if 'sigrunner' in r['resource']}
    except Exception as e:
        print(f"ERROR: Oct 20 snapshot missing: {e}", file=sys.stderr)
        return 1

    # Load Oct 28 scan
    try:
        scan_data = json.load(open(scan_path))
        oct28_routes = {h['resource']: {'index': h['index'], 'ts': h.get('lastUpdated')}
                        for h in scan_data.get('hits', [])}
        catalog_total = scan_data.get('catalog_total', 90328)
    except Exception as e:
        print(f"ERROR: Oct 28 scan not ready: {e}", file=sys.stderr)
        return 1

    print("=" * 90)
    print("RE-LISTING VERIFICATION: Oct 20 → Oct 28")
    print(f"Oct 20 snapshot: {len(oct20_routes)} sigrunner routes")
    print(f"Oct 28 catalog: {catalog_total} total items, {len(oct28_routes)} sigrunner hits found")
    print("=" * 90)

    # Categorize
    still_live = []
    delisted = []
    moved = []

    for url, oct_rec in oct20_routes.items():
        if url in oct28_routes:
            live_rec = oct28_routes[url]
            still_live.append((url, oct_rec['index'], live_rec['index']))
            if oct_rec['index'] != live_rec['index']:
                moved.append((url, oct_rec['index'], live_rec['index']))
        else:
            delisted.append((url, oct_rec['index']))

    print(f"\nSTILL LIVE: {len(still_live)}/{len(oct20_routes)} routes")
    for url, oct_idx, live_idx in sorted(still_live)[:20]:
        move = f" (moved {oct_idx}→{live_idx})" if oct_idx != live_idx else ""
        print(f"  ✓ {url[-55:]}{move}")
    if len(still_live) > 20:
        print(f"  ... and {len(still_live)-20} more")

    if delisted:
        print(f"\nDELISTED: {len(delisted)} routes (missing from Oct 28)")
        for url, oct_idx in sorted(delisted)[:20]:
            print(f"  ✗ idx {oct_idx:5d}  {url[-50:]}")
        if len(delisted) > 20:
            print(f"  ... and {len(delisted)-20} more")

    if moved:
        print(f"\nPOSITION SHIFTS: {len(moved)} routes moved")
        moved_sorted = sorted(moved, key=lambda x: x[1])  # sort by Oct 20 index
        for url, oct_idx, live_idx in moved_sorted[:20]:
            delta = live_idx - oct_idx
            arrow = "↑" if delta < 0 else "↓"
            print(f"  {arrow} Δ{delta:+7d} | {oct_idx:5d}→{live_idx:5d} | {url[-50:]}")
        if len(moved) > 20:
            print(f"  ... and {len(moved)-20} more")

    # Summary
    pct_live = 100 * len(still_live) // len(oct20_routes) if oct20_routes else 0
    print("\n" + "=" * 90)
    print("SUMMARY:")
    print(f"  Total Oct 20:       {len(oct20_routes)}")
    print(f"  Still live Oct 28:  {len(still_live):3d} ({pct_live}%)")
    print(f"  Delisted (missing): {len(delisted):3d} ({100-pct_live}%)")
    print(f"  Position shifted:   {len(moved):3d}")
    print("=" * 90)

    # Verdict
    if pct_live == 100:
        print("\n✓ VERIFIED: All routes still discoverable in live catalog.")
        return 0
    elif pct_live >= 80:
        print(f"\n⚠ PARTIAL: {pct_live}% still live. {len(delisted)} routes missing.")
        return 0
    else:
        print(f"\n✗ DELISTING CONFIRMED: Only {pct_live}% discoverable. {len(delisted)} routes removed.")
        return 1

if __name__ == '__main__':
    sys.exit(main())
