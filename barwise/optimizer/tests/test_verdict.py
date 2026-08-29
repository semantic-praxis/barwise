"""The gate, as data.

These pin the DECISION, which the delta report renders and `report.json`
carries. Before it was extracted, the branch lived only inside the
markdown renderer, so the only way to act on it was to read a paragraph
-- and `compile-runner.sh` grepped that paragraph, which would have gone
silently empty on a reword.

The saturation and missing-arm cases matter most: both are ways for a
margin to exist arithmetically while meaning nothing, and both would
otherwise read as an ordinary win or loss.
"""

from __future__ import annotations

import pytest

from barwise_optimizer.verdict import decide

BAND = 0.086


def v(shipped, candidate, *, baseline=0.4, resolvable=BAND, saturated=False):
    return decide(
        shipped_mean=shipped,
        baseline_mean=baseline,
        candidate_mean=candidate,
        resolvable=resolvable,
        saturated=saturated,
    )


def test_beats_only_outside_the_band():
    assert v(0.50, 0.70).gate == "beats"
    assert v(0.50, 0.70).worth_gating is True


def test_a_win_inside_the_band_is_a_tie_not_a_win():
    # The whole point of the resolvable difference: a positive margin
    # that the run cannot resolve is not evidence of anything.
    result = v(0.800, 0.850)
    assert result.margin_over_shipped > 0
    assert result.gate == "ties"
    assert result.worth_gating is False


def test_exactly_at_the_band_is_a_tie():
    # The boundary belongs to "not resolved": `> resolvable` is the test
    # for a real difference, so equality has to fall the other way.
    assert v(0.800, 0.800 + BAND).gate == "ties"


def test_loses_reproduces_the_2026_08_29_bootstrap_run():
    # The run that motivated barwise-899: candidate 0.355 against a
    # shipped 0.814. It beat nothing, and the report called it a
    # near-tie because it was compared to the seed.
    result = v(0.814, 0.355, baseline=0.380)
    assert result.gate == "loses"
    assert result.worth_gating is False
    assert "do not spend" in result.summary.lower()
    # It did also lose to its seed, and that is reported separately --
    # the two margins answer different questions.
    assert result.margin_over_baseline == pytest.approx(-0.025)


def test_saturation_overrides_every_margin():
    # Floored arms compare equal while being nothing of the sort, and
    # the flooring collapses the spread `resolvable` comes from. A
    # margin computed off that is meaningless, not merely small.
    result = v(0.0, 0.9, resolvable=0.002, saturated=True)
    assert result.gate == "unmeasurable"
    assert result.worth_gating is False
    assert result.margin_over_shipped == 0.0


def test_a_missing_shipped_arm_is_unmeasurable_not_a_landslide():
    # `--seed-from default` skips the shipped sweep because the baseline
    # IS the shipped prompt. Treating the absent mean as 0.0 would report
    # the candidate beating production by its entire score.
    result = v(None, 0.9)
    assert result.gate == "unmeasurable"
    assert result.worth_gating is False
    assert result.margin_over_shipped == 0.0


def test_worth_gating_is_true_only_for_beats():
    gates = {
        v(0.50, 0.70).gate: v(0.50, 0.70).worth_gating,
        v(0.80, 0.81).gate: v(0.80, 0.81).worth_gating,
        v(0.90, 0.50).gate: v(0.90, 0.50).worth_gating,
        v(None, 0.5).gate: v(None, 0.5).worth_gating,
    }
    assert gates == {"beats": True, "ties": False, "loses": False, "unmeasurable": False}


def test_the_verdict_serialises_for_report_json():
    d = v(0.90, 0.50).as_dict()
    assert set(d) == {
        "gate", "margin_over_shipped", "margin_over_baseline",
        "resolvable", "saturated", "worth_gating", "summary",
    }
    import json
    json.dumps(d)  # must survive the trip into report.json
