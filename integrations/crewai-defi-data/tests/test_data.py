"""Offline unit tests for the dep-free core. Run: python -m unittest -v

No network: fetch is stubbed. These lock the URL building, input validation,
usd()/summariser shaping, and the degrade-open runner contract.
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from grey_ridge_x402_data import data as d  # noqa: E402


class TestNormalizers(unittest.TestCase):
    def test_coins_string_and_list(self):
        self.assertEqual(d.normalize_coins("bitcoin, ethereum"), ["bitcoin", "ethereum"])
        self.assertEqual(d.normalize_coins(["usd-coin"]), ["usd-coin"])

    def test_coins_ticker_symbol_aliases(self):
        self.assertEqual(d.normalize_coins("ETH,BTC"), ["ethereum", "bitcoin"])
        self.assertEqual(d.normalize_coins("eth, btc, sol"), ["ethereum", "bitcoin", "solana"])
        self.assertEqual(d.normalize_coins("BITCOIN"), ["bitcoin"])  # uppercase id lowercased
        self.assertEqual(d.normalize_coins(["WETH", "aero"]), ["weth", "aerodrome-finance"])
        self.assertEqual(d.normalize_coins("some-new-token"), ["some-new-token"])  # degrade-open

    def test_coins_dedupe_order(self):
        self.assertEqual(d.normalize_coins("a,b,a"), ["a", "b"])

    def test_coins_empty_raises(self):
        with self.assertRaises(ValueError):
            d.normalize_coins("")

    def test_coins_bad_id_raises(self):
        with self.assertRaises(ValueError):
            d.normalize_coins("Bitcoin!")  # uppercase + bang

    def test_coins_cap(self):
        with self.assertRaises(ValueError):
            d.normalize_coins(",".join([f"c{i}" for i in range(26)]))

    def test_addr_validation(self):
        good = "0x" + "a" * 40
        self.assertIn(good, d.build_balance_url(good))
        with self.assertRaises(ValueError):
            d.build_balance_url("0xdead")


class TestUrlBuilders(unittest.TestCase):
    def test_yields_defaults_and_clamp(self):
        u = d.build_yields_url(limit=500)
        self.assertIn("/defi/yields?", u)
        self.assertIn("limit=100", u)  # clamped to max
        self.assertIn("sort=tvl", u)

    def test_yields_risk_adjusted_and_filters(self):
        u = d.build_yields_url(limit=5, project="aave-v3", chain="Base",
                               stable=True, sort="risk_adjusted")
        self.assertIn("project=aave-v3", u)
        self.assertIn("chain=Base", u)
        self.assertIn("stable=true", u)
        self.assertIn("sort=risk_adjusted", u)

    def test_prices_url(self):
        self.assertIn("coins=bitcoin%2Cethereum",
                      d.build_prices_url("bitcoin,ethereum"))

    def test_token_balance_defaults_usdc(self):
        addr = "0x" + "b" * 40
        self.assertIn(d.BASE_USDC, d.build_token_balance_url(addr))

    def test_rpc_preview_urls(self):
        self.assertTrue(d.build_gas_price_preview_url().endswith("/chain/gas-price/preview"))
        self.assertTrue(d.build_block_number_preview_url().endswith("/chain/block-number/preview"))


class TestUsdAndSummaries(unittest.TestCase):
    def test_usd_tiers(self):
        self.assertEqual(d.usd(1.5e12), "$1.50T")
        self.assertEqual(d.usd(22.78e9), "$22.78B")
        self.assertEqual(d.usd(3.4e6), "$3.40M")
        self.assertEqual(d.usd(80846), "$80,846")
        self.assertEqual(d.usd(0.9912), "$0.9912")
        self.assertIsNone(d.usd("x"))
        self.assertIsNone(d.usd(True))  # bool is not a price

    def test_summarize_yields(self):
        s = d.summarize_yields([{"project": "lido", "symbol": "STETH",
                                 "apy": 2.27, "tvlUsd": 22.78e9, "ilRisk": "no"}])
        self.assertIn("lido", s)
        self.assertIn("2.27% APY", s)
        self.assertIn("TVL $22.78B", s)
        self.assertEqual(d.summarize_yields([]), "no yield pools")

    def test_summarize_prices(self):
        s = d.summarize_prices([{"symbol": "BTC", "price": 80846, "change_24h": 1.17}])
        self.assertIn("BTC", s)
        self.assertIn("(+1.17%)", s)
        self.assertEqual(d.summarize_prices([]), "no prices")

    def test_summarize_balance(self):
        s = d.summarize_balance({"address": "0x1234567890abcdef",
                                 "balance_eth": 0.5, "balance_usd": 1800})
        self.assertIn("0.5000 ETH", s)
        self.assertIn("on Base", s)
        self.assertEqual(d.summarize_balance({}), "no balance")


class TestRunnersDegradeOpen(unittest.TestCase):
    """Runners never raise; keyless uses preview; paid returns the full array."""

    def setUp(self):
        self._orig = d.plain_get

    def tearDown(self):
        d.plain_get = self._orig

    def test_yields_keyless_uses_preview(self):
        d.plain_get = lambda url, timeout=15.0: (200, {"preview": [{"project": "lido", "apy": 2.27}],
                                                       "total_available": 100})
        out = d.run_yields(lambda u: (0, None), has_key=False)
        self.assertFalse(out["paid"])
        self.assertEqual(out["count"], 1)
        self.assertIn("activation", out)
        self.assertEqual(out["total_available"], 100)

    def test_yields_paid_array(self):
        rows = [{"project": "aave-v3", "apy": 5.1}, {"project": "lido", "apy": 2.27}]
        out = d.run_yields(lambda u: (200, rows), has_key=True)
        self.assertTrue(out["paid"])
        self.assertEqual(out["count"], 2)

    def test_prices_402_degrades(self):
        d.plain_get = lambda url, timeout=15.0: (200, {"preview": [{"symbol": "BTC", "price": 80846}]})
        out = d.run_prices(lambda u: (402, None), coins="bitcoin", has_key=True)
        self.assertFalse(out["paid"])
        self.assertIn("402", out["activation"]["reason"])

    def test_prices_bad_input_no_raise(self):
        out = d.run_prices(lambda u: (200, []), coins="BAD!", has_key=True)
        self.assertIn("error", out)
        self.assertFalse(out["paid"])

    def test_balance_keyless_honest_stub(self):
        out = d.run_balance(lambda u: (0, None), address="0x" + "a" * 40, has_key=False)
        self.assertFalse(out["paid"])
        self.assertIn("activation", out)
        # honest: no fabricated balance number
        self.assertNotIn("balance_eth", out)

    def test_gas_price_keyless_real_value(self):
        d.plain_get = lambda url, timeout=15.0: (200, {"gas_price_gwei": 0.006, "block": 53191099})
        out = d.run_gas_price(lambda u: (0, None), has_key=False)
        self.assertFalse(out["paid"])
        self.assertEqual(out["gas_price_gwei"], 0.006)  # real value, not a stub

    def test_token_balance_paid(self):
        out = d.run_token_balance(lambda u: (200, {"symbol": "USDC", "balance_formatted": "33.11"}),
                                  address="0x" + "c" * 40, has_key=True)
        self.assertTrue(out["paid"])
        self.assertEqual(out["symbol"], "USDC")

    def test_runner_never_raises_on_outage(self):
        def boom(u):
            raise RuntimeError("network down")
        out = d.run_yields(boom, has_key=True)
        self.assertIn("error", out)
        self.assertEqual(out["yields"], [])


class TestFundingAndBrief(unittest.TestCase):
    def test_funding_url_and_preview(self):
        u = d.build_funding_url(limit=500)
        self.assertIn("/crypto/funding?", u)
        self.assertIn("limit=100", u)  # clamped
        self.assertTrue(d.build_funding_preview_url().endswith("/crypto/funding/preview"))
        self.assertTrue(d.build_market_brief_url().endswith("/brief/market"))

    def test_summarize_funding(self):
        rows = [{"coin": "BTC", "funding_spread_bps": 1.25, "signal": "LONGS_PAY",
                 "best_long_venue": "dydx", "best_short_venue": "okx"}]
        s = d.summarize_funding(rows)
        self.assertIn("BTC", s)
        self.assertIn("1.25bps", s)
        self.assertIn("LONGS_PAY", s)
        self.assertIn("long@dydx/short@okx", s)
        self.assertEqual(d.summarize_funding([]), "no funding data")

    def test_summarize_market_brief(self):
        out = {"fear_greed": {"value": 55, "classification": "Greed"},
               "global": {"total_market_cap_usd": 3.4e12, "btc_dominance_pct": 58.2},
               "trending": [{"symbol": "AERO"}]}
        s = d.summarize_market_brief(out)
        self.assertIn("F&G 55 (Greed)", s)
        self.assertIn("mcap $3.40T", s)
        self.assertIn("BTC dom 58.2%", s)
        self.assertIn("trending AERO", s)
        self.assertEqual(d.summarize_market_brief({}), "no market brief")

    def test_funding_keyless_real_preview(self):
        # keyless → real top-1 preview row, priced at the GATE ($0.004), not the stale note.
        d.plain_get = lambda url, timeout=15.0: (200, {
            "preview": [{"coin": "BTC", "funding_spread_bps": 1, "signal": "LONGS_PAY",
                         "best_long_venue": "dydx", "best_short_venue": "okx"}],
            "total_available": 20})
        out = d.run_funding(lambda u: (0, None), has_key=False)
        self.assertFalse(out["paid"])
        self.assertEqual(out["count"], 1)
        self.assertEqual(out["funding"][0]["coin"], "BTC")  # real value, not a stub
        self.assertEqual(out["total_available"], 20)
        self.assertEqual(out["activation"]["price_usdc"], "0.004")

    def test_funding_paid(self):
        out = d.run_funding(lambda u: (200, [{"coin": "ETH", "funding_spread_bps": 2}]),
                            has_key=True)
        self.assertTrue(out["paid"])
        self.assertEqual(out["count"], 1)
        self.assertIn("ETH", out["summary"])

    def test_funding_402_degrades(self):
        d.plain_get = lambda url, timeout=15.0: (200, {"preview": [{"coin": "BTC"}], "total_available": 20})
        out = d.run_funding(lambda u: (402, None), has_key=True)
        self.assertFalse(out["paid"])
        self.assertIn("402", out["activation"]["reason"])

    def test_market_brief_keyless_honest_stub(self):
        out = d.run_market_brief(lambda u: (0, None), has_key=False)
        self.assertFalse(out["paid"])
        self.assertIn("activation", out)
        self.assertEqual(out["activation"]["price_usdc"], "0.01")
        # honest: no fabricated brief data
        self.assertNotIn("fear_greed", out)
        self.assertNotIn("global", out)

    def test_market_brief_paid(self):
        out = d.run_market_brief(lambda u: (200, {"fear_greed": {"value": 55}}), has_key=True)
        self.assertTrue(out["paid"])
        self.assertEqual(out["fear_greed"]["value"], 55)

    def test_funding_never_raises_on_outage(self):
        def boom(u):
            raise RuntimeError("network down")
        out = d.run_funding(boom, has_key=True)
        self.assertIn("error", out)
        self.assertEqual(out["funding"], [])


class TestTokenReport(unittest.TestCase):
    def setUp(self):
        self._orig_plain_get = d.plain_get

    def tearDown(self):
        d.plain_get = self._orig_plain_get

    def test_token_report_urls_default_demo(self):
        u = d.build_token_report_url()
        self.assertIn("/chain/token-report?", u)
        self.assertIn(d.DEMO_TOKEN, u)
        p = d.build_token_report_preview_url()
        self.assertIn("/chain/token-report/preview?", p)
        self.assertIn(d.DEMO_TOKEN, p)

    def test_token_report_bad_token_no_raise(self):
        out = d.run_token_report(lambda u: (200, {}), token="not-an-address", has_key=True)
        self.assertIn("error", out)
        self.assertIsNone(out["verdict"])
        self.assertTrue(out["summary"].startswith("ERROR"))

    def test_summarize_token_report(self):
        s = d.summarize_token_report({"verdict": "SAFE", "risk_score": 15,
                                      "token_meta": {"symbol": "AERO"},
                                      "reasons": ["owner can mint new supply"]})
        self.assertIn("AERO: SAFE", s)
        self.assertIn("risk 15/100", s)
        self.assertIn("owner can mint", s)
        self.assertEqual(d.summarize_token_report({}), "no token report")
        self.assertIn("free trial exhausted",
                      d.summarize_token_report({"trial_exhausted": True}))

    def test_keyless_returns_real_verdict(self):
        # Preview carries the full verdict for the demo token (un-metered) → REAL, not a stub.
        d.plain_get = lambda url, timeout=15.0: (200, {
            "token": d.DEMO_TOKEN, "verdict": "SAFE", "risk_score": 15,
            "token_meta": {"symbol": "AERO"}, "reasons": ["owner can mint new supply"],
            "security": {"is_honeypot": False}, "liquidity": {"weth_usd": 1_000_000}})
        out = d.run_token_report(lambda u: (0, None), has_key=False)
        self.assertFalse(out["paid"])
        self.assertEqual(out["verdict"], "SAFE")
        self.assertEqual(out["risk_score"], 15)
        self.assertEqual(out["symbol"], "AERO")
        self.assertEqual(out["activation"]["price_usdc"], "0.01")

    def test_trial_exhausted_degrades_open_no_fabrication(self):
        d.plain_get = lambda url, timeout=15.0: (429, {
            "error": "free real-token trial exhausted (3/day/IP)",
            "trial": {"real_token_checks_left_today": 0},
            "paid_url": "https://x402-data-api.sigrunner.workers.dev/chain/token-report"})
        out = d.run_token_report(lambda u: (0, None), token="0x" + "a" * 40, has_key=False)
        self.assertFalse(out["paid"])
        self.assertTrue(out["trial_exhausted"])
        self.assertIsNone(out["verdict"])  # honest — no fabricated verdict
        self.assertIn("paid_url", out)

    def test_paid_verdict(self):
        out = d.run_token_report(lambda u: (200, {
            "token": "0x" + "b" * 40, "verdict": "AVOID", "risk_score": 88,
            "token_meta": {"symbol": "SCAM"}, "reasons": ["honeypot: cannot sell"]}),
            token="0x" + "b" * 40, has_key=True)
        self.assertTrue(out["paid"])
        self.assertEqual(out["verdict"], "AVOID")
        self.assertIn("SCAM: AVOID", out["summary"])

    def test_paid_402_degrades_to_preview(self):
        d.plain_get = lambda url, timeout=15.0: (200, {
            "token": d.DEMO_TOKEN, "verdict": "SAFE", "risk_score": 15,
            "token_meta": {"symbol": "AERO"}, "reasons": []})
        out = d.run_token_report(lambda u: (402, None), has_key=True)
        self.assertFalse(out["paid"])
        self.assertEqual(out["verdict"], "SAFE")
        self.assertIn("402", out["activation"]["reason"])

    def test_never_raises_on_outage(self):
        def boom(u):
            raise RuntimeError("network down")
        out = d.run_token_report(boom, has_key=True)
        self.assertIn("error", out)
        self.assertIsNone(out["verdict"])


class TestYieldEntryVerdict(unittest.TestCase):
    def setUp(self):
        self._orig = d.plain_get

    def tearDown(self):
        d.plain_get = self._orig

    def test_build_url_requires_pool_and_applies_token(self):
        with self.assertRaises(ValueError):
            d.build_yield_entry_verdict_url("")
        self.assertIn("pool=abc", d.build_yield_entry_verdict_url("abc"))
        self.assertIn("token=0x4200", d.build_yield_entry_verdict_url("abc", "0x4200000000000000000000000000000000000006"))

    def test_summary_renders_label_verdict_risk_apy(self):
        s = d.summarize_yield_entry_verdict(
            {"symbol": "USDC", "verdict": "SUSTAINABLE", "risk_score": 12, "apy": 5.42, "reasons": []})
        self.assertIn("USDC: SUSTAINABLE", s)
        self.assertIn("risk 12/100", s)
        self.assertIn("APY 5.42%", s)

    def test_paid_returns_full_verdict_not_sample(self):
        out = d.run_yield_entry_verdict(
            lambda u: (200, {"pool": "p", "verdict": "SUSTAINABLE", "risk_score": 12, "apy": 5.42, "reasons": []}),
            pool="p", has_key=True)
        self.assertTrue(out["paid"])
        self.assertFalse(out["is_sample"])
        self.assertEqual(out["verdict"], "SUSTAINABLE")

    def test_keyless_reads_preview_as_sample(self):
        d.plain_get = lambda url, timeout=15.0: (200, {"preview": {"symbol": "STETH", "verdict": "SUSTAINABLE", "risk_score": 0, "apy": 2.25, "reasons": []}})
        out = d.run_yield_entry_verdict(lambda u: (0, None), pool="my-pool", has_key=False)
        self.assertFalse(out["paid"])
        self.assertTrue(out["is_sample"])
        self.assertIn("SAMPLE, not pool my-pool", out["note"])
        self.assertEqual(out["activation"]["price_usdc"], "0.01")

    def test_missing_pool_degrades_not_raise(self):
        out = d.run_yield_entry_verdict(lambda u: (200, {}), pool="", has_key=True)
        self.assertIn("error", out)
        self.assertIsNone(out["verdict"])


class TestSimulate(unittest.TestCase):
    ADDR = "0x4200000000000000000000000000000000000006"
    TO = "0x5765ae06a52dc7A0BB71c36A11db512c7ea9ed10"

    def setUp(self):
        self._orig = d.plain_get

    def tearDown(self):
        d.plain_get = self._orig

    def test_build_url_requires_addrs_applies_data_value(self):
        with self.assertRaises(ValueError):
            d.build_simulate_url("0xnope", self.TO)
        u = d.build_simulate_url(self.ADDR, self.TO, "0xabcd", "100")
        self.assertIn("data=0xabcd", u)
        self.assertIn("value=100", u)

    def test_summary_renders_revert_gas_moves(self):
        s = d.summarize_simulation({"will_revert": False, "gas_used": 48210, "asset_changes": [{"t": 1}]})
        self.assertIn("will NOT revert", s)
        self.assertIn("gas 48210", s)
        self.assertIn("1 token move", s)
        self.assertIn("WILL REVERT · ERC20",
                      d.summarize_simulation({"will_revert": True, "revert_reason": "ERC20: x", "asset_changes": []}))

    def test_paid_returns_dry_run_not_sample(self):
        out = d.run_simulate(
            lambda u: (200, {"from": self.ADDR, "to": self.TO, "will_revert": False, "gas_used": 48210, "asset_changes": []}),
            from_addr=self.ADDR, to_addr=self.TO, has_key=True)
        self.assertTrue(out["paid"])
        self.assertFalse(out["is_sample"])
        self.assertFalse(out["will_revert"])

    def test_keyless_reads_preview_as_demo(self):
        d.plain_get = lambda url, timeout=15.0: (200, {"preview": {"will_revert": False, "gas_used": 21000, "asset_changes": []}})
        out = d.run_simulate(lambda u: (0, None), from_addr=self.ADDR, to_addr=self.TO, has_key=False)
        self.assertFalse(out["paid"])
        self.assertTrue(out["is_sample"])
        self.assertIn("demo dry-run", out["note"])
        self.assertEqual(out["activation"]["price_usdc"], "0.005")

    def test_bad_addr_degrades_not_raise(self):
        out = d.run_simulate(lambda u: (200, {}), from_addr="0xnope", to_addr=self.TO, has_key=True)
        self.assertIn("error", out)
        self.assertIsNone(out["will_revert"])


if __name__ == "__main__":
    unittest.main()
