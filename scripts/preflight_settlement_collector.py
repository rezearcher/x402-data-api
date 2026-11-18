"""Offline collector that builds the /x402/preflight attribution adapter's input
from on-chain evidence + seller-side PAID delivery rows.

The adapter (scripts/preflight_attribution.py) is a fail-closed CONTRACT EVALUATOR:
it trusts its coverage/cohort flags as upstream assertions. This module is the
missing COLLECTOR half that actually *produces* those assertions — honestly —
from two sources:

  1. The chain: every inbound USDC Transfer log to our payTo over an exact,
     half-open [start_block, end_block) range is the COMPLETE settlement set for
     that range (vet402 methodology, 2026-11-18: completeness proof is the chain,
     not the seller's own log). Public Base RPCs cap eth_getLogs ranges, so the
     range is walked in bounded chunks and ANY unreadable/again-capped chunk makes
     chain_blocks_complete False. Finality is 32 confirmations.

  2. The seller: PAID delivery rows captured by buildPaidDeliveryRecord()
     (src/index.ts, commit d46d072) carry {path, payer, tx, nonce, auth_value,
     delivery_id, ts}. The EIP-3009 authorization nonce binds a specific
     settlement to a specific route delivery — the one field vet402 uses to
     disambiguate several same-price transfers in one window.

The collector reads chain evidence through an injected `chain` interface so it is
deterministic under fixtures AND runnable live against a real Base RPC with the
identical bounded-pagination logic. It never fabricates a coverage flag: a flag is
True only when the collector actually established it. On real current data several
flags are expected to be False (finite Workers-Logs retention, no refund
enumeration) and the downstream adapter will correctly return status=unavailable.

All amounts are atomic USDC integers on the wire and exact Decimal strings in the
emitted rows. No amount is inferred from a catalog price. USDC on Base only.
"""
from decimal import Decimal

ROUTE = "/x402/preflight"
CHAIN_ID = 8453
USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"
USDC_DECIMALS = 6
CONFIRMATIONS = 32  # vet402 EVM finality
DEFAULT_CHUNK = 5000  # getLogs block span per page (public-RPC safe)
# A page returning >= this many logs is assumed provider-truncated and the range
# incomplete. USDC on a dedicated payTo is sparse; a dense page means a cap was hit.
PAGE_LOG_CAP = 10000

_COVERAGE_FIELDS = (
    "chain_blocks_complete", "chain_finalized", "block_time_boundaries_verified",
    "delivery_pages_complete", "delivery_not_truncated", "delivery_retention_complete",
    "delivery_export_lossless", "settlement_delivery_unique_linkage",
    "refund_coverage_complete",
)


def _atomic_to_usdc(atomic):
    """Exact atomic-USDC int -> 6-dp Decimal string (never float)."""
    return str(Decimal(int(atomic)) / Decimal(10 ** USDC_DECIMALS))


def collect(window, chain, paid_rows, cohort,
            refund_sources=None,
            variable_costs_atomic=None, variable_cost_evidence_refs=None):
    """Produce the adapter input dict (or an honest partial with False flags).

    Every coverage flag is derived from on-chain evidence + the seller's PAID-row
    nonces. NO flag is taken as an operator assertion:

      * refund_coverage_complete: the COMPLETE refund set is the outbound USDC
        Transfer logs FROM payTo (and any declared refund_sources) TO an in-window
        payer, read with the same bounded pagination; no operator refund LIST.
        (CDP x402 FAQ 2026: a refund is a new transfer back to the payer from the
        settlement wallet.) Residual limit: a refund paid from a wallet other than
        payTo is only captured if that wallet is named in refund_sources.
      * delivery_export_lossless / delivery_retention_complete: a RECONCILIATION —
        every in-window customer settlement nonce (payer not a known non-customer)
        must have exactly one route-matched PAID row. Zero unmatched settlements is
        independent evidence the export lost nothing for settled deliveries
        (vet402 methodology 2026-11-18: completeness is proven from the chain side).

    window: {start_utc,end_utc,start_block,end_block,chain_id,payto}
    chain:  object exposing
              head_block() -> int
              block_timestamp(block) -> int (utc seconds)
              transfer_pages(payto, start_block, end_block, chunk) -> iterator of
                  {"ok":bool,"from":int,"to":int,"logs":[{"tx":str,"log_index":int,
                     "block_number":int,"from":str,"amount_atomic":int}]}
              outbound_transfer_pages(source, start_block, end_block, chunk) ->
                  iterator of the same page shape but each log carries "to":str
                  (the recipient) instead of "from".
              tx_authorization_nonce(tx) -> nonce hex str or None
    paid_rows: list of PAID delivery records (buildPaidDeliveryRecord shape)
    cohort:  {version, evidence_refs, addresses:{addr:class}}
    refund_sources: optional {version, evidence_refs, addresses:[...]} — wallets
                  besides payTo that may originate refunds. Default None asserts the
                  payTo-only refund model explicitly in evidence_refs, not silently.
    Returns a dict ready for preflight_attribution.evaluate().
    """
    out = {
        "window": dict(window or {}),
        "coverage": {f: False for f in _COVERAGE_FIELDS},
        "cohort": cohort or {},
        "settlements": [], "deliveries": [], "refunds": [],
    }
    cov = out["coverage"]
    evidence = []

    # --- window sanity (the adapter re-checks; we must not emit nonsense) ---
    try:
        a = int(window["start_utc"])
        b = int(window["end_utc"])
        lo = int(window["start_block"])
        hi = int(window["end_block"])
    except (KeyError, TypeError, ValueError):
        out["collector_error"] = "invalid_window"
        return out
    if a >= b or lo >= hi or window.get("chain_id") != CHAIN_ID:
        out["collector_error"] = "invalid_window"
        return out

    # --- finality: window end must be buried by CONFIRMATIONS blocks ---
    head = int(chain.head_block())
    cov["chain_finalized"] = hi <= head - CONFIRMATIONS
    evidence.append(f"head_block={head};confirmations={CONFIRMATIONS}")

    # --- boundary verification: the chosen blocks must straddle the UTC window ---
    ts_lo = int(chain.block_timestamp(lo))
    ts_hi = int(chain.block_timestamp(hi))
    cov["block_time_boundaries_verified"] = (ts_lo == a and ts_hi == b)
    evidence.append(f"block_time[{lo}]={ts_lo};block_time[{hi}]={ts_hi}")

    # --- complete settlement set: paginate inbound USDC transfers to payTo ---
    payto = str(window.get("payto") or "").lower()
    pages_ok = True
    not_truncated = True
    raw = []
    if not payto:
        cov_err = "missing_payto"
        out["collector_error"] = cov_err
        return out
    for page in chain.transfer_pages(payto, lo, hi, DEFAULT_CHUNK):
        if not page.get("ok"):
            pages_ok = False
            evidence.append(f"page[{page.get('from')},{page.get('to')}]=UNREADABLE")
            continue
        logs = page.get("logs") or []
        if len(logs) >= PAGE_LOG_CAP:
            not_truncated = False
            evidence.append(f"page[{page.get('from')},{page.get('to')}]=CAP:{len(logs)}")
        raw.extend(logs)
    cov["chain_blocks_complete"] = pages_ok
    cov["delivery_not_truncated"] = not_truncated
    # The chain set is itself the delivery-page source for settlements.
    cov["delivery_pages_complete"] = pages_ok

    # --- index PAID rows by nonce (route-bound, from the seller side) ---
    paid_by_nonce = {}
    for r in (paid_rows or []):
        n = r.get("nonce")
        if isinstance(n, str) and n:
            paid_by_nonce[n.lower()] = r

    # --- build settlements + nonce-linked deliveries; fail linkage closed ---
    classes = {str(k).lower(): v for k, v in (cohort.get("addresses") or {}).items()}
    linkage_ok = True
    seen_keys = set()
    nonce_by_key = {}          # settlement key -> on-chain EIP-3009 nonce (cached; no 2nd RPC)
    payer_delivery = {}        # payer -> [settlement keys that got a route delivery]
    for lg in raw:
        tx = str(lg.get("tx", "")).lower()
        li = lg.get("log_index")
        blk = lg.get("block_number")
        payer = str(lg.get("from", "")).lower()
        atomic = lg.get("amount_atomic")
        if not (isinstance(tx, str) and len(tx) == 66 and type(li) is int and type(blk) is int
                and type(atomic) is int and atomic >= 0 and payer):
            linkage_ok = False
            evidence.append(f"malformed_transfer_log:{tx[:12]}")
            continue
        if not (lo <= blk < hi):
            continue  # defence-in-depth: provider returned an out-of-range log
        k = (CHAIN_ID, tx, li)
        if k in seen_keys:
            # duplicate (tx, log) from overlapping pages -> collapse; the adapter
            # also rejects conflicting duplicates, so emitting once is correct.
            continue
        seen_keys.add(k)
        ts = int(chain.block_timestamp(blk))
        settlement = {
            "chain_id": CHAIN_ID, "tx": tx, "log_index": li,
            "finalized": blk <= head - CONFIRMATIONS, "success": True, "asset": "USDC",
            "amount_usdc": _atomic_to_usdc(atomic), "payer": payer,
            "block_number": blk, "timestamp_utc": ts,
        }
        out["settlements"].append(settlement)

        # Bind this settlement to a route delivery via the EIP-3009 nonce.
        nonce = chain.tx_authorization_nonce(tx)
        nonce_by_key[k] = nonce.lower() if isinstance(nonce, str) and nonce else None
        pr = paid_by_nonce.get(nonce.lower()) if isinstance(nonce, str) and nonce else None
        if pr is not None and pr.get("path") == ROUTE:
            # amount cross-check: signed authorized value vs on-chain transfer
            try:
                auth_ok = int(pr.get("auth_value")) == atomic
            except (TypeError, ValueError):
                auth_ok = False
            if not auth_ok:
                linkage_ok = False
                evidence.append(f"auth_value_mismatch:{tx[:12]}")
                continue
            did = pr.get("delivery_id") or nonce
            out["deliveries"].append({
                "route": ROUTE, "chain_id": CHAIN_ID, "tx": tx, "log_index": li,
                "delivered": True, "delivery_id": did, "timestamp_utc": ts,
            })
            payer_delivery.setdefault(payer, []).append(k)
        else:
            # No route delivery links to this inbound settlement. That is only
            # acceptable if the payer is a *known* non-customer (owner/operator/
            # sweep). An unknown, unlinked inbound transfer means our window
            # contains money we cannot attribute -> linkage is NOT complete.
            cls = classes.get(payer, "unknown")
            if cls in ("owner", "operator", "sweep"):
                continue
            linkage_ok = False
            evidence.append(f"unattributed_inbound:{tx[:12]}:payer_class={cls}")

    cov["settlement_delivery_unique_linkage"] = linkage_ok

    # --- lossless/retention RECONCILIATION (chain vs seller export, no say-so) ---
    # Every in-window CUSTOMER settlement (payer not a known non-customer) must have
    # exactly one route-matched PAID row by nonce. Zero unmatched = the export lost
    # nothing for settled deliveries. Can only be asserted when the chain scan that
    # produced the settlement set is itself complete + finalized.
    unmatched = 0
    for s in out["settlements"]:
        if classes.get(s["payer"], "unknown") in ("owner", "operator", "sweep"):
            continue
        k = (CHAIN_ID, s["tx"], s["log_index"])
        n = nonce_by_key.get(k)
        pr = paid_by_nonce.get(n) if n else None
        if pr is None or pr.get("path") != ROUTE:
            unmatched += 1
            evidence.append(f"export_missing_settlement:{s['tx'][:12]}")
    reconciled = (unmatched == 0) and pages_ok and cov["chain_finalized"]
    cov["delivery_export_lossless"] = reconciled
    cov["delivery_retention_complete"] = reconciled
    evidence.append(f"reconciliation:unmatched_customer_settlements={unmatched}")

    # --- refunds: the COMPLETE set is chain-derived, never an operator list ---
    # A refund = outbound USDC Transfer FROM payTo (or a declared refund source) TO
    # an address that paid us in this window. Attribute each to that payer's single
    # in-window route delivery; an ambiguous or unresolved refund fails the flag.
    refund_srcs = [payto]
    if refund_sources:
        for addr in (refund_sources.get("addresses") or []):
            a_ = str(addr).lower()
            if a_ and a_ not in refund_srcs:
                refund_srcs.append(a_)
        for ref in (refund_sources.get("evidence_refs") or []):
            if isinstance(ref, str) and ref:
                evidence.append(f"refund_source:{ref}")
        evidence.append(f"refund_source_version:{refund_sources.get('version') or 'unversioned'}")
    else:
        evidence.append("refund_source_assumption:payto_only")

    refund_pages_ok = True
    refunds_resolved = True
    refund_rows = []
    refund_seen = set()
    for src in refund_srcs:
        for page in chain.outbound_transfer_pages(src, lo, hi, DEFAULT_CHUNK):
            if not page.get("ok"):
                refund_pages_ok = False
                evidence.append(f"refund_page[{page.get('from')},{page.get('to')}]=UNREADABLE")
                continue
            logs = page.get("logs") or []
            if len(logs) >= PAGE_LOG_CAP:
                refund_pages_ok = False
                evidence.append(f"refund_page[{page.get('from')},{page.get('to')}]=CAP:{len(logs)}")
            for lg in logs:
                rtx = str(lg.get("tx", "")).lower()
                rli = lg.get("log_index")
                rblk = lg.get("block_number")
                to_addr = str(lg.get("to", "")).lower()
                ratomic = lg.get("amount_atomic")
                if not (len(rtx) == 66 and type(rli) is int and type(rblk) is int
                        and type(ratomic) is int and ratomic >= 0 and to_addr):
                    refunds_resolved = False
                    evidence.append(f"malformed_refund_log:{rtx[:12]}")
                    continue
                if not (lo <= rblk < hi):
                    continue
                if to_addr not in payer_delivery:
                    continue  # outbound to a non-customer = operational outflow, not a refund
                rk = (CHAIN_ID, rtx, rli)
                if rk in refund_seen:
                    continue
                refund_seen.add(rk)
                keys = payer_delivery[to_addr]
                if len(keys) != 1:
                    # payer has 0 or >1 in-window deliveries -> cannot attribute this
                    # refund to one original settlement without guessing.
                    refunds_resolved = False
                    evidence.append(f"refund_attribution_ambiguous:{to_addr[:10]}:n={len(keys)}")
                    continue
                okey = keys[0]
                refund_rows.append({
                    "chain_id": CHAIN_ID, "tx": rtx, "log_index": rli,
                    "finalized": rblk <= head - CONFIRMATIONS, "success": True, "asset": "USDC",
                    "amount_usdc": _atomic_to_usdc(ratomic),
                    "block_number": rblk, "timestamp_utc": int(chain.block_timestamp(rblk)),
                    "original_settlement": {"chain_id": CHAIN_ID, "tx": okey[1], "log_index": okey[2]},
                })
    out["refunds"] = refund_rows
    cov["refund_coverage_complete"] = refund_pages_ok and refunds_resolved

    # --- coverage evidence + optional cost passthrough ---
    cov["evidence_refs"] = evidence
    if variable_costs_atomic is not None:
        out["variable_costs_usdc"] = _atomic_to_usdc(variable_costs_atomic)
        if variable_cost_evidence_refs:
            out["variable_cost_evidence_refs"] = list(variable_cost_evidence_refs)
    return out


# --- live Base-chain reader (bounded pagination; free public RPC) --------------
class LiveBaseChain:
    """Read-only Base reader with the identical bounded pagination the offline
    collector needs. Used for a real run; tests inject a fixture instead. Makes no
    payment and holds no key. getLogs is chunked so a provider range-cap surfaces
    as an UNREADABLE page (ok=False) rather than a silent gap."""
    TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
    AUTH_USED = "0x98de503528ee59b575ef0c0a2576a82497bfc029a5685b209e9ec333479b10a5"  # AuthorizationUsed(address,bytes32)

    def __init__(self, rpc_urls):
        self.rpcs = list(rpc_urls)

    def _rpc(self, method, params):
        import json
        import urllib.request
        last = None
        for u in self.rpcs:
            try:
                req = urllib.request.Request(
                    u, data=json.dumps({"jsonrpc": "2.0", "id": 1,
                                        "method": method, "params": params}).encode(),
                    headers={"Content-Type": "application/json"})
                with urllib.request.urlopen(req, timeout=25) as r:
                    out = json.load(r)
                if "result" in out:
                    return out["result"]
                last = out.get("error")
            except Exception as e:  # noqa: BLE001 - any RPC failure -> next provider
                last = str(e)
        raise RuntimeError(f"rpc_failed:{method}:{last}")

    def head_block(self):
        return int(self._rpc("eth_blockNumber", []), 16)

    def block_timestamp(self, block):
        b = self._rpc("eth_getBlockByNumber", [hex(int(block)), False])
        return int(b["timestamp"], 16)

    def transfer_pages(self, payto, start_block, end_block, chunk):
        to_topic = "0x" + "0" * 24 + payto[2:].lower()
        frm = start_block
        while frm < end_block:
            to = min(frm + chunk, end_block)
            params = [{"address": USDC, "fromBlock": hex(frm), "toBlock": hex(to - 1),
                       "topics": [self.TRANSFER, None, to_topic]}]
            # ONLY the network/range-cap call degrades to an unreadable page. Log
            # parsing lives OUTSIDE the except so a genuine shape bug surfaces as an
            # error rather than a silent "incomplete" (probe-exception discipline).
            try:
                logs = self._rpc("eth_getLogs", params)
            except RuntimeError:  # range cap / provider error = unreadable page
                yield {"ok": False, "from": frm, "to": to, "logs": []}
                frm = to
                continue
            yield {"ok": True, "from": frm, "to": to, "logs": [
                {"tx": lg["transactionHash"].lower(),
                 "log_index": int(lg["logIndex"], 16),
                 "block_number": int(lg["blockNumber"], 16),
                 "from": "0x" + lg["topics"][1][-40:],
                 "amount_atomic": int(lg["data"], 16)}
                for lg in logs]}
            frm = to

    def outbound_transfer_pages(self, source, start_block, end_block, chunk):
        """Outbound USDC transfers FROM `source` (topic1), recipient in each log's
        "to". Same bounded pagination + unreadable-page discipline as inbound; this
        is the chain-side refund scan (a refund is a transfer back to the payer)."""
        from_topic = "0x" + "0" * 24 + str(source)[2:].lower()
        frm = start_block
        while frm < end_block:
            to = min(frm + chunk, end_block)
            params = [{"address": USDC, "fromBlock": hex(frm), "toBlock": hex(to - 1),
                       "topics": [self.TRANSFER, from_topic, None]}]
            try:
                logs = self._rpc("eth_getLogs", params)
            except RuntimeError:
                yield {"ok": False, "from": frm, "to": to, "logs": []}
                frm = to
                continue
            yield {"ok": True, "from": frm, "to": to, "logs": [
                {"tx": lg["transactionHash"].lower(),
                 "log_index": int(lg["logIndex"], 16),
                 "block_number": int(lg["blockNumber"], 16),
                 "to": "0x" + lg["topics"][2][-40:],
                 "amount_atomic": int(lg["data"], 16)}
                for lg in logs]}
            frm = to

    def tx_authorization_nonce(self, tx):
        rcpt = self._rpc("eth_getTransactionReceipt", [tx])
        if not rcpt:
            return None
        for lg in rcpt.get("logs", []):
            topics = lg.get("topics") or []
            if topics and topics[0].lower() == self.AUTH_USED and len(topics) >= 3:
                return topics[2].lower()  # indexed nonce (bytes32)
        return None
