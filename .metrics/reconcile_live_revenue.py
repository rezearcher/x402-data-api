import json
import os

# Constants
GAP_SENSOR_PATH = os.path.expanduser("~/.hermes/data/x402-data-api/metrics/revenue_usd_corrected")
REPO_SENSOR_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "revenue_usd_corrected")
SCAN_STATE_PATH = os.path.expanduser("~/.hermes/data/x402-revenue/scan_state.json")
PROBE_CHECK_SUMMARY_PATH = os.path.expanduser("~/.hermes/data/x402-data-api-revenue/probe_check_summary.json")

# Load existing scan state
with open(SCAN_STATE_PATH) as f:
    scan_state = json.load(f)

# Load probe-check summary (read-only): known payer addresses and bot-likely flags
with open(PROBE_CHECK_SUMMARY_PATH) as f:
    probe_summary = json.load(f)
probe_results = probe_summary.get("results", [])
KNOWN_ADDRESSES = {r["address"].lower() for r in probe_results}
BOT_ADDRESSES = {r["address"].lower() for r in probe_results if r.get("probe_likely")}

# Exclusion rules (self-owned wallets; lowercased so matching is case-insensitive)
EXCLUDED_ADDRESSES = {
    "0x5765ae06a52dc7a0bb71c36a11db512c7ea9ed10",  # PAY_TO
    "0xc4852c26498d3187dec2ce1b19e840710e302d1e",  # Buyer wallet
    "0x7e571e959cc7c75ccdd2eac24f8775ea2eaa2f09",  # Farming bot
}

organic_total = 0
pending_probe_check = []

# Function to determine if an address is unprobed (or bot-likely): it never
# appeared in the probe-check summary, or the probe flagged it as probe_likely.

def is_unprobed(address):
    return address.lower() not in KNOWN_ADDRESSES or address.lower() in BOT_ADDRESSES

# Function logic should aggregate revenues while excluding addresses that are either excluded or unprobed.
# scan_state['transfers'] is a dict keyed by "<txhash>:<index>"; iterate its values.
for transfer in scan_state.get('transfers', {}).values():
    if not isinstance(transfer, dict):
        continue
    if 'from' not in transfer or 'value' not in transfer:
        continue
    from_address = transfer['from'].lower()
    value = transfer['value']

    if from_address in EXCLUDED_ADDRESSES or is_unprobed(from_address):
        continue
    organic_total += value
    pending_probe_check.append(from_address)

# Write results to both the sensor metric path and the repo-local mirror
for path in (GAP_SENSOR_PATH, REPO_SENSOR_PATH):
    with open(path, 'w') as f:
        f.write(str(organic_total) + '\n')

# Handle pending probe checks and exclusions
# PRODUCT_LAUNCH_UNIX exclusion as necessary
