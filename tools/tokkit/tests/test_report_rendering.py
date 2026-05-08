from __future__ import annotations

import json
import os
import sqlite3
import sys
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import patch
from zoneinfo import ZoneInfo


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from tokkit.cli import render_range_report
from tokkit.db import UsageRecord, init_db, upsert_usage_record


class ReportRenderingTests(unittest.TestCase):
    def test_range_report_source_uses_human_friendly_codex_desktop_label(self) -> None:
        conn = sqlite3.connect(":memory:")
        conn.row_factory = sqlite3.Row
        init_db(conn)
        tz = ZoneInfo("Asia/Shanghai")
        target_date = datetime.now(tz).date().isoformat()
        upsert_usage_record(
            conn,
            UsageRecord(
                source="codex:vscode",
                app="codex",
                external_id=f"session-1:{target_date}T01:00:00+08:00",
                started_at=f"{target_date}T01:00:00+08:00",
                local_date=target_date,
                model="gpt-5.5",
                input_tokens=1000,
                output_tokens=100,
                cached_input_tokens=500,
                reasoning_tokens=10,
                total_tokens=1110,
                metadata={"originator": "Codex Desktop", "model_provider": "openai"},
            ),
        )
        conn.commit()

        rendered = render_range_report(conn, 7, tz, json_mode=False)

        self.assertIn("Codex Desktop", rendered)
        self.assertNotIn("codex:vscode", rendered)
        self.assertNotIn("By source:", rendered)

    def test_range_report_exposes_unsplit_tokens_for_total_only_codex_events(self) -> None:
        conn = sqlite3.connect(":memory:")
        conn.row_factory = sqlite3.Row
        init_db(conn)
        tz = ZoneInfo("Asia/Shanghai")
        target_date = datetime.now(tz).date().isoformat()
        upsert_usage_record(
            conn,
            UsageRecord(
                source="codex:vscode",
                app="codex",
                external_id=f"session-2:{target_date}T02:00:00+08:00",
                started_at=f"{target_date}T02:00:00+08:00",
                local_date=target_date,
                model="gpt-5.5",
                input_tokens=0,
                output_tokens=0,
                cached_input_tokens=0,
                reasoning_tokens=0,
                total_tokens=150702,
                metadata={"originator": "Codex Desktop", "model_provider": "openai"},
            ),
        )
        upsert_usage_record(
            conn,
            UsageRecord(
                source="codex:vscode",
                app="codex",
                external_id=f"session-2:{target_date}T02:30:00+08:00",
                started_at=f"{target_date}T02:30:00+08:00",
                local_date=target_date,
                model="gpt-5.5",
                input_tokens=1000,
                output_tokens=100,
                cached_input_tokens=500,
                reasoning_tokens=10,
                total_tokens=1100,
                metadata={"originator": "Codex Desktop", "model_provider": "openai"},
            ),
        )
        conn.commit()

        rendered = render_range_report(conn, 7, tz, json_mode=False)
        payload = json.loads(render_range_report(conn, 7, tz, json_mode=True))

        self.assertIn("Unsplit", rendered)
        self.assertIn("Prompt", rendered)
        self.assertIn("Completion", rendered)
        self.assertIn("Cached Prompt", rendered)
        self.assertNotIn("Reasoning", rendered)
        self.assertNotIn("| Input", rendered)
        self.assertNotIn("| Output", rendered)
        self.assertNotIn("By source:", rendered)
        self.assertIn("150,702", rendered)
        self.assertEqual(payload["by_source"][0]["unsplit_tokens"], 150702)
        self.assertEqual(payload["by_source"][0]["input_tokens"], 1000)
        self.assertEqual(payload["by_source"][0]["output_tokens"], 100)
        self.assertEqual(payload["by_source"][0]["total_tokens"], 151802)
        self.assertEqual(payload["by_date"][0]["unsplit_tokens"], 150702)

    def test_range_report_prices_claude_cache_reads_as_disjoint_tokens(self) -> None:
        conn = sqlite3.connect(":memory:")
        conn.row_factory = sqlite3.Row
        init_db(conn)
        tz = ZoneInfo("Asia/Shanghai")
        target_date = datetime.now(tz).date().isoformat()
        upsert_usage_record(
            conn,
            UsageRecord(
                source="claude-code:cli",
                app="claude-code",
                external_id=f"claude-1:{target_date}T03:00:00+08:00",
                started_at=f"{target_date}T03:00:00+08:00",
                local_date=target_date,
                model="claude-opus-4-7-20260416",
                input_tokens=1_000_000,
                output_tokens=500_000,
                cached_input_tokens=2_000_000,
                total_tokens=3_500_000,
                metadata={"model_provider": "anthropic"},
            ),
        )
        conn.commit()

        payload = json.loads(render_range_report(conn, 7, tz, json_mode=True))

        self.assertEqual(payload["by_model"][0]["model_label"], "Claude Opus 4.7")
        self.assertEqual(payload["by_model"][0]["estimated_cost_usd"], 18.5)
        self.assertEqual(payload["by_date"][0]["estimated_cost_usd"], 18.5)

    def test_range_report_allocates_subscription_cost_by_api_equivalent_weight(self) -> None:
        conn = sqlite3.connect(":memory:")
        conn.row_factory = sqlite3.Row
        init_db(conn)
        tz = ZoneInfo("Asia/Shanghai")
        today = datetime.now(tz).date()
        dates = [(today - timedelta(days=1)).isoformat(), today.isoformat()]
        for idx, (local_date, output_tokens) in enumerate(zip(dates, [1_000_000, 2_000_000], strict=False), start=1):
            upsert_usage_record(
                conn,
                UsageRecord(
                    source="claude-code:cli",
                    app="claude-code",
                    external_id=f"claude-sub-{idx}:{local_date}T03:00:00+08:00",
                    started_at=f"{local_date}T03:00:00+08:00",
                    local_date=local_date,
                    model="claude-opus-4-7-20260416",
                    input_tokens=0,
                    output_tokens=output_tokens,
                    cached_input_tokens=0,
                    total_tokens=output_tokens,
                    metadata={"model_provider": "anthropic"},
                ),
            )
        conn.commit()

        with tempfile.TemporaryDirectory() as tmp_dir:
            billing_path = Path(tmp_dir) / "billing.json"
            billing_path.write_text(
                json.dumps(
                    {
                        "profiles": {
                            "claude-code": {
                                "mode": "subscription",
                                "monthly_usd": 90,
                                "cycle_start_day": 1,
                            }
                        }
                    }
                ),
                encoding="utf-8",
            )
            with patch.dict(os.environ, {"TOKKIT_BILLING_PATH": str(billing_path)}):
                payload = json.loads(render_range_report(conn, 7, tz, json_mode=True))
        conn.close()

        by_date = {row["local_date"]: row for row in payload["by_date"]}
        self.assertEqual(payload["by_model"][0]["estimated_cost_usd"], 75.0)
        self.assertEqual(payload["by_model"][0]["billable_cost_usd"], 90.0)
        self.assertAlmostEqual(by_date[dates[0]]["billable_cost_usd"], 30.0)
        self.assertAlmostEqual(by_date[dates[1]]["billable_cost_usd"], 60.0)


if __name__ == "__main__":
    unittest.main()
