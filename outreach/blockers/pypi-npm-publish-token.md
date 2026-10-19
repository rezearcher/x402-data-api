# Blocker: package-registry publish token (PyPI and/or npm)
Why it unlocks money: framework devs find paid tools via pip/npm (competitor true402 ships `crewai-true402` on PyPI). We have a built `mcp-client/` (npm) already; no credentials exist on this machine (no ~/.npmrc, ~/.pypirc, or PYPI/NPM vars in ~/.hermes/.env).
Steps for Rez:
1. npm: `npm login` (or create an automation token at npmjs.com > Access Tokens) then add `NPM_TOKEN=...` to ~/.hermes/.env.
2. PyPI: create account at pypi.org, make an API token (scope: entire account for first upload), add `PYPI_TOKEN=...` to ~/.hermes/.env.
3. Next cycle builds and publishes `greyridge-x402-tools` (CrewAI/LangChain wrappers of /gate/swap and /chain/token-report) and `mcp-client`.
