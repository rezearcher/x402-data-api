"""Round-trip tests: collector output -> real attribution adapter.

Each case drives scripts/preflight_settlement_collector.collect() with a fixture
chain, then feeds the emitted dict to scripts/preflight_attribution.evaluate() and
asserts the honest verdict. Fixture payments/transfers are NOT customer evidence;
these prove the join + completeness/finality/truncation + chain-derived refund and
reconciliation logic only.

Every coverage flag is derived from on-chain evidence here — there is no operator
refund list and no `retention_covers_window` assertion. Lossless/retention come
from a chain<->export reconciliation; refund coverage comes from outbound USDC
transfers FROM payTo.
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
import preflight_attribution as adapter  # noqa: E402
import preflight_settlement_collector as col  # noqa: E402


def tx(n):
    return "0x" + f"{n:064x}"


def nonce(n):
    return "0x" + f"{n:064x}"


IND_A = "0x" + "a1" * 20
IND_B = "0x" + "b2" * 20
SWEEP = "0x" + "cc" * 20
UNKNOWN = "0x" + "dd" * 20
PAYTO = "0x" + "57" * 20
OTHER_SRC = "0x" + "ee" * 20

START_UTC, END_UTC = 1_700_000_000, 1_700_100_000
LO, HI = 1_000_000, 1_050_000
HEAD = HI + 100  # finalized: HI <= HEAD-32


class FixtureChain:
    """Deterministic chain reader. `pages` is the exact list of inbound page dicts
    to yield. `outbound` maps source-addr -> list of outbound page dicts (refund
    scan). `ts_map` maps block->ts and KeyErrors (surfaces) on an unmapped block.
    `nonce_map` maps tx->nonce."""

    def __init__(self, head, ts_map, pages, nonce_map, outbound=None):
        self._head = head
        self._ts = ts_map
        self._pages = pages
        self._nonce = nonce_map
        self._outbound = {str(k).lower(): v for k, v in (outbound or {}).items()}

    def head_block(self):
        return self._head

    def block_timestamp(self, block):
        return self._ts[block]

    def transfer_pages(self, payto, start_block, end_block, chunk):
        for p in self._pages:
            yield p

    def outbound_transfer_pages(self, source, start_block, end_block, chunk):
        for p in self._outbound.get(str(source).lower(), []):
            yield p

    def tx_authorization_nonce(self, t):
        return self._nonce.get(t.lower())


def window(payto=PAYTO):
    return {"start_utc": START_UTC, "end_utc": END_UTC,
            "start_block": LO, "end_block": HI, "chain_id": 8453, "payto": payto}


def cohort(addresses):
    return {"version": "cohort-v1", "evidence_refs": ["ipfs://cohort"],
            "addresses": addresses}


def log(n, frm, blk, atomic, li=0):
    return {"tx": tx(n), "log_index": li, "block_number": blk,
            "from": frm, "amount_atomic": atomic}


def olog(n, to, blk, atomic, li=0):
    """Outbound (refund) transfer log: FROM payTo TO `to`."""
    return {"tx": tx(n), "log_index": li, "block_number": blk,
            "to": to, "amount_atomic": atomic}


def page(logs, frm=LO, to=HI, ok=True):
    return {"ok": ok, "from": frm, "to": to, "logs": logs}


def paid(path, payer, n, atomic, delivery_id=None):
    r = {"evt": "PAID", "path": path, "payer": payer, "tx": tx(n),
         "nonce": nonce(n), "auth_value": str(atomic), "ts": START_UTC + 10,
         "delivery_id": delivery_id or nonce(n), "ref": "x"}
    return r


class CollectorRoundTrip(unittest.TestCase):

    def _ts(self, extra_blocks):
        m = {LO: START_UTC, HI: END_UTC}
        for blk in extra_blocks:
            m[blk] = START_UTC + 50
        return m

    def test_happy_two_independent_buyers(self):
        blk = LO + 10
        pages = [page([log(1, IND_A, blk, 1000), log(2, IND_B, blk, 1000)])]
        chain = FixtureChain(HEAD, self._ts([blk]), pages,
                             {tx(1): nonce(1), tx(2): nonce(2)})
        inp = col.collect(window(), chain,
                          [paid(col.ROUTE, IND_A, 1, 1000), paid(col.ROUTE, IND_B, 2, 1000)],
                          cohort({IND_A: "independent", IND_B: "independent"}))
        self.assertTrue(inp["coverage"]["delivery_export_lossless"])
        self.assertTrue(inp["coverage"]["refund_coverage_complete"])
        res = adapter.evaluate(inp)
        self.assertEqual(res["status"], "available", res.get("errors"))
        self.assertEqual(res["gross_receipts_usdc"], "0.002")
        self.assertEqual(res["independent_buyers"], 2)
        self.assertEqual(res["repeat_deliveries"], 0)

    def test_duplicate_log_across_pages_collapses(self):
        blk = LO + 10
        dup = log(1, IND_A, blk, 1000)
        pages = [page([dup], to=LO + 25000), page([dup], frm=LO + 25000)]
        chain = FixtureChain(HEAD, self._ts([blk]), pages, {tx(1): nonce(1)})
        inp = col.collect(window(), chain, [paid(col.ROUTE, IND_A, 1, 1000)],
                          cohort({IND_A: "independent"}))
        self.assertEqual(len(inp["settlements"]), 1)
        res = adapter.evaluate(inp)
        self.assertEqual(res["status"], "available", res.get("errors"))
        self.assertEqual(res["gross_receipts_usdc"], "0.001")

    def test_sweep_payer_unlinked_is_acceptable(self):
        blk = LO + 10
        pages = [page([log(1, IND_A, blk, 1000), log(9, SWEEP, blk, 500000, li=1)])]
        # tx(9) has no AuthorizationUsed nonce (a plain sweep transfer).
        chain = FixtureChain(HEAD, self._ts([blk]), pages, {tx(1): nonce(1)})
        inp = col.collect(window(), chain, [paid(col.ROUTE, IND_A, 1, 1000)],
                          cohort({IND_A: "independent", SWEEP: "sweep"}))
        self.assertTrue(inp["coverage"]["settlement_delivery_unique_linkage"])
        self.assertTrue(inp["coverage"]["delivery_export_lossless"])  # sweep excluded from reconciliation
        res = adapter.evaluate(inp)
        self.assertEqual(res["status"], "available", res.get("errors"))
        self.assertEqual(res["independent_buyers"], 1)

    def test_unknown_unlinked_inflow_fails_linkage(self):
        blk = LO + 10
        pages = [page([log(1, IND_A, blk, 1000), log(9, UNKNOWN, blk, 1000, li=1)])]
        chain = FixtureChain(HEAD, self._ts([blk]), pages, {tx(1): nonce(1)})
        inp = col.collect(window(), chain, [paid(col.ROUTE, IND_A, 1, 1000)],
                          cohort({IND_A: "independent", UNKNOWN: "unknown"}))
        self.assertFalse(inp["coverage"]["settlement_delivery_unique_linkage"])
        res = adapter.evaluate(inp)
        self.assertEqual(res["status"], "unavailable")
        self.assertIn("settlement_delivery_unique_linkage_unproven", res["errors"])

    def test_finality_not_met(self):
        blk = LO + 10
        pages = [page([log(1, IND_A, blk, 1000)])]
        chain = FixtureChain(HI + 5, self._ts([blk]), pages, {tx(1): nonce(1)})  # head too close
        inp = col.collect(window(), chain, [paid(col.ROUTE, IND_A, 1, 1000)],
                          cohort({IND_A: "independent"}))
        self.assertFalse(inp["coverage"]["chain_finalized"])
        self.assertFalse(inp["coverage"]["delivery_export_lossless"])  # reconciliation gated on finality
        res = adapter.evaluate(inp)
        self.assertEqual(res["status"], "unavailable")
        self.assertIn("chain_finalized_unproven", res["errors"])

    def test_unreadable_page_fails_completeness(self):
        blk = LO + 10
        pages = [page([log(1, IND_A, blk, 1000)], to=LO + 25000),
                 page([], frm=LO + 25000, ok=False)]
        chain = FixtureChain(HEAD, self._ts([blk]), pages, {tx(1): nonce(1)})
        inp = col.collect(window(), chain, [paid(col.ROUTE, IND_A, 1, 1000)],
                          cohort({IND_A: "independent"}))
        self.assertFalse(inp["coverage"]["chain_blocks_complete"])
        res = adapter.evaluate(inp)
        self.assertEqual(res["status"], "unavailable")
        self.assertIn("chain_blocks_complete_unproven", res["errors"])

    def test_boundary_mismatch(self):
        blk = LO + 10
        ts = {LO: START_UTC + 1, HI: END_UTC, blk: START_UTC + 50}  # lo ts wrong
        pages = [page([log(1, IND_A, blk, 1000)])]
        chain = FixtureChain(HEAD, ts, pages, {tx(1): nonce(1)})
        inp = col.collect(window(), chain, [paid(col.ROUTE, IND_A, 1, 1000)],
                          cohort({IND_A: "independent"}))
        self.assertFalse(inp["coverage"]["block_time_boundaries_verified"])
        res = adapter.evaluate(inp)
        self.assertEqual(res["status"], "unavailable")

    def test_auth_value_mismatch_fails_linkage(self):
        blk = LO + 10
        pages = [page([log(1, IND_A, blk, 1000)])]
        chain = FixtureChain(HEAD, self._ts([blk]), pages, {tx(1): nonce(1)})
        # PAID row claims auth_value 2000 but the on-chain transfer is 1000.
        inp = col.collect(window(), chain, [paid(col.ROUTE, IND_A, 1, 2000)],
                          cohort({IND_A: "independent"}))
        self.assertFalse(inp["coverage"]["settlement_delivery_unique_linkage"])
        self.assertEqual(inp["deliveries"], [])

    def test_repeat_delivery_same_buyer(self):
        blk = LO + 10
        pages = [page([log(1, IND_A, blk, 1000), log(2, IND_A, blk, 1000, li=1)])]
        chain = FixtureChain(HEAD, self._ts([blk]), pages,
                             {tx(1): nonce(1), tx(2): nonce(2)})
        inp = col.collect(window(), chain,
                          [paid(col.ROUTE, IND_A, 1, 1000), paid(col.ROUTE, IND_A, 2, 1000)],
                          cohort({IND_A: "independent"}))
        res = adapter.evaluate(inp)
        self.assertEqual(res["status"], "available", res.get("errors"))
        self.assertEqual(res["independent_buyers"], 1)
        self.assertEqual(res["repeat_deliveries"], 1)

    def test_truncation_cap_flags_incomplete(self):
        blk = LO + 10
        orig = col.PAGE_LOG_CAP
        col.PAGE_LOG_CAP = 2  # shrink cap so a 2-log page is "dense"
        try:
            pages = [page([log(1, IND_A, blk, 1000), log(2, IND_B, blk, 1000, li=1)])]
            chain = FixtureChain(HEAD, self._ts([blk]), pages,
                                 {tx(1): nonce(1), tx(2): nonce(2)})
            inp = col.collect(window(), chain,
                              [paid(col.ROUTE, IND_A, 1, 1000), paid(col.ROUTE, IND_B, 2, 1000)],
                              cohort({IND_A: "independent", IND_B: "independent"}))
            self.assertFalse(inp["coverage"]["delivery_not_truncated"])
            res = adapter.evaluate(inp)
            self.assertEqual(res["status"], "unavailable")
        finally:
            col.PAGE_LOG_CAP = orig

    def test_export_missing_paid_row_fails_reconciliation(self):
        # A customer settlement with NO matching PAID row means the export lost a
        # settled delivery -> lossless/retention are chain-reconciled to False.
        blk = LO + 10
        pages = [page([log(1, IND_A, blk, 1000)])]
        chain = FixtureChain(HEAD, self._ts([blk]), pages, {tx(1): nonce(1)})
        inp = col.collect(window(), chain, [],  # no PAID rows (worker export missing)
                          cohort({IND_A: "independent"}))
        self.assertFalse(inp["coverage"]["delivery_export_lossless"])
        self.assertFalse(inp["coverage"]["delivery_retention_complete"])
        # linkage also fails (unattributed independent inflow) -> unavailable either way
        res = adapter.evaluate(inp)
        self.assertEqual(res["status"], "unavailable")

    def test_empty_window_yields_qualified_zero_without_worker(self):
        # A finalized window with zero customer settlements needs no PAID export:
        # reconciliation is vacuously complete and the refund scan is empty, so the
        # collector emits a QUALIFIED zero (0 receipts, 0 buyers) with no say-so.
        pages = [page([])]
        chain = FixtureChain(HEAD, self._ts([]), pages, {})
        inp = col.collect(window(), chain, [], cohort({}))
        self.assertTrue(inp["coverage"]["delivery_export_lossless"])
        self.assertTrue(inp["coverage"]["refund_coverage_complete"])
        res = adapter.evaluate(inp)
        self.assertEqual(res["status"], "available", res.get("errors"))
        self.assertEqual(res["gross_receipts_usdc"], "0")
        self.assertEqual(res["net_receipts_usdc"], "0")
        self.assertEqual(res["independent_buyers"], 0)

    def test_chain_derived_refund_subtracted(self):
        blk = LO + 10
        rblk = LO + 20
        pages = [page([log(1, IND_A, blk, 1000)])]
        # Outbound USDC transfer FROM payTo TO IND_A = a 0.0004 refund, read from chain.
        outbound = {PAYTO: [page([olog(77, IND_A, rblk, 400)])]}
        chain = FixtureChain(HEAD, self._ts([blk, rblk]), pages, {tx(1): nonce(1)},
                             outbound=outbound)
        inp = col.collect(window(), chain, [paid(col.ROUTE, IND_A, 1, 1000)],
                          cohort({IND_A: "independent"}))
        self.assertTrue(inp["coverage"]["refund_coverage_complete"])
        self.assertEqual(len(inp["refunds"]), 1)
        res = adapter.evaluate(inp)
        self.assertEqual(res["status"], "available", res.get("errors"))
        self.assertEqual(res["gross_receipts_usdc"], "0.001")
        self.assertEqual(res["refunds_usdc"], "0.0004")
        self.assertEqual(res["net_receipts_usdc"], "0.0006")

    def test_outbound_to_non_customer_is_not_a_refund(self):
        # An outbound transfer to an address that never paid us is an operational
        # outflow, not a refund -> ignored, refund coverage still complete.
        blk = LO + 10
        rblk = LO + 20
        pages = [page([log(1, IND_A, blk, 1000)])]
        outbound = {PAYTO: [page([olog(88, UNKNOWN, rblk, 999)])]}
        chain = FixtureChain(HEAD, self._ts([blk, rblk]), pages, {tx(1): nonce(1)},
                             outbound=outbound)
        inp = col.collect(window(), chain, [paid(col.ROUTE, IND_A, 1, 1000)],
                          cohort({IND_A: "independent"}))
        self.assertTrue(inp["coverage"]["refund_coverage_complete"])
        self.assertEqual(inp["refunds"], [])
        res = adapter.evaluate(inp)
        self.assertEqual(res["status"], "available", res.get("errors"))
        self.assertEqual(res["net_receipts_usdc"], "0.001")

    def test_unreadable_refund_page_fails_coverage(self):
        blk = LO + 10
        pages = [page([log(1, IND_A, blk, 1000)])]
        outbound = {PAYTO: [page([], ok=False)]}
        chain = FixtureChain(HEAD, self._ts([blk]), pages, {tx(1): nonce(1)},
                             outbound=outbound)
        inp = col.collect(window(), chain, [paid(col.ROUTE, IND_A, 1, 1000)],
                          cohort({IND_A: "independent"}))
        self.assertFalse(inp["coverage"]["refund_coverage_complete"])
        res = adapter.evaluate(inp)
        self.assertEqual(res["status"], "unavailable")
        self.assertIn("refund_coverage_complete_unproven", res["errors"])

    def test_refund_to_repeat_buyer_is_ambiguous(self):
        # A payer with two in-window deliveries + one outbound refund cannot be
        # attributed to a single original settlement -> coverage honestly False.
        blk = LO + 10
        rblk = LO + 20
        pages = [page([log(1, IND_A, blk, 1000), log(2, IND_A, blk, 1000, li=1)])]
        outbound = {PAYTO: [page([olog(77, IND_A, rblk, 400)])]}
        chain = FixtureChain(HEAD, self._ts([blk, rblk]), pages,
                             {tx(1): nonce(1), tx(2): nonce(2)}, outbound=outbound)
        inp = col.collect(window(), chain,
                          [paid(col.ROUTE, IND_A, 1, 1000), paid(col.ROUTE, IND_A, 2, 1000)],
                          cohort({IND_A: "independent"}))
        self.assertFalse(inp["coverage"]["refund_coverage_complete"])
        self.assertEqual(inp["refunds"], [])
        res = adapter.evaluate(inp)
        self.assertEqual(res["status"], "unavailable")

    def test_refund_from_declared_other_source(self):
        # A refund paid from a wallet other than payTo is only captured when that
        # wallet is named in refund_sources (the versioned residual-coverage input).
        blk = LO + 10
        rblk = LO + 20
        pages = [page([log(1, IND_A, blk, 1000)])]
        outbound = {OTHER_SRC: [page([olog(77, IND_A, rblk, 400)])]}
        chain = FixtureChain(HEAD, self._ts([blk, rblk]), pages, {tx(1): nonce(1)},
                             outbound=outbound)
        inp = col.collect(
            window(), chain, [paid(col.ROUTE, IND_A, 1, 1000)],
            cohort({IND_A: "independent"}),
            refund_sources={"version": "refund-src-v1",
                            "evidence_refs": ["ops://refund-wallets"],
                            "addresses": [OTHER_SRC]})
        self.assertTrue(inp["coverage"]["refund_coverage_complete"])
        self.assertEqual(len(inp["refunds"]), 1)
        res = adapter.evaluate(inp)
        self.assertEqual(res["status"], "available", res.get("errors"))
        self.assertEqual(res["net_receipts_usdc"], "0.0006")

    def test_variable_cost_passthrough_with_evidence(self):
        blk = LO + 10
        pages = [page([log(1, IND_A, blk, 1000)])]
        chain = FixtureChain(HEAD, self._ts([blk]), pages, {tx(1): nonce(1)})
        inp = col.collect(window(), chain, [paid(col.ROUTE, IND_A, 1, 1000)],
                          cohort({IND_A: "independent"}),
                          variable_costs_atomic=200, variable_cost_evidence_refs=["cost://rpc"])
        res = adapter.evaluate(inp)
        self.assertEqual(res["status"], "available", res.get("errors"))
        self.assertEqual(res["variable_costs_usdc"], "0.0002")
        self.assertEqual(res["contribution_usdc"], "0.0008")


if __name__ == "__main__":
    unittest.main(verbosity=2)
