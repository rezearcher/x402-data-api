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


if __name__ == "__main__":
    unittest.main()
