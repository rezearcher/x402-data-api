#!/bin/bash
# Final relisting report: checks scan status and generates full verification
set -e

SCAN_FILE="/tmp/locate_all.json"
MAX_WAIT=600

# Wait for scan to complete
echo "[waiting for catalog scan to finish...]"
for i in $(seq 1 $MAX_WAIT); do
    if [ -f "$SCAN_FILE" ] && python3 -c "import json; json.load(open('$SCAN_FILE'))" 2>/dev/null; then
        echo "✓ Scan complete"
        break
    fi
    if [ $((i % 10)) -eq 0 ]; then
        echo "  ... $i seconds elapsed"
    fi
    sleep 1
done

if [ ! -f "$SCAN_FILE" ]; then
    echo "ERROR: Scan timed out after $MAX_WAIT seconds"
    exit 1
fi

# Run verification
cd /home/rez/projects/x402-data-api
python3 scripts/verify_relisting.py
