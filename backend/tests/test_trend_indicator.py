from __future__ import annotations

import sys
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import main  # noqa: E402
from trend_indicator import (  # noqa: E402
    Bias,
    EdgeDirection,
    TrendConfig,
    TrendContext,
    TrendState,
    classify_trend,
)


client = TestClient(main.app)


def test_transition_low_side_up_range() -> None:
    result = classify_trend(
        TrendContext(
            close=102,
            ma20=100,
            high=105,
            low=99,
            h2=105,
            l1=100,
            l2=101,
            high_confirmed=False,
            low_confirmed=True,
        ),
        TrendConfig(ma_band_pct=0.01, eps=0.01),
    )
    assert result.state is TrendState.T_UP_RANGE
    assert result.bias is Bias.UP_BIAS
    assert result.direction is EdgeDirection.LOW_EDGE_UP_OR_FLAT
    assert result.next_states == (TrendState.UP_WEAK, TrendState.RANGE)


def test_transition_low_side_breaks_new_high_to_up_weak() -> None:
    result = classify_trend(
        TrendContext(
            close=102,
            ma20=100,
            high=106.2,
            low=99,
            h2=105,
            l1=100,
            l2=101,
            high_confirmed=False,
            low_confirmed=True,
        ),
        TrendConfig(ma_band_pct=0.01, eps=0.01),
    )
    assert result.trigger_new_high is True
    assert result.state is TrendState.UP_WEAK


def test_transition_low_side_down_bias_path() -> None:
    result = classify_trend(
        TrendContext(
            close=102,
            ma20=100,
            high=103,
            low=96.4,
            h2=105,
            l1=100,
            l2=97,
            high_confirmed=False,
            low_confirmed=True,
        ),
        TrendConfig(ma_band_pct=0.01, eps=0.01),
    )
    assert result.state is TrendState.T_DOWN_RANGE
    assert result.bias is Bias.DOWN_BIAS
    assert result.direction is EdgeDirection.LOW_EDGE_DOWN


def test_transition_low_side_breaks_new_low_to_down_weak() -> None:
    result = classify_trend(
        TrendContext(
            close=102,
            ma20=100,
            high=103,
            low=95.9,
            h2=105,
            l1=100,
            l2=97,
            high_confirmed=False,
            low_confirmed=True,
        ),
        TrendConfig(ma_band_pct=0.01, eps=0.01),
    )
    assert result.trigger_new_low is True
    assert result.state is TrendState.DOWN_WEAK


def test_transition_high_side_down_range() -> None:
    result = classify_trend(
        TrendContext(
            close=98,
            ma20=100,
            high=111,
            low=99.2,
            h1=110,
            h2=109,
            l2=100,
            high_confirmed=True,
            low_confirmed=False,
        ),
        TrendConfig(ma_band_pct=0.01, eps=0.01),
    )
    assert result.state is TrendState.T_DOWN_RANGE
    assert result.bias is Bias.DOWN_BIAS
    assert result.direction is EdgeDirection.HIGH_EDGE_DOWN_OR_FLAT


def test_transition_high_side_up_bias_breaks_new_high_to_up_weak() -> None:
    result = classify_trend(
        TrendContext(
            close=98,
            ma20=100,
            high=115.2,
            low=99.2,
            h1=110,
            h2=114,
            l2=100,
            high_confirmed=True,
            low_confirmed=False,
        ),
        TrendConfig(ma_band_pct=0.01, eps=0.01),
    )
    assert result.trigger_new_high is True
    assert result.state is TrendState.UP_WEAK
    assert result.direction is EdgeDirection.HIGH_EDGE_UP


def test_confirmed_plus_plus_is_up_strong() -> None:
    result = classify_trend(
        TrendContext(
            close=102,
            ma20=100,
            high=104,
            low=98,
            h1=100,
            h2=103,
            l1=90,
            l2=92,
            high_confirmed=True,
            low_confirmed=True,
        ),
        TrendConfig(ma_band_pct=0.01, eps=0.01),
    )
    assert result.stage == "confirmed"
    assert result.state is TrendState.UP_STRONG


def test_confirmed_minus_minus_is_down_strong() -> None:
    result = classify_trend(
        TrendContext(
            close=98,
            ma20=100,
            high=99,
            low=88,
            h1=100,
            h2=96,
            l1=90,
            l2=86,
            high_confirmed=True,
            low_confirmed=True,
        ),
        TrendConfig(ma_band_pct=0.01, eps=0.01),
    )
    assert result.state is TrendState.DOWN_STRONG


def test_confirmed_plus_minus_is_range() -> None:
    result = classify_trend(
        TrendContext(
            close=100,
            ma20=100,
            high=104,
            low=95,
            h1=100,
            h2=103,
            l1=100,
            l2=95,
            high_confirmed=True,
            low_confirmed=True,
        ),
        TrendConfig(ma_band_pct=0.01, eps=0.01),
    )
    assert result.state is TrendState.RANGE


def test_api_trend_classify_success() -> None:
    response = client.post(
        "/api/trend/classify",
        json={
            "close": 102,
            "ma20": 100,
            "high": 106.2,
            "low": 99,
            "h2": 105,
            "l1": 100,
            "l2": 101,
            "high_confirmed": False,
            "low_confirmed": True,
            "ma_band_pct": 0.01,
            "eps": 0.01,
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["result"]["state"] == "UP_WEAK"


def test_api_trend_classify_validation_error() -> None:
    response = client.post(
        "/api/trend/classify",
        json={
            "close": 100,
            "ma20": 0,
            "high": 101,
            "low": 99,
            "high_confirmed": False,
            "low_confirmed": False,
        },
    )
    assert response.status_code == 400
    assert "ma20 must be > 0" in response.json()["detail"]
