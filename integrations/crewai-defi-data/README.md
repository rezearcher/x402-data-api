# grey-ridge-x402-data

DeFi yields, token prices, perp funding, a one-call market brief and Base-chain
reads for **CrewAI** and plain **Python** trading agents — paid inline per call
with **x402 USDC on Base** (from **$0.001/call**), **no API key, no account, no
subscription**.

Drop-in tools wrapping Grey Ridge's live x402 data routes:

| Function / tool | Route | Price | Returns |
|------|-------|-------|---------|
| `defi_yields` | `/defi/yields` | $0.001 | Top lending/LP pools: project, chain, symbol, APY + trend, IL risk, TVL, risk-adjusted score |
| `crypto_prices` | `/crypto/prices` | $0.001 | Spot price, 24h change, symbol — ticker symbols (`ETH,BTC`) or CoinGecko ids, ≤25 |
| `crypto_funding` | `/crypto/funding` | $0.004 | Cross-venue perp funding + arb spread (Hyperliquid+OKX+dYdX), best long/short venue, signal |
| `market_brief` | `/brief/market` | $0.01 | One-call snapshot: fear/greed, global market cap, BTC dominance, trending coins |
| `base_balance` | `/chain/balance` | $0.002 | Native ETH balance + `balance_usd` for a Base address |
| `base_gas_price` | `/chain/gas-price` | $0.002 | Base EIP-1559 gas: base/priority fee (gwei), `gas_price_usd` |
| `base_block_number` | `/chain/block-number` | $0.002 | Current Base mainnet block height |
| `base_token_balance` | `/chain/token-balance` | $0.002 | ERC-20 balance of a Base address (`token` defaults to USDC) |

`crypto_funding` degrades open to a **real top-1 preview** (live perp funding for
the top coin) when run keyless; `market_brief` has no preview, so keyless returns
an honest activation stub rather than a fabricated brief.

Upstream data is DefiLlama + Base RPC, served from a sub-cent Cloudflare Worker.

`base_gas_price`, `base_block_number` and `base_token_balance` back a **keyless**
install with the **real live value** — their free preview is identical to the
paid route, so an agent with no wallet still gets the true gas price, block
height and token balance (never a stub). A funded wallet simply moves the read
onto the metered paid route.

## Install

```bash
# straight from git (no PyPI account needed):
pip install "git+https://github.com/rezearcher/crewai-defi-data"

# with the CrewAI wrappers and/or the paid x402 rail:
pip install "grey-ridge-x402-data[crewai] @ git+https://github.com/rezearcher/crewai-defi-data"
pip install "grey-ridge-x402-data[pay]    @ git+https://github.com/rezearcher/crewai-defi-data"
```

The **core is standard-library only** — the keyless / preview tier needs no
third-party packages at all. `x402` + `eth-account` (extra `[pay]`) are pulled
in only for the paid tier; `crewai` + `pydantic` (extra `[crewai]`) only for the
CrewAI tool wrappers.

## Use — plain Python (any agent framework)

```python
from grey_ridge_x402_data import crypto_prices, defi_yields, base_gas_price

# Keyless: returns a real 1-row sample (prices/yields) or the full live value
# (gas/block/token-balance). Set PRIVATE_KEY in the env to unlock full results.
print(crypto_prices("bitcoin,ethereum")["summary"])   # 'BTC $81,060 (+1.47%)'
print(defi_yields(limit=5, stable=True)["summary"])     # 'Top of ...: lido ... 2.27% APY ...'
print(base_gas_price())                                 # real live gas, keyless
```

## Use — CrewAI

```python
import os
from crewai import Agent, Task, Crew
from grey_ridge_x402_data import crewai_tools

# Reads PRIVATE_KEY (the agent's Base wallet) from the environment if set;
# omit it to run the crew on the free preview tier.
tools = crewai_tools()

analyst = Agent(
    role="DeFi analyst",
    goal="Find the best stablecoin yield on Base and the current BTC price",
    backstory="Trades on Base; pays per data call with x402.",
    tools=tools,
)
Crew(agents=[analyst], tasks=[Task(
    description="Report the top stablecoin yield pool and the BTC price.",
    expected_output="One line each.", agent=analyst)]).kickoff()
```

## Paying per call (the paid tier)

Set `PRIVATE_KEY` (or `X402_PRIVATE_KEY`) to a Base wallet holding a little USDC
— ~1 USDC covers ~1000 calls at $0.001 each. Each call signs an x402 payment
inline over the 402 handshake; there is no API key and no subscription. With no
key set, every tool degrades open to the free preview tier automatically.

## Design

- **Degrade-open, never throw.** Every function returns a plain `dict`; a true
  outage is reported as `{"error": ...}` rather than raising into the agent loop.
- **Honest, no fabrication.** Routes with no free preview (`base_balance`)
  return an activation stub keyless — never a made-up number.
- **Dependency-light.** The data core is pure standard library.

MIT licensed. Built by Grey Ridge Signals Group. Live routes + more tools:
https://api.greyridgesignals.ai/for-agents
