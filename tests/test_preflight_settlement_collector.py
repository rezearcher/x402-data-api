"""Round-trip tests: collector output -> real attribution adapter.

Each case drives scripts/preflight_settlement_collector.collect() with a fixture
chain, then feeds the emitted dict to scripts/preflight_attribution.evaluate() and
asserts the honest verdict. Fixture payments/transfers are NOT customer evidence;
these prove the join + completeness/finality/truncation logic only.
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

START_UTC, END_UTC = 1_700_000_000, 1_700_100_000
LO, HI = 1_000_000, 1_050_000
HEAD = HI + 100  # finalized: HI <= HEAD-32


class FixtureChain:
    """Deterministic chain reader. `pages` is the exact list of page dicts to
    yield (so duplicate/unreadable pages can be modelled). `ts_map` maps block->ts
    and KeyErrors (surfaces) on an unmapped block. `nonce_map` maps tx->nonce."""

    def __init__(self, head, ts_map, pages, nonce_map):
        self._head = head
        self._ts = ts_map
        self._pages = pages
        self._nonce = nonce_map

    def head_block(self):
        return self._head

    def block_timestamp(self, block):
        return self._ts[block]

    def transfer_pages(self, payto, start_block, end_block, chunk):
        for p in self._pages:
            yield p

    def tx_authorization_nonce(self, t):
        return self._nonce.get(t.lower())


def window(payto="0x" + "57" * 20):
    return {"start_utc": START_UTC, "end_utc": END_UTC,
            "start_block": LO, "end_block": HI, "chain_id": 8453, "payto": payto}


def cohort(addresses):
    return {"version": "cohort-v1", "evidence_refs": ["ipfs://cohort"],
            "addresses": addresses}


def log(n, frm, blk, atomic, li=0):
    return {"tx": tx(n), "log_index": li, "block_number": blk,
            "from": frm, "amount_atomic": atomic}


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
        pages = [{"ok": True, "from": LO, "to": HI, "logs": [
            log(1, IND_A, blk, 1000), log(2, IND_B, blk, 1000)]}]
        chain = FixtureChain(HEAD, self._ts([blk]), pages,
                             {tx(1): nonce(1), tx(2): nonce(2)})
        inp = col.collect(window(), chain,
                          [paid(col.ROUTE, IND_A, 1, 1000), paid(col.ROUTE, IND_B, 2, 1000)],
                          cohort({IND_A: "independent", IND_B: "independent"}),
                          refunds=[], refund_evidence_refs=["policy://none"],
                          retention_covers_window=True)
        res = adapter.evaluate(inp)
        self.assertEqual(res["status"], "available", res.get("errors"))
        self.assertEqual(res["gross_receipts_usdc"], "0.002")
        self.assertEqual(res["independent_buyers"], 2)
        self.assertEqual(res["repeat_deliveries"], 0)

    def test_duplicate_log_across_pages_collapses(self):
        blk = LO + 10
        dup = log(1, IND_A, blk, 1000)
        pages = [{"ok": True, "from": LO, "to": LO + 25000, "logs": [dup]},
                 {"ok": True, "from": LO + 25000, "to": HI, "logs": [dup]}]
        chain = FixtureChain(HEAD, self._ts([blk]), pages, {tx(1): nonce(1)})
        inp = col.collect(window(), chain, [paid(col.ROUTE, IND_A, 1, 1000)],
                          cohort({IND_A: "independent"}),
                          refunds=[], refund_evidence_refs=["policy://none"],
                          retention_covers_window=True)
        self.assertEqual(len(inp["settlements"]), 1)
        res = adapter.evaluate(inp)
        self.assertEqual(res["status"], "available", res.get("errors"))
        self.assertEqual(res["gross_receipts_usdc"], "0.001")

    def test_sweep_payer_unlinked_is_acceptable(self):
        blk = LO + 10
        pages = [{"ok": True, "from": LO, "to": HI, "logs": [
            log(1, IND_A, blk, 1000), log(9, SWEEP, blk, 500000, li=1)]}]
        # tx(9) has no AuthorizationUsed nonce (a plain sweep transfer).
        chain = FixtureChain(HEAD, self._ts([blk]), pages, {tx(1): nonce(1)})
        inp = col.collect(window(), chain, [paid(col.ROUTE, IND_A, 1, 1000)],
                          cohort({IND_A: "independent", SWEEP: "sweep"}),
                          refunds=[], refund_evidence_refs=["policy://none"],
                          retention_covers_window=True)
        self.assertTrue(inp["coverage"]["settlement_delivery_unique_linkage"])
        res = adapter.evaluate(inp)
        self.assertEqual(res["status"], "available", res.get("errors"))
        self.assertEqual(res["independent_buyers"], 1)

    def test_unknown_unlinked_inflow_fails_linkage(self):
        blk = LO + 10
        pages = [{"ok": True, "from": LO, "to": HI, "logs": [
            log(1, IND_A, blk, 1000), log(9, UNKNOWN, blk, 1000, li=1)]}]
        chain = FixtureChain(HEAD, self._ts([blk]), pages, {tx(1): nonce(1)})
        inp = col.collect(window(), chain, [paid(col.ROUTE, IND_A, 1, 1000)],
                          cohort({IND_A: "independent", UNKNOWN: "unknown"}),
                          retention_covers_window=True)
        self.assertFalse(inp["coverage"]["settlement_delivery_unique_linkage"])
        res = adapter.evaluate(inp)
        self.assertEqual(res["status"], "unavailable")
        self.assertIn("settlement_delivery_unique_linkage_unproven", res["errors"])

    def test_finality_not_met(self):
        blk = LO + 10
        pages = [{"ok": True, "from": LO, "to": HI, "logs": [log(1, IND_A, blk, 1000)]}]
        chain = FixtureChain(HI + 5, self._ts([blk]), pages, {tx(1): nonce(1)})  # head too close
        inp = col.collect(window(), chain, [paid(col.ROUTE, IND_A, 1, 1000)],
                          cohort({IND_A: "independent"}), retention_covers_window=True)
        self.assertFalse(inp["coverage"]["chain_finalized"])
        res = adapter.evaluate(inp)
        self.assertEqual(res["status"], "unavailable")
        self.assertIn("chain_finalized_unproven", res["errors"])

    def test_unreadable_page_fails_completeness(self):
        blk = LO + 10
        pages = [{"ok": True, "from": LO, "to": LO + 25000, "logs": [log(1, IND_A, blk, 1000)]},
                 {"ok": False, "from": LO + 25000, "to": HI, "logs": []}]
        chain = FixtureChain(HEAD, self._ts([blk]), pages, {tx(1): nonce(1)})
        inp = col.collect(window(), chain, [paid(col.ROUTE, IND_A, 1, 1000)],
                          cohort({IND_A: "independent"}), retention_covers_window=True)
        self.assertFalse(inp["coverage"]["chain_blocks_complete"])
        res = adapter.evaluate(inp)
        self.assertEqual(res["status"], "unavailable")
        self.assertIn("chain_blocks_complete_unproven", res["errors"])

    def test_boundary_mismatch(self):
        blk = LO + 10
        ts = {LO: START_UTC + 1, HI: END_UTC, blk: START_UTC + 50}  # lo ts wrong
        pages = [{"ok": True, "from": LO, "to": HI, "logs": [log(1, IND_A, blk, 1000)]}]
        chain = FixtureChain(HEAD, ts, pages, {tx(1): nonce(1)})
        inp = col.collect(window(), chain, [paid(col.ROUTE, IND_A, 1, 1000)],
                          cohort({IND_A: "independent"}), retention_covers_window=True)
        self.assertFalse(inp["coverage"]["block_time_boundaries_verified"])
        res = adapter.evaluate(inp)
        self.assertEqual(res["status"], "unavailable")

    def test_auth_value_mismatch_fails_linkage(self):
        blk = LO + 10
        pages = [{"ok": True, "from": LO, "to": HI, "logs": [log(1, IND_A, blk, 1000)]}]
        chain = FixtureChain(HEAD, self._ts([blk]), pages, {tx(1): nonce(1)})
        # PAID row claims auth_value 2000 but the on-chain transfer is 1000.
        inp = col.collect(window(), chain, [paid(col.ROUTE, IND_A, 1, 2000)],
                          cohort({IND_A: "independent"}), retention_covers_window=True)
        self.assertFalse(inp["coverage"]["settlement_delivery_unique_linkage"])
        self.assertEqual(inp["deliveries"], [])

    def test_repeat_delivery_same_buyer(self):
        blk = LO + 10
        pages = [{"ok": True, "from": LO, "to": HI, "logs": [
            log(1, IND_A, blk, 1000), log(2, IND_A, blk, 1000, li=1)]}]
        chain = FixtureChain(HEAD, self._ts([blk]), pages,
                             {tx(1): nonce(1), tx(2): nonce(2)})
        inp = col.collect(window(), chain,
                          [paid(col.ROUTE, IND_A, 1, 1000), paid(col.ROUTE, IND_A, 2, 1000)],
                          cohort({IND_A: "independent"}),
                          refunds=[], refund_evidence_refs=["policy://none"],
                          retention_covers_window=True)
        res = adapter.evaluate(inp)
        self.assertEqual(res["status"], "available", res.get("errors"))
        self.assertEqual(res["independent_buyers"], 1)
        self.assertEqual(res["repeat_deliveries"], 1)

    def test_truncation_cap_flags_incomplete(self):
        blk = LO + 10
        orig = col.PAGE_LOG_CAP
        col.PAGE_LOG_CAP = 2  # shrink cap so a 2-log page is "dense"
        try:
            pages = [{"ok": True, "from": LO, "to": HI, "logs": [
                log(1, IND_A, blk, 1000), log(2, IND_B, blk, 1000, li=1)]}]
            chain = FixtureChain(HEAD, self._ts([blk]), pages,
                                 {tx(1): nonce(1), tx(2): nonce(2)})
            inp = col.collect(window(), chain,
                              [paid(col.ROUTE, IND_A, 1, 1000), paid(col.ROUTE, IND_B, 2, 1000)],
                              cohort({IND_A: "independent", IND_B: "independent"}),
                              retention_covers_window=True)
            self.assertFalse(inp["coverage"]["delivery_not_truncated"])
            res = adapter.evaluate(inp)
            self.assertEqual(res["status"], "unavailable")
        finally:
            col.PAGE_LOG_CAP = orig

    def test_retention_not_asserted_is_unavailable(self):
        blk = LO + 10
        pages = [{"ok": True, "from": LO, "to": HI, "logs": [log(1, IND_A, blk, 1000)]}]
        chain = FixtureChain(HEAD, self._ts([blk]), pages, {tx(1): nonce(1)})
        inp = col.collect(window(), chain, [paid(col.ROUTE, IND_A, 1, 1000)],
                          cohort({IND_A: "independent"}),
                          refunds=[], refund_evidence_refs=["policy://none"],
                          retention_covers_window=False)  # the honest default
        self.assertFalse(inp["coverage"]["delivery_export_lossless"])
        res = adapter.evaluate(inp)
        self.assertEqual(res["status"], "unavailable")

    def test_refund_subtracted_with_evidence(self):
        blk = LO + 10
        pages = [{"ok": True, "from": LO, "to": HI, "logs": [log(1, IND_A, blk, 1000)]}]
        chain = FixtureChain(HEAD, self._ts([blk]), pages, {tx(1): nonce(1)})
        refund = {"chain_id": 8453, "tx": tx(77), "log_index": 0, "finalized": True,
                  "success": True, "asset": "USDC", "amount_usdc": "0.0004",
                  "block_number": blk, "timestamp_utc": START_UTC + 60,
                  "original_settlement": {"chain_id": 8453, "tx": tx(1), "log_index": 0}}
        inp = col.collect(window(), chain, [paid(col.ROUTE, IND_A, 1, 1000)],
                          cohort({IND_A: "independent"}),
                          refunds=[refund], refund_evidence_refs=["chain://refund"],
                          retention_covers_window=True)
        self.assertTrue(inp["coverage"]["refund_coverage_complete"])
        res = adapter.evaluate(inp)
        self.assertEqual(res["status"], "available", res.get("errors"))
        self.assertEqual(res["gross_receipts_usdc"], "0.001")
        self.assertEqual(res["refunds_usdc"], "0.0004")
        self.assertEqual(res["net_receipts_usdc"], "0.0006")

    def test_variable_cost_passthrough_with_evidence(self):
        blk = LO + 10
        pages = [{"ok": True, "from": LO, "to": HI, "logs": [log(1, IND_A, blk, 1000)]}]
        chain = FixtureChain(HEAD, self._ts([blk]), pages, {tx(1): nonce(1)})
        inp = col.collect(window(), chain, [paid(col.ROUTE, IND_A, 1, 1000)],
                          cohort({IND_A: "independent"}),
                          refunds=[], refund_evidence_refs=["policy://none"],
                          variable_costs_atomic=200, variable_cost_evidence_refs=["cost://rpc"],
                          retention_covers_window=True)
        res = adapter.evaluate(inp)
        self.assertEqual(res["status"], "available", res.get("errors"))
        self.assertEqual(res["variable_costs_usdc"], "0.0002")
        self.assertEqual(res["contribution_usdc"], "0.0008")


if __name__ == "__main__":
    unittest.main(verbosity=2)
