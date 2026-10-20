Thanks, that is a clear and fair answer, and #20 is the right home for the hidden-character check. Agreed on all three "would not fit" points.

For the interface you describe: our offline helper already reads egress.json as-is, since it only needs the `tools` array (no second connection to the server, nothing sent unless the user runs it):

```bash
mcp-egress run --calls calls.json --out egress.json -- uvx some-mcp-server
python3 scripts/mcp_scan_stdio.py --dry --file egress.json   # prints the payload, sends nothing
python3 scripts/mcp_scan_stdio.py --file egress.json         # opt-in: posts tools/list to the free preview
```
Tested just now on a sample egress.json: it returned a verdict (review, 1 critical tool-poisoning). The script is in https://github.com/rezearcher/x402-data-api/tree/main/scripts. The `--dry` form is there so a team can inspect exactly what would leave the machine. I'll pin the Action/npx references to a tag as you suggest. No need to link anything on your side unless it's useful to you.
