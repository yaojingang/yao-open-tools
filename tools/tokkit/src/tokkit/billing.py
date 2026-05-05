from __future__ import annotations

import calendar
import json
import os
import sqlite3
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path
from typing import Any

from .pricing import PriceBookResolution, coerce_optional_bool, estimate_cost_usd
from .utils import resolve_app_home


DEFAULT_BILLING_PATH = resolve_app_home() / "billing.json"
SUPPORTED_BILLING_MODES = {"api", "subscription", "credits", "ignore"}


@dataclass(frozen=True)
class BillingProfile:
    key: str
    mode: str
    name: str
    monthly_usd: float | None
    cycle_start_day: int
    match_app: str | None = None
    match_source: str | None = None

    def matches(self, row: dict[str, object]) -> bool:
        app = str(row.get("app") or "").strip().lower()
        source = str(row.get("source") or "").strip().lower()
        if self.match_app and not _match_pattern(self.match_app, app):
            return False
        if self.match_source and not _match_pattern(self.match_source, source):
            return False
        if self.match_app or self.match_source:
            return True

        key = self.key.lower()
        return app == key or source == key or source.startswith(f"{key}:")


@dataclass(frozen=True)
class BillingConfigResolution:
    profiles: list[BillingProfile]
    path: Path
    loaded: bool
    error: str | None = None

    def profile_for_row(self, row: dict[str, object]) -> BillingProfile:
        for profile in self.profiles:
            if profile.matches(row):
                return profile
        return BillingProfile(key="api", mode="api", name="API", monthly_usd=None, cycle_start_day=1)


class BillingCostAllocator:
    def __init__(
        self,
        conn: sqlite3.Connection,
        pricing_resolution: PriceBookResolution,
        billing_resolution: BillingConfigResolution | None = None,
    ) -> None:
        self.conn = conn
        self.pricing_resolution = pricing_resolution
        self.billing_resolution = billing_resolution or resolve_billing_config()
        self._basis_cache: dict[tuple[str, str, str], tuple[float, int]] = {}

    def enrich(self, row: dict[str, object]) -> None:
        profile = self.billing_resolution.profile_for_row(row)
        api_cost = row.get("estimated_cost_usd")
        allocated_cost: float | None = None
        billable_cost: float | None = None
        billing_cycle: str | None = None

        if profile.mode == "api":
            billable_cost = float(api_cost) if api_cost is not None else None
        elif profile.mode == "subscription":
            allocated_cost, billing_cycle = self._subscription_allocation(row, profile)
            billable_cost = allocated_cost
        elif profile.mode == "ignore":
            billable_cost = 0.0

        row["billing_mode"] = profile.mode
        row["billing_profile"] = profile.name
        row["billing_cycle"] = billing_cycle
        row["allocated_cost_usd"] = _round_cost(allocated_cost)
        row["billable_cost_usd"] = _round_cost(billable_cost)

    def _subscription_allocation(self, row: dict[str, object], profile: BillingProfile) -> tuple[float | None, str | None]:
        if profile.monthly_usd is None or profile.monthly_usd <= 0:
            return None, None

        local_date = str(row.get("local_date") or "")
        if not local_date:
            return None, None

        start, end = billing_cycle_bounds(local_date, profile.cycle_start_day)
        api_basis, token_basis = self._subscription_basis(profile, start, end)
        api_cost = row.get("estimated_cost_usd")
        row_tokens = int(row.get("total_tokens") or 0)
        cycle_label = f"{start.isoformat()}..{end.isoformat()}"

        if api_basis > 0 and api_cost is not None:
            return profile.monthly_usd * float(api_cost) / api_basis, cycle_label
        if token_basis > 0 and row_tokens > 0:
            return profile.monthly_usd * row_tokens / token_basis, cycle_label
        return None, cycle_label

    def _subscription_basis(self, profile: BillingProfile, start: date, end: date) -> tuple[float, int]:
        cache_key = (profile.key, start.isoformat(), end.isoformat())
        cached = self._basis_cache.get(cache_key)
        if cached is not None:
            return cached

        rows = self.conn.execute(
            """
            SELECT
                local_date,
                app,
                source,
                measurement_method,
                COALESCE(model, '') AS model,
                COALESCE(json_extract(metadata_json, '$.model_provider'), '') AS model_provider,
                MAX(json_extract(metadata_json, '$.cached_input_is_separate')) AS cached_input_is_separate,
                SUM(input_tokens) AS input_tokens,
                SUM(output_tokens) AS output_tokens,
                SUM(cached_input_tokens) AS cached_input_tokens,
                COALESCE(SUM(total_tokens), 0) AS total_tokens
            FROM usage_records
            WHERE local_date >= ? AND local_date <= ?
            GROUP BY local_date, app, source, measurement_method, model, model_provider
            """,
            (start.isoformat(), end.isoformat()),
        ).fetchall()

        api_basis = 0.0
        token_basis = 0
        for raw_row in rows:
            item = dict(raw_row)
            if not profile.matches(item):
                continue
            token_basis += int(item.get("total_tokens") or 0)
            api_cost = estimate_cost_usd(
                model=item.get("model"),
                provider=item.get("model_provider"),
                measurement_method=str(item.get("measurement_method") or ""),
                input_tokens=int(item.get("input_tokens") or 0),
                cached_input_tokens=int(item.get("cached_input_tokens") or 0),
                output_tokens=int(item.get("output_tokens") or 0),
                pricing_resolution=self.pricing_resolution,
                cached_input_is_separate=coerce_optional_bool(item.get("cached_input_is_separate")),
            )
            if api_cost is not None:
                api_basis += float(api_cost)

        result = (round(api_basis, 8), token_basis)
        self._basis_cache[cache_key] = result
        return result


def resolve_billing_config(path: Path | None = None) -> BillingConfigResolution:
    billing_path = Path(
        os.environ.get(
            "TOKKIT_BILLING_PATH",
            os.environ.get("TOKSTAT_BILLING_PATH", str(path or DEFAULT_BILLING_PATH)),
        )
    ).expanduser()
    if not billing_path.exists():
        return BillingConfigResolution(profiles=[], path=billing_path, loaded=False)

    try:
        payload = json.loads(billing_path.read_text(encoding="utf-8"))
        profiles = _load_profiles(payload)
        return BillingConfigResolution(profiles=profiles, path=billing_path, loaded=True)
    except Exception as exc:
        return BillingConfigResolution(profiles=[], path=billing_path, loaded=False, error=str(exc))


def write_billing_template(*, force: bool = False, path: Path | None = None) -> Path:
    billing_path = Path(
        os.environ.get(
            "TOKKIT_BILLING_PATH",
            os.environ.get("TOKSTAT_BILLING_PATH", str(path or DEFAULT_BILLING_PATH)),
        )
    ).expanduser()
    if billing_path.exists() and not force:
        raise FileExistsError(f"billing file already exists: {billing_path}")
    billing_path.parent.mkdir(parents=True, exist_ok=True)
    billing_path.write_text(json.dumps(_billing_template(), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return billing_path


def billing_cycle_bounds(local_date: str, cycle_start_day: int) -> tuple[date, date]:
    current = date.fromisoformat(local_date)
    start_day = max(1, min(int(cycle_start_day or 1), 28))
    if current.day >= start_day:
        start_year, start_month = current.year, current.month
    else:
        start_year, start_month = _add_month(current.year, current.month, -1)
    start = date(start_year, start_month, min(start_day, calendar.monthrange(start_year, start_month)[1]))
    next_year, next_month = _add_month(start.year, start.month, 1)
    next_start = date(next_year, next_month, min(start_day, calendar.monthrange(next_year, next_month)[1]))
    return start, next_start - timedelta(days=1)


def _load_profiles(payload: dict[str, Any]) -> list[BillingProfile]:
    if not isinstance(payload, dict):
        raise ValueError("billing config must be a JSON object")
    raw_profiles = payload.get("profiles", payload)
    if not isinstance(raw_profiles, dict):
        raise ValueError("billing config 'profiles' must be an object")

    profiles: list[BillingProfile] = []
    for key, raw_profile in raw_profiles.items():
        if not isinstance(key, str) or not key.strip():
            raise ValueError("billing profile keys must be non-empty strings")
        if not isinstance(raw_profile, dict):
            raise ValueError(f"billing profile {key!r} must be an object")
        mode = str(raw_profile.get("mode", "api")).strip().lower()
        if mode not in SUPPORTED_BILLING_MODES:
            raise ValueError(f"unsupported billing mode for {key!r}: {mode}")
        monthly_usd = raw_profile.get("monthly_usd")
        profiles.append(
            BillingProfile(
                key=key.strip(),
                mode=mode,
                name=str(raw_profile.get("name") or raw_profile.get("plan") or key).strip(),
                monthly_usd=float(monthly_usd) if monthly_usd is not None else None,
                cycle_start_day=max(1, min(int(raw_profile.get("cycle_start_day", 1)), 28)),
                match_app=_optional_string(raw_profile.get("app") or raw_profile.get("match_app")),
                match_source=_optional_string(raw_profile.get("source") or raw_profile.get("match_source")),
            )
        )
    return profiles


def _billing_template() -> dict[str, object]:
    return {
        "profiles": {
            "claude-code": {
                "mode": "subscription",
                "name": "Claude Max",
                "monthly_usd": 100,
                "cycle_start_day": 1,
            },
            "codex": {
                "mode": "api",
                "name": "OpenAI API",
            },
            "warp": {
                "mode": "credits",
                "name": "Warp Credits",
            },
        }
    }


def _match_pattern(pattern: str, value: str) -> bool:
    normalized = pattern.strip().lower()
    if normalized.endswith("*"):
        return value.startswith(normalized[:-1])
    return value == normalized


def _optional_string(value: object) -> str | None:
    if value is None:
        return None
    stripped = str(value).strip()
    return stripped or None


def _round_cost(value: float | None) -> float | None:
    if value is None:
        return None
    return round(float(value), 8)


def _add_month(year: int, month: int, delta: int) -> tuple[int, int]:
    month_index = year * 12 + (month - 1) + delta
    return month_index // 12, month_index % 12 + 1
