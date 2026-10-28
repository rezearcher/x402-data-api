"""Plain function API + CrewAI tool wrappers for the Grey Ridge data lane.

The plain functions (``defi_yields``, ``crypto_prices``, ``base_balance``,
``base_gas_price``, ``base_block_number``, ``base_token_balance``) depend only on
the standard library + (optionally) the x402 SDK — any Python agent can import
and call them. ``crewai_tools()`` lazily wraps them as ``crewai.tools.BaseTool``
instances for a CrewAI crew.

Every function returns a plain ``dict`` and NEVER raises into the agent loop; a
true outage is reported as ``{"error": ...}`` and an unfunded wallet degrades
open to the free preview tier (or an honest activation stub for live reads with
no preview).
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

from . import data as _d
from .client import has_wallet, make_pay_get


def _ctx(private_key: Optional[str]) -> Dict[str, Any]:
    return {"pay_get": make_pay_get(private_key), "has_key": has_wallet(private_key)}


# ---------------------------------------------------------------------------
# Plain function API (framework-agnostic)
# ---------------------------------------------------------------------------
def defi_yields(limit: int = 20, project: Optional[str] = None,
                chain: Optional[str] = None, stable: Any = None,
                sort: str = "tvl", *, private_key: Optional[str] = None,
                base: str = _d.DATA_BASE) -> Dict[str, Any]:
    """Top DeFi lending/LP pools (DefiLlama): APY, trend, IL risk, TVL. $0.001."""
    c = _ctx(private_key)
    return _d.run_yields(c["pay_get"], has_key=c["has_key"], limit=limit,
                         project=project, chain=chain, stable=stable, sort=sort, base=base)


def crypto_prices(coins: Any, *, private_key: Optional[str] = None,
                  base: str = _d.DATA_BASE) -> Dict[str, Any]:
    """Spot price + 24h change for up to 25 CoinGecko ids. $0.001."""
    c = _ctx(private_key)
    return _d.run_prices(c["pay_get"], coins=coins, has_key=c["has_key"], base=base)


def base_balance(address: str, *, private_key: Optional[str] = None,
                 base: str = _d.DATA_BASE) -> Dict[str, Any]:
    """Native ETH balance + USD value for a Base address. $0.002 (no free preview)."""
    c = _ctx(private_key)
    return _d.run_balance(c["pay_get"], address=address, has_key=c["has_key"], base=base)


def base_gas_price(*, private_key: Optional[str] = None,
                   base: str = _d.DATA_BASE) -> Dict[str, Any]:
    """Base EIP-1559 gas (base/priority fee, gwei, USD). $0.002 — real value keyless."""
    c = _ctx(private_key)
    return _d.run_gas_price(c["pay_get"], has_key=c["has_key"], base=base)


def base_block_number(*, private_key: Optional[str] = None,
                      base: str = _d.DATA_BASE) -> Dict[str, Any]:
    """Current Base mainnet block height. $0.002 — real value keyless."""
    c = _ctx(private_key)
    return _d.run_block_number(c["pay_get"], has_key=c["has_key"], base=base)


def base_token_balance(address: str, token: Optional[str] = None, *,
                       private_key: Optional[str] = None,
                       base: str = _d.DATA_BASE) -> Dict[str, Any]:
    """ERC-20 balance of a Base address (token defaults to USDC). $0.002 — real value keyless."""
    c = _ctx(private_key)
    return _d.run_token_balance(c["pay_get"], address=address, token=token,
                                has_key=c["has_key"], base=base)


# ---------------------------------------------------------------------------
# CrewAI tool wrappers (lazy import — crewai only required for crewai_tools())
# ---------------------------------------------------------------------------
def crewai_tools(private_key: Optional[str] = None) -> List[Any]:
    """Build the Grey Ridge data tools as CrewAI ``BaseTool`` instances.

    ``private_key`` is optional — omit it (or leave ``PRIVATE_KEY`` unset) to run
    the crew on the free preview tier. Requires ``crewai`` installed; install
    with the ``[crewai]`` extra.
    """
    try:
        from crewai.tools import BaseTool  # type: ignore
        from pydantic import BaseModel, Field  # type: ignore
    except Exception as err:  # noqa: BLE001
        raise ImportError(
            "crewai_tools() needs CrewAI installed: pip install "
            "'grey-ridge-x402-data[crewai]' (or 'crewai'). The plain functions "
            "(defi_yields, crypto_prices, …) work without CrewAI."
        ) from err

    pk = private_key

    class _YieldsArgs(BaseModel):
        limit: int = Field(20, description="Max pools to return (1–100).")
        project: Optional[str] = Field(None, description="Filter by protocol, e.g. 'aave-v3'.")
        chain: Optional[str] = Field(None, description="Filter by chain, e.g. 'Base'.")
        stable: Optional[bool] = Field(None, description="Only stablecoin pools.")
        sort: str = Field("tvl", description="'tvl' or 'risk_adjusted'.")

    class _PricesArgs(BaseModel):
        coins: str = Field(..., description="Comma-separated CoinGecko ids, e.g. 'bitcoin,ethereum'.")

    class _AddrArgs(BaseModel):
        address: str = Field(..., description="A 0x… Base address.")

    class _TokenBalArgs(BaseModel):
        address: str = Field(..., description="A 0x… Base address.")
        token: Optional[str] = Field(None, description="ERC-20 contract (defaults to USDC on Base).")

    class _NoArgs(BaseModel):
        pass

    def _emit(d: Dict[str, Any]) -> str:
        return json.dumps(d, default=str)

    class DefiYieldsTool(BaseTool):
        name: str = "defi_yields"
        description: str = ("Top DeFi lending/LP pools from DefiLlama (project, chain, symbol, "
                            "APY + trend, IL risk, TVL, risk-adjusted score). Paid $0.001/call "
                            "via x402 USDC on Base; degrades open to a free 1-pool preview.")
        args_schema: type = _YieldsArgs

        def _run(self, limit: int = 20, project: Optional[str] = None,
                 chain: Optional[str] = None, stable: Optional[bool] = None,
                 sort: str = "tvl") -> str:
            return _emit(defi_yields(limit=limit, project=project, chain=chain,
                                     stable=stable, sort=sort, private_key=pk))

    class CryptoPricesTool(BaseTool):
        name: str = "crypto_prices"
        description: str = ("Spot price + 24h change for up to 25 CoinGecko ids. Paid $0.001/call "
                            "via x402 USDC on Base; degrades open to a free 1-coin preview.")
        args_schema: type = _PricesArgs

        def _run(self, coins: str) -> str:
            return _emit(crypto_prices(coins, private_key=pk))

    class BaseBalanceTool(BaseTool):
        name: str = "base_balance"
        description: str = ("Native ETH balance + USD value for a Base address. Paid $0.002/call "
                            "via x402 USDC on Base; keyless returns an honest activation stub "
                            "(never a fabricated balance).")
        args_schema: type = _AddrArgs

        def _run(self, address: str) -> str:
            return _emit(base_balance(address, private_key=pk))

    class BaseGasPriceTool(BaseTool):
        name: str = "base_gas_price"
        description: str = ("Base EIP-1559 gas (base/priority fee in gwei + USD). Paid $0.002/call; "
                            "free preview carries the identical live value, so keyless returns the "
                            "real gas price.")
        args_schema: type = _NoArgs

        def _run(self) -> str:
            return _emit(base_gas_price(private_key=pk))

    class BaseBlockNumberTool(BaseTool):
        name: str = "base_block_number"
        description: str = ("Current Base mainnet block height. Paid $0.002/call; free preview "
                            "carries the identical live value, so keyless returns the real height.")
        args_schema: type = _NoArgs

        def _run(self) -> str:
            return _emit(base_block_number(private_key=pk))

    class BaseTokenBalanceTool(BaseTool):
        name: str = "base_token_balance"
        description: str = ("ERC-20 balance of a Base address (token defaults to USDC). Paid "
                            "$0.002/call; free preview returns the real balance for the queried "
                            "address, so keyless returns the true live value.")
        args_schema: type = _TokenBalArgs

        def _run(self, address: str, token: Optional[str] = None) -> str:
            return _emit(base_token_balance(address, token, private_key=pk))

    return [DefiYieldsTool(), CryptoPricesTool(), BaseBalanceTool(),
            BaseGasPriceTool(), BaseBlockNumberTool(), BaseTokenBalanceTool()]
