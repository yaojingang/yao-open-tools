from __future__ import annotations

import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from tokkit.pricing import coerce_optional_bool, estimate_cost_usd, normalize_model_display


class NormalizeModelDisplayTests(unittest.TestCase):
    def test_normalizes_gpt_5_5_pro_slug(self) -> None:
        self.assertEqual(normalize_model_display("gpt-5.5-pro"), "GPT-5.5 Pro")

    def test_normalizes_gpt_5_3_codex_slug(self) -> None:
        self.assertEqual(normalize_model_display("gpt-5.3-codex"), "GPT-5.3 Codex")

    def test_preserves_fast_parenthetical_suffix(self) -> None:
        self.assertEqual(normalize_model_display("gpt-5.5 (Fast)"), "GPT-5.5 (Fast)")


class EstimateCostUsdTests(unittest.TestCase):
    def test_estimates_gpt_5_5_cost(self) -> None:
        self.assertEqual(
            estimate_cost_usd(
                model="gpt-5.5",
                provider="openai",
                measurement_method="exact",
                input_tokens=1_000_000,
                cached_input_tokens=100_000,
                output_tokens=500_000,
            ),
            19.55,
        )

    def test_estimates_gpt_5_5_pro_without_cached_discount(self) -> None:
        self.assertEqual(
            estimate_cost_usd(
                model="gpt-5.5-pro",
                provider="openai",
                measurement_method="exact",
                input_tokens=1_000_000,
                cached_input_tokens=250_000,
                output_tokens=500_000,
            ),
            120.0,
        )

    def test_estimates_gpt_5_3_codex_cost(self) -> None:
        self.assertEqual(
            estimate_cost_usd(
                model="gpt-5.3-codex",
                provider="openai",
                measurement_method="exact",
                input_tokens=1_000_000,
                cached_input_tokens=200_000,
                output_tokens=500_000,
            ),
            8.435,
        )

    def test_estimates_claude_disjoint_cache_reads(self) -> None:
        self.assertEqual(
            estimate_cost_usd(
                model="claude-opus-4-6",
                provider="anthropic",
                measurement_method="exact",
                input_tokens=1_000_000,
                cached_input_tokens=2_000_000,
                output_tokens=500_000,
            ),
            18.5,
        )

    def test_estimates_claude_opus_4_7_cost(self) -> None:
        self.assertEqual(
            estimate_cost_usd(
                model="claude-opus-4-7-20260416",
                provider="anthropic",
                measurement_method="exact",
                input_tokens=1_000_000,
                cached_input_tokens=2_000_000,
                output_tokens=500_000,
            ),
            18.5,
        )

    def test_cached_input_is_separate_flag_overrides_provider_heuristic(self) -> None:
        # If the metadata flag explicitly says cached_input is a separate
        # counter, honor it even when provider/model would normally trigger
        # the OpenAI subset semantics. This is how the new metadata path
        # decouples pricing from the model-name string.
        anthropic_proxy_via_codex = estimate_cost_usd(
            model="claude-opus-4-7-20260416",
            provider="openai",  # e.g. proxied through an OpenAI-style endpoint
            measurement_method="exact",
            input_tokens=1_000_000,
            cached_input_tokens=2_000_000,
            output_tokens=500_000,
            cached_input_is_separate=True,
        )
        # disjoint: 1M*5 + 2M*0.5 + 0.5M*25 = 5 + 1 + 12.5 = 18.5
        self.assertEqual(anthropic_proxy_via_codex, 18.5)

    def test_cached_input_is_separate_false_forces_subset_semantics(self) -> None:
        # Inverse: if the metadata explicitly says cached_input is a SUBSET
        # of input_tokens (OpenAI semantics), honor it even though the
        # model name starts with "Claude " — the legacy fallback would have
        # otherwise treated this as disjoint.
        cost = estimate_cost_usd(
            model="claude-opus-4-7-20260416",
            provider=None,
            measurement_method="exact",
            input_tokens=1_000_000,
            cached_input_tokens=200_000,
            output_tokens=500_000,
            cached_input_is_separate=False,
        )
        # subset: cached_billable = min(200k, 1M) = 200k
        #         uncached = 1M - 200k = 800k
        #         800k*5 + 200k*0.5 + 500k*25 = 4 + 0.1 + 12.5 = 16.6
        self.assertEqual(cost, 16.6)

    def test_cached_input_is_separate_none_uses_legacy_fallback(self) -> None:
        # Backward compatibility: legacy rows have no cached_input_is_separate
        # in their metadata. estimate_cost_usd must keep using the
        # provider/model-name fallback.
        cost = estimate_cost_usd(
            model="claude-opus-4-6",
            provider="anthropic",
            measurement_method="exact",
            input_tokens=1_000_000,
            cached_input_tokens=2_000_000,
            output_tokens=500_000,
            cached_input_is_separate=None,
        )
        self.assertEqual(cost, 18.5)

    def test_estimates_claude_opus_4_7_real_world_full_cache(self) -> None:
        # Regression for yaojingang/yao-cli-tools#2: real-world Opus 4.7 day
        # with cached_input >> input tokens. cached_input_tokens must NOT be
        # truncated to input_tokens (the OpenAI subset semantics) — Anthropic
        # bills cache_read_input_tokens as a disjoint counter on top of
        # input_tokens. Expected cost ~$63.86.
        #
        #   3.414443M input   * $5.00 = $17.072215
        #  76.542372M cached  * $0.50 = $38.271186
        #   0.340697M output  * $25.00 = $ 8.517425
        #                              = $63.860826
        self.assertEqual(
            estimate_cost_usd(
                model="claude-opus-4-7-20260416",
                provider="anthropic",
                measurement_method="exact",
                input_tokens=3_414_443,
                cached_input_tokens=76_542_372,
                output_tokens=340_697,
            ),
            63.860826,
        )


class CoerceOptionalBoolTests(unittest.TestCase):
    def test_returns_none_for_none(self) -> None:
        self.assertIsNone(coerce_optional_bool(None))

    def test_passes_bool_through(self) -> None:
        self.assertIs(coerce_optional_bool(True), True)
        self.assertIs(coerce_optional_bool(False), False)

    def test_converts_sqlite_int(self) -> None:
        # SQLite's json_extract on JSON true/false returns int 1/0.
        self.assertIs(coerce_optional_bool(1), True)
        self.assertIs(coerce_optional_bool(0), False)

    def test_parses_strings_defensively(self) -> None:
        self.assertIs(coerce_optional_bool("true"), True)
        self.assertIs(coerce_optional_bool("False"), False)
        self.assertIs(coerce_optional_bool(""), False)
        self.assertIsNone(coerce_optional_bool("garbage"))


if __name__ == "__main__":
    unittest.main()
