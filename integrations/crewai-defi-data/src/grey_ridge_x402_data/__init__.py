"""Grey Ridge x402 DeFi / market-data tools for CrewAI and plain Python agents.

Paid inline per call with x402 USDC on Base (from $0.001/call) — no API key, no
account, no subscription. Degrades open to a free preview tier when no wallet is
configured.

Quick start (plain Python, no CrewAI needed)::

    from grey_ridge_x402_data import crypto_prices, defi_yields
    print(crypto_prices("bitcoin,ethereum"))   # keyless → 1-coin preview
    print(defi_yields(limit=5, stable=True))    # keyless → 1-pool preview

CrewAI crew::

    from grey_ridge_x402_data import crewai_tools
    tools = crewai_tools()           # reads PRIVATE_KEY from env if set
    agent = Agent(role="analyst", tools=tools, ...)
"""

from __future__ import annotations

from .client import has_wallet, make_pay_get
from .data import DATA_BASE, BASE_USDC
from .tools import (
    base_balance,
    base_block_number,
    base_gas_price,
    base_token_balance,
    crewai_tools,
    crypto_funding,
    crypto_prices,
    defi_yields,
    market_brief,
)

__version__ = "0.3.1"

__all__ = [
    "crewai_tools",
    "defi_yields",
    "crypto_prices",
    "base_balance",
    "base_gas_price",
    "base_block_number",
    "base_token_balance",
    "crypto_funding",
    "market_brief",
    "has_wallet",
    "make_pay_get",
    "DATA_BASE",
    "BASE_USDC",
    "__version__",
]
