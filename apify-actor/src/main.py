"""
Grey Ridge — Base On-Chain Data Proxy (Apify Actor)

Queries Base mainnet on-chain data via the Grey Ridge x402 API free preview
endpoints (gas price, block number) and direct public JSON-RPC (ETH balance,
ERC-20 token balance).  No API key or x402 wallet required — $0.001/run via
Apify's built-in x402 integration.

Output: one dataset entry per wallet, plus a metadata entry for gas/block data.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field, asdict
from typing import Any

import httpx
from apify import Actor

# ── x402-data-api base URL (Cloudflare Worker) ──────────────────────────────
X402_BASE = "https://x402-data-api.sigrunner.workers.dev"

# ── Base mainnet public RPC endpoints (same set as x402-data-api backend) ──
BASE_RPCS = [
    "https://mainnet.base.org",
    "https://base.llamarpc.com",
    "https://base-rpc.publicnode.com",
    "https://base.drpc.org",
]

# ── Standard ERC-20 ABI snippets (for eth_call balanceOf / decimals / symbol) ──
BALANCE_OF_CALL = {
    "jsonrpc": "2.0",
    "id": 1,
    "method": "eth_call",
    "params": [],
}
# 0x70a08231 = keccak256("balanceOf(address)")
BALANCE_OF_DATA_TPL = "0x70a08231000000000000000000000000{addr_hex}"
# 0x313ce567 = keccak256("decimals()")
DECIMALS_DATA = "0x313ce567"
# 0x95d89b41 = keccak256("symbol()")
SYMBOL_DATA = "0x95d89b41"


# ── Result types ────────────────────────────────────────────────────────────


@dataclass
class GasPriceResult:
    gas_price_wei: int
    gas_price_gwei: float
    base_fee_gwei: float | None
    priority_fee_gwei: float | None
    chain: str = "base"
    source: str = "x402-api-preview"


@dataclass
class BlockNumberResult:
    block_number: int
    chain: str = "base"
    source: str = "x402-api-preview"


@dataclass
class BalanceResult:
    address: str
    balance_eth: float
    balance_wei: str
    balance_usd: float | None
    chain: str = "base"


@dataclass
class TokenBalanceResult:
    address: str
    token: str
    symbol: str
    decimals: int
    balance_raw: str
    balance_formatted: float
    chain: str = "base"


@dataclass
class RunOutput:
    meta: dict[str, Any] = field(default_factory=dict)
    balances: list[dict[str, Any]] = field(default_factory=list)
    token_balances: list[dict[str, Any]] = field(default_factory=list)
    errors: list[dict[str, Any]] = field(default_factory=list)


# ── HTTP helpers ────────────────────────────────────────────────────────────


def _rpc_call(client: httpx.Client, method: str, params: list[Any]) -> Any | None:
    """Call a JSON-RPC method against Base RPC endpoints with failover."""
    for url in BASE_RPCS:
        try:
            resp = client.post(
                url,
                json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params},
                timeout=10,
            )
            data = resp.json()
            if "result" in data and data["result"] is not None:
                return data["result"]
        except Exception:
            continue
    return None


def _eth_call(
    client: httpx.Client, to: str, data: str, block: str = "latest"
) -> str | None:
    """Perform eth_call against a contract address on Base."""
    params = [{"to": to, "data": data}, block]
    result = _rpc_call(client, "eth_call", params)
    return result if isinstance(result, str) else None


def _hex_to_int(hex_str: str) -> int:
    return int(hex_str, 16)


# ── Data fetchers ───────────────────────────────────────────────────────────


def fetch_gas_price(client: httpx.Client) -> GasPriceResult | None:
    """Fetch current Base gas price via the x402 free preview endpoint."""
    try:
        resp = client.get(f"{X402_BASE}/chain/gas-price/preview", timeout=10)
        resp.raise_for_status()
        data = resp.json()
        return GasPriceResult(
            gas_price_wei=data.get("gas_price_wei", 0),
            gas_price_gwei=data.get("gas_price_gwei", 0.0),
            base_fee_gwei=data.get("base_fee_gwei"),
            priority_fee_gwei=data.get("priority_fee_gwei"),
        )
    except Exception as exc:
        Actor.log.warning("gas-price preview failed: %s", exc)
        return None


def fetch_block_number(client: httpx.Client) -> BlockNumberResult | None:
    """Fetch latest Base block number via the x402 free preview endpoint."""
    try:
        resp = client.get(f"{X402_BASE}/chain/block-number/preview", timeout=10)
        resp.raise_for_status()
        data = resp.json()
        return BlockNumberResult(block_number=data.get("block_number", 0))
    except Exception as exc:
        Actor.log.warning("block-number preview failed: %s", exc)
        return None


def fetch_eth_balance(client: httpx.Client, address: str) -> BalanceResult | None:
    """Fetch native ETH balance for a Base address via direct RPC."""
    addr_hex = address.lower().removeprefix("0x").zfill(40)
    data = _rpc_call(client, "eth_getBalance", [address, "latest"])
    if data is None:
        return None

    wei_hex = data
    wei_int = _hex_to_int(wei_hex)
    eth = wei_int / 1e18

    # Try to get an ETH/USD price (internal cross-call to x402)
    usd_price = _fetch_eth_usd(client)

    return BalanceResult(
        address=address,
        balance_eth=round(eth, 6),
        balance_wei=str(wei_int),
        balance_usd=round(eth * usd_price, 2) if usd_price else None,
    )


def fetch_token_balance(
    client: httpx.Client, address: str, token: str
) -> TokenBalanceResult | None:
    """Fetch ERC-20 token balance for a Base address via direct RPC."""
    addr_hex = address.lower().removeprefix("0x").zfill(40)
    token_lower = token.lower()

    balance_data = BALANCE_OF_DATA_TPL.format(addr_hex=addr_hex)
    balance_hex = _eth_call(client, token_lower, balance_data)
    if balance_hex is None or balance_hex == "0x":
        Actor.log.warning("balanceOf failed for %s on token %s", address, token)
        return None

    symbol_hex = _eth_call(client, token_lower, SYMBOL_DATA)
    symbol = _decode_string(symbol_hex) if symbol_hex else "UNKNOWN"

    decimals_hex = _eth_call(client, token_lower, DECIMALS_DATA)
    decimals = _hex_to_int(decimals_hex) if decimals_hex else 18

    balance_raw = str(_hex_to_int(balance_hex))
    balance_formatted = int(balance_raw) / (10**decimals) if decimals else 0

    return TokenBalanceResult(
        address=address,
        token=token,
        symbol=symbol,
        decimals=decimals,
        balance_raw=balance_raw,
        balance_formatted=round(balance_formatted, 6),
    )


def _decode_string(hex_str: str) -> str:
    """Decode a hex-encoded string (e.g. 0x55534443 -> 'USDC')."""
    try:
        raw = bytes.fromhex(hex_str.removeprefix("0x"))
        # ERC-20 symbol() returns bytes32 padded — strip nulls
        return raw.rstrip(b"\x00").decode("utf-8", errors="replace")
    except Exception:
        return "UNKNOWN"


def _fetch_eth_usd(client: httpx.Client) -> float | None:
    """Get ETH/USD price from x402 crypto prices preview.

    The /preview endpoint always returns a fixed 1-coin sample (BTC).
    For actual ETH/USD, use the paid /crypto/prices?coins=ethereum endpoint.
    This function correctly parses both the preview and paid response shapes.
    """
    try:
        resp = client.get(
            f"{X402_BASE}/crypto/prices/preview?coins=ethereum", timeout=10
        )
        resp.raise_for_status()
        data = resp.json()

        # Preview shape: {"preview": [{"id": "bitcoin", "price": 63900, ...}]}
        preview = data.get("preview") if isinstance(data, dict) else data
        if isinstance(preview, list) and len(preview) > 0:
            coin = preview[0]
            # Return price regardless of coin ID (preview only returns BTC;
            # the paid endpoint returns the requested coin)
            raw = coin.get("price") or coin.get("usd")
            return float(raw) if raw else None

        # Dict-cased map shape (paid endpoint alternative)
        if isinstance(data, dict):
            for coin in data.values():
                if isinstance(coin, dict):
                    raw = coin.get("price") or coin.get("usd")
                    return float(raw) if raw else None

        return None
    except Exception:
        return None


# ── Actor entry point ───────────────────────────────────────────────────────


async def main() -> None:
    async with Actor:
        actor_input = await Actor.get_input() or {}

        wallets: list[str] = actor_input.get("wallets", [])
        tokens: list[str] = actor_input.get("tokens", [])
        include_gas = actor_input.get("includeGasPrice", True)
        include_block = actor_input.get("includeBlockNumber", True)
        perform_security = actor_input.get("performTokenSecurityCheck", False)

        output = RunOutput()
        output.meta["run_timestamp"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        output.meta["chain"] = "base"
        output.meta["network_id"] = "eip155:8453"

        Actor.log.info(
            "Starting run: %d wallets, %d tokens, gas=%s, block=%s, security=%s",
            len(wallets), len(tokens), include_gas, include_block, perform_security,
        )

        with httpx.Client(
            headers={"User-Agent": "grey-ridge-apify-actor/0.1.0"},
            timeout=15,
        ) as client:

            # ── 1. Gas price (free x402 preview) ──
            if include_gas:
                gas = fetch_gas_price(client)
                if gas:
                    output.meta["gas_price"] = asdict(gas)
                    Actor.log.info("Gas price: %.2f gwei", gas.gas_price_gwei)

            # ── 2. Block number (free x402 preview) ──
            if include_block:
                block = fetch_block_number(client)
                if block:
                    output.meta["block_number"] = asdict(block)
                    Actor.log.info("Block number: %d", block.block_number)

            # ── 3. Wallet balances ──
            for wallet in wallets:
                wallet = wallet.strip()
                if not wallet.startswith("0x"):
                    output.errors.append({
                        "wallet": wallet,
                        "error": "Invalid address — must be 0x-prefixed",
                    })
                    continue

                balance = fetch_eth_balance(client, wallet)
                if balance:
                    entry = asdict(balance)
                    output.balances.append(entry)
                    Actor.log.info(
                        "%s: %.4f ETH%s",
                        wallet,
                        balance.balance_eth,
                        f" (${balance.balance_usd})" if balance.balance_usd else "",
                    )
                else:
                    output.errors.append({
                        "wallet": wallet,
                        "error": "ETH balance fetch failed (RPC unreachable)",
                    })

                # ── 4. Per-wallet token balances ──
                for token in tokens:
                    token = token.strip()
                    if not token.startswith("0x"):
                        output.errors.append({
                            "wallet": wallet,
                            "token": token,
                            "error": "Invalid token address — must be 0x-prefixed",
                        })
                        continue

                    tb = fetch_token_balance(client, wallet, token)
                    if tb:
                        entry = asdict(tb)
                        output.token_balances.append(entry)
                        Actor.log.info(
                            "  %s → %s: %.4f %s",
                            wallet,
                            token[:10] + "…",
                            tb.balance_formatted,
                            tb.symbol,
                        )
                    else:
                        output.errors.append({
                            "wallet": wallet,
                            "token": token,
                            "error": "Token balance fetch failed (RPC unreachable or invalid token)",
                        })

        # ── Push results to dataset ──
        if output.balances:
            await Actor.push_data({
                "type": "eth_balance",
                "results": output.balances,
                "meta": {
                    "block_number": output.meta.get("block_number", {}).get("block_number"),
                    "run_timestamp": output.meta["run_timestamp"],
                },
            })

        if output.token_balances:
            await Actor.push_data({
                "type": "token_balance",
                "results": output.token_balances,
                "meta": {
                    "block_number": output.meta.get("block_number", {}).get("block_number"),
                    "run_timestamp": output.meta["run_timestamp"],
                },
            })

        if output.errors:
            await Actor.push_data({
                "type": "errors",
                "results": output.errors,
                "meta": {"run_timestamp": output.meta["run_timestamp"]},
            })

        if include_gas or include_block or perform_security:
            await Actor.push_data({
                "type": "metadata",
                **output.meta,
            })

        # ── Set key-value store output ──
        await Actor.set_value("OUTPUT", {
            "status": "completed",
            "wallets_queried": len(wallets),
            "tokens_queried": len(tokens),
            "balances_found": len(output.balances),
            "token_balances_found": len(output.token_balances),
            "errors": len(output.errors),
            "meta": output.meta,
        })

        Actor.log.info(
            "Run complete: %d balances, %d token balances, %d errors",
            len(output.balances),
            len(output.token_balances),
            len(output.errors),
        )


if __name__ == "__main__":
    Actor.main(main())
