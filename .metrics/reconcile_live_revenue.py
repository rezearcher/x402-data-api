import json
import os

# Constants
GAP_SENSOR_PATH = os.path.expanduser("~/.hermes/data/x402-data-api/metrics/revenue_usd_corrected")
SCAN_STATE_PATH = os.path.expanduser("~/.hermes/data/x402-revenue/scan_state.json")

# Load existing scan state
with open(SCAN_STATE_PATH) as f:
    scan_state = json.load(f)

# Exclusion rules
EXCLUDED_ADDRESSES = { 
    "0x5765ae06a52dc7A0BB71c36A11db512c7ea9ed10",  # PAY_TO
    "0xC4852c26498d3187dEc2ce1b19e840710e302d1e",  # Buyer wallet
    "0x7e571e959cc7c75ccdd2eac24f8775ea2eaa2f09"   # Farming bot
}

organic_total = 0
pending_probe_check = []

# Function to determine if an address is unprobed

def is_unprobed(address):
    # Replace this with actual logic
    return False

# Function to determine if an address is unprobed (dummy implementation)

def is_unprobed(address):
    return address.lower() not in EXCLUDED_ADDRESSES

# Function logic should aggregate revenues while excluding addresses that are either excluded or unprobed
for transfer in scan_state.get('transfers', []):
    if isinstance(transfer, str):
        continue
    if 'from' not in transfer or 'value' not in transfer:
        continue
    from_address = transfer['from'].lower()
    value = transfer['value']

    if from_address in EXCLUDED_ADDRESSES or is_unprobed(from_address):
        continue
    organic_total += value
    pending_probe_check.append(from_address)

# Iterate through transfers
for transfer in scan_state.get('transfers', []):
    # Expecting each transfer to be a dictionary; handle any string or unexpected type
    if isinstance(transfer, str):
        continue
    if 'from' not in transfer or 'value' not in transfer:
        continue
    from_address = transfer['from']
    value = transfer['value']

    from_address = transfer['from']
    value = transfer['value']
    # Check for exclusion due to probe or farming bot
    if from_address in EXCLUDED_ADDRESSES:
        continue
    # Aggregate organic total
    organic_total += value
    # Add any unprobed addresses to pending list
    if is_unprobed(from_address):
        pending_probe_check.append(from_address)

# Write results
with open(GAP_SENSOR_PATH, 'w') as f:
    f.write(str(organic_total))

# Handle pending probe checks and exclusions
# Implement PRODUCT_LAUNCH_UNIX exclusion as necessary
