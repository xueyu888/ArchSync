from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class Zone(StrEnum):
    UP_ZONE = "UP_ZONE"
    DOWN_ZONE = "DOWN_ZONE"
    MA_BAND = "MA_BAND"


class TrendState(StrEnum):
    # Transition states
    T_UP_RANGE = "T_UP_RANGE"
    T_DOWN_RANGE = "T_DOWN_RANGE"
    RANGE_UP_BIAS = "RANGE_UP_BIAS"
    RANGE_DOWN_BIAS = "RANGE_DOWN_BIAS"
    # Confirmed/final states
    UP_STRONG = "UP_STRONG"
    UP_WEAK = "UP_WEAK"
    DOWN_STRONG = "DOWN_STRONG"
    DOWN_WEAK = "DOWN_WEAK"
    RANGE = "RANGE"


class Bias(StrEnum):
    UP_BIAS = "UP_BIAS"
    DOWN_BIAS = "DOWN_BIAS"
    NEUTRAL = "NEUTRAL"


class EdgeDirection(StrEnum):
    LOW_EDGE_UP_OR_FLAT = "LOW_EDGE_UP_OR_FLAT"
    LOW_EDGE_DOWN = "LOW_EDGE_DOWN"
    HIGH_EDGE_DOWN_OR_FLAT = "HIGH_EDGE_DOWN_OR_FLAT"
    HIGH_EDGE_UP = "HIGH_EDGE_UP"
    CONFIRMED_BOTH = "CONFIRMED_BOTH"
    UNDEFINED = "UNDEFINED"


class DeltaCmp(StrEnum):
    PLUS = "+"
    ZERO = "0"
    MINUS = "-"


@dataclass(frozen=True)
class TrendConfig:
    ma_band_pct: float = 0.01
    eps: float = 0.01


@dataclass(frozen=True)
class TrendContext:
    close: float
    ma20: float
    high: float
    low: float
    h1: float | None = None
    h2: float | None = None
    l1: float | None = None
    l2: float | None = None
    high_confirmed: bool = False
    low_confirmed: bool = False


@dataclass(frozen=True)
class TransitionRule:
    target: TrendState
    condition: str

    def to_dict(self) -> dict:
        return {
            "target": self.target.value,
            "condition": self.condition,
        }


@dataclass(frozen=True)
class TrendResult:
    stage: str
    zone: Zone
    state: TrendState
    bias: Bias
    direction: EdgeDirection
    next_states: tuple[TrendState, ...]
    transition_rules: tuple[TransitionRule, ...]
    trigger_new_high: bool
    trigger_new_low: bool
    cmp_high: DeltaCmp | None = None
    cmp_low: DeltaCmp | None = None

    def to_dict(self) -> dict:
        return {
            "stage": self.stage,
            "zone": self.zone.value,
            "state": self.state.value,
            "bias": self.bias.value,
            "direction": self.direction.value,
            "next_states": [item.value for item in self.next_states],
            "transition_rules": [item.to_dict() for item in self.transition_rules],
            "trigger_new_high": self.trigger_new_high,
            "trigger_new_low": self.trigger_new_low,
            "cmp_high": self.cmp_high.value if self.cmp_high else None,
            "cmp_low": self.cmp_low.value if self.cmp_low else None,
        }


def _zone(close: float, ma20: float, ma_band_pct: float) -> Zone:
    if ma20 <= 0:
        raise ValueError("ma20 must be > 0")
    if close > ma20 * (1 + ma_band_pct):
        return Zone.UP_ZONE
    if close < ma20 * (1 - ma_band_pct):
        return Zone.DOWN_ZONE
    return Zone.MA_BAND


def _cmp_low(l2: float, l1: float, eps: float) -> DeltaCmp:
    if l2 > l1 * (1 + eps):
        return DeltaCmp.PLUS
    if l2 < l1 * (1 - eps):
        return DeltaCmp.MINUS
    return DeltaCmp.ZERO


def _cmp_high(h2: float, h1: float, eps: float) -> DeltaCmp:
    if h2 > h1 * (1 + eps):
        return DeltaCmp.PLUS
    if h2 < h1 * (1 - eps):
        return DeltaCmp.MINUS
    return DeltaCmp.ZERO


def _final_state_from_cmp(cmp_h: DeltaCmp, cmp_l: DeltaCmp) -> TrendState:
    if cmp_h is DeltaCmp.PLUS and cmp_l is DeltaCmp.PLUS:
        return TrendState.UP_STRONG
    if (
        (cmp_h is DeltaCmp.PLUS and cmp_l is DeltaCmp.ZERO)
        or (cmp_h is DeltaCmp.ZERO and cmp_l is DeltaCmp.PLUS)
    ):
        return TrendState.UP_WEAK
    if cmp_h is DeltaCmp.MINUS and cmp_l is DeltaCmp.MINUS:
        return TrendState.DOWN_STRONG
    if (
        (cmp_h is DeltaCmp.MINUS and cmp_l is DeltaCmp.ZERO)
        or (cmp_h is DeltaCmp.ZERO and cmp_l is DeltaCmp.MINUS)
    ):
        return TrendState.DOWN_WEAK
    return TrendState.RANGE


def classify_trend(context: TrendContext, config: TrendConfig = TrendConfig()) -> TrendResult:
    if config.eps < 0 or config.ma_band_pct < 0:
        raise ValueError("eps and ma_band_pct must be >= 0")

    zone = _zone(context.close, context.ma20, config.ma_band_pct)
    trigger_new_high = bool(
        context.h2 is not None and context.high >= context.h2 * (1 + config.eps)
    )
    trigger_new_low = bool(
        context.l2 is not None and context.low <= context.l2 * (1 - config.eps)
    )

    # Table 2: both sides confirmed => final state by (dH, dL)
    if context.high_confirmed and context.low_confirmed:
        if None in (context.h1, context.h2, context.l1, context.l2):
            raise ValueError("h1/h2/l1/l2 are required when both sides are confirmed")
        cmp_h = _cmp_high(context.h2, context.h1, config.eps)
        cmp_l = _cmp_low(context.l2, context.l1, config.eps)
        state = _final_state_from_cmp(cmp_h, cmp_l)
        if state in (TrendState.UP_STRONG, TrendState.UP_WEAK):
            bias = Bias.UP_BIAS
        elif state in (TrendState.DOWN_STRONG, TrendState.DOWN_WEAK):
            bias = Bias.DOWN_BIAS
        else:
            bias = Bias.NEUTRAL
        return TrendResult(
            stage="confirmed",
            zone=zone,
            state=state,
            bias=bias,
            direction=EdgeDirection.CONFIRMED_BOTH,
            next_states=(state,),
            transition_rules=(),
            trigger_new_high=trigger_new_high,
            trigger_new_low=trigger_new_low,
            cmp_high=cmp_h,
            cmp_low=cmp_l,
        )

    # Table 1A: low side confirmed only
    if context.low_confirmed and not context.high_confirmed:
        if None in (context.l1, context.l2):
            raise ValueError("l1/l2 are required when low side is confirmed")
        low_not_lower = context.l2 >= context.l1 * (1 - config.eps)
        if low_not_lower:
            if trigger_new_high:
                return TrendResult(
                    stage="transition",
                    zone=zone,
                    state=TrendState.UP_WEAK,
                    bias=Bias.UP_BIAS,
                    direction=EdgeDirection.LOW_EDGE_UP_OR_FLAT,
                    next_states=(TrendState.UP_WEAK, TrendState.RANGE),
                    transition_rules=(
                        TransitionRule(
                            target=TrendState.UP_WEAK,
                            condition="High >= H2*(1+eps)",
                        ),
                        TransitionRule(
                            target=TrendState.RANGE,
                            condition="Close returns to MA_BAND without new high confirmation",
                        ),
                    ),
                    trigger_new_high=trigger_new_high,
                    trigger_new_low=trigger_new_low,
                )
            state = (
                TrendState.T_UP_RANGE if zone is Zone.UP_ZONE else TrendState.RANGE_UP_BIAS
            )
            return TrendResult(
                stage="transition",
                zone=zone,
                state=state,
                bias=Bias.UP_BIAS,
                direction=EdgeDirection.LOW_EDGE_UP_OR_FLAT,
                next_states=(TrendState.UP_WEAK, TrendState.RANGE),
                transition_rules=(
                    TransitionRule(target=TrendState.UP_WEAK, condition="High >= H2*(1+eps)"),
                    TransitionRule(
                        target=TrendState.RANGE,
                        condition="Close in MA_BAND and still no new high",
                    ),
                ),
                trigger_new_high=trigger_new_high,
                trigger_new_low=trigger_new_low,
            )

        if trigger_new_low:
            return TrendResult(
                stage="transition",
                zone=zone,
                state=TrendState.DOWN_WEAK,
                bias=Bias.DOWN_BIAS,
                direction=EdgeDirection.LOW_EDGE_DOWN,
                next_states=(TrendState.DOWN_WEAK, TrendState.RANGE),
                transition_rules=(
                    TransitionRule(target=TrendState.DOWN_WEAK, condition="Low <= L2*(1-eps)"),
                    TransitionRule(
                        target=TrendState.RANGE,
                        condition="Close in MA_BAND with no new low",
                    ),
                ),
                trigger_new_high=trigger_new_high,
                trigger_new_low=trigger_new_low,
            )
        state = TrendState.T_DOWN_RANGE if zone is not Zone.MA_BAND else TrendState.RANGE_DOWN_BIAS
        return TrendResult(
            stage="transition",
            zone=zone,
            state=state,
            bias=Bias.DOWN_BIAS,
            direction=EdgeDirection.LOW_EDGE_DOWN,
            next_states=(TrendState.DOWN_WEAK, TrendState.RANGE),
            transition_rules=(
                TransitionRule(target=TrendState.DOWN_WEAK, condition="Low <= L2*(1-eps)"),
                TransitionRule(target=TrendState.RANGE, condition="Close in MA_BAND and no new low"),
            ),
            trigger_new_high=trigger_new_high,
            trigger_new_low=trigger_new_low,
        )

    # Table 1B: high side confirmed only
    if context.high_confirmed and not context.low_confirmed:
        if None in (context.h1, context.h2):
            raise ValueError("h1/h2 are required when high side is confirmed")
        high_not_higher = context.h2 <= context.h1 * (1 + config.eps)
        if high_not_higher:
            if trigger_new_low:
                return TrendResult(
                    stage="transition",
                    zone=zone,
                    state=TrendState.DOWN_WEAK,
                    bias=Bias.DOWN_BIAS,
                    direction=EdgeDirection.HIGH_EDGE_DOWN_OR_FLAT,
                    next_states=(TrendState.DOWN_WEAK, TrendState.RANGE),
                    transition_rules=(
                        TransitionRule(target=TrendState.DOWN_WEAK, condition="Low <= L2*(1-eps)"),
                        TransitionRule(
                            target=TrendState.RANGE,
                            condition="Close returns to MA_BAND without new low confirmation",
                        ),
                    ),
                    trigger_new_high=trigger_new_high,
                    trigger_new_low=trigger_new_low,
                )
            state = (
                TrendState.T_DOWN_RANGE if zone is Zone.DOWN_ZONE else TrendState.RANGE_DOWN_BIAS
            )
            return TrendResult(
                stage="transition",
                zone=zone,
                state=state,
                bias=Bias.DOWN_BIAS,
                direction=EdgeDirection.HIGH_EDGE_DOWN_OR_FLAT,
                next_states=(TrendState.DOWN_WEAK, TrendState.RANGE),
                transition_rules=(
                    TransitionRule(target=TrendState.DOWN_WEAK, condition="Low <= L2*(1-eps)"),
                    TransitionRule(
                        target=TrendState.RANGE,
                        condition="Close in MA_BAND and still no new low",
                    ),
                ),
                trigger_new_high=trigger_new_high,
                trigger_new_low=trigger_new_low,
            )

        if trigger_new_high:
            return TrendResult(
                stage="transition",
                zone=zone,
                state=TrendState.UP_WEAK,
                bias=Bias.UP_BIAS,
                direction=EdgeDirection.HIGH_EDGE_UP,
                next_states=(TrendState.UP_WEAK, TrendState.RANGE),
                transition_rules=(
                    TransitionRule(target=TrendState.UP_WEAK, condition="High >= H2*(1+eps)"),
                    TransitionRule(
                        target=TrendState.RANGE,
                        condition="Close in MA_BAND with no new high",
                    ),
                ),
                trigger_new_high=trigger_new_high,
                trigger_new_low=trigger_new_low,
            )
        state = TrendState.T_UP_RANGE if zone is not Zone.MA_BAND else TrendState.RANGE_UP_BIAS
        return TrendResult(
            stage="transition",
            zone=zone,
            state=state,
            bias=Bias.UP_BIAS,
            direction=EdgeDirection.HIGH_EDGE_UP,
            next_states=(TrendState.UP_WEAK, TrendState.RANGE),
            transition_rules=(
                TransitionRule(target=TrendState.UP_WEAK, condition="High >= H2*(1+eps)"),
                TransitionRule(target=TrendState.RANGE, condition="Close in MA_BAND and no new high"),
            ),
            trigger_new_high=trigger_new_high,
            trigger_new_low=trigger_new_low,
        )

    # No confirmed side: neutral fallback
    return TrendResult(
        stage="transition",
        zone=zone,
        state=TrendState.RANGE,
        bias=Bias.NEUTRAL,
        direction=EdgeDirection.UNDEFINED,
        next_states=(TrendState.RANGE,),
        transition_rules=(),
        trigger_new_high=trigger_new_high,
        trigger_new_low=trigger_new_low,
    )
