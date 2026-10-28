"""x402-paying HTTP getter for the Grey Ridge data tools.

The paid path signs a per-call USDC payment on Base with the agent's OWN wallet
(no API key, no account, no subscription). It is built lazily from the official
Coinbase ``x402`` SDK (``x402[requests]`` + ``x402[evm]``) so that a keyless /
preview-only install needs none of ``x402``, ``eth_account`` or ``web3``.

If no private key is configured, or the x402 SDK is not installed, this returns
the stdlib keyless getter and the tools degrade open to the free /preview tier.
"""

from __future__ import annotations

import os
from typing import Any, Optional, Tuple

from .data import PayGet, plain_get

_cached: Optional[PayGet] = None


def _resolve_key(private_key: Optional[str]) -> Optional[str]:
    key = private_key or os.environ.get("PRIVATE_KEY") or os.environ.get("X402_PRIVATE_KEY")
    if not key:
        return None
    key = key.strip()
    return key or None


def has_wallet(private_key: Optional[str] = None) -> bool:
    """True when a Base private key is available (paid tier reachable)."""
    return _resolve_key(private_key) is not None


def make_pay_get(private_key: Optional[str] = None) -> PayGet:
    """Return a ``(url) -> (status, json|None)`` getter.

    With a key + the x402 SDK installed, hits the paid route and settles the
    USDC payment inline. Otherwise returns the stdlib keyless getter (preview
    tier) so the caller degrades open rather than failing.
    """
    global _cached
    key = _resolve_key(private_key)
    if not key:
        return plain_get
    if _cached is not None:
        return _cached

    try:
        # Official Coinbase x402 SDK — requests transport + EVM signer.
        from eth_account import Account  # type: ignore
        from x402.clients.requests import x402_requests  # type: ignore

        account = Account.from_key(key)
        session = x402_requests(account)

        def _get(url: str) -> Tuple[int, Optional[Any]]:
            try:
                resp = session.get(
                    url, headers={"accept": "application/json",
                                  "user-agent": "grey-ridge-x402-data/py"}, timeout=30)
                status = resp.status_code
                try:
                    return status, resp.json()
                except ValueError:
                    return status, None
            except Exception:  # noqa: BLE001 — degrade to preview on any transport error
                return 0, None

        _cached = _get
        return _get
    except Exception:  # noqa: BLE001 — SDK missing / API drift → keyless
        # A wallet was configured but the paid rail is unavailable in this
        # environment; fall back to keyless so the tools still work (preview).
        return plain_get
