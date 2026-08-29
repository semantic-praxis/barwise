"""The metric, against the real scorer and the recorded payloads.

These run the actual `barwise prompt score` subprocess. That is
deliberate -- the seam is the thing most likely to break, and a mocked
subprocess would test this file's idea of the CLI rather than the CLI.
No API key and no network: the payloads are the recorded answer keys
whose scores are already pinned in promptlab.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from barwise_optimizer.barwise_cli import (
    BarwiseCliError,
    CaseScore,
    default_instructions,
    extraction_schema,
    score_extraction,
)
from barwise_optimizer.metric import (
    MetricLog,
    make_metric,
    resolvable_difference,
    sample_sd,
)


def repo_root() -> Path:
    here = Path(__file__).resolve()
    for parent in here.parents:
        if (parent / "packages" / "cli").is_dir():
            return parent
    raise AssertionError("monorepo not found")


FIXTURES = repo_root() / "packages" / "promptlab" / "tests" / "fixtures" / "responses"


class Prediction:
    def __init__(self, extraction):
        self.extraction = extraction


class Example:
    def __init__(self, case_id):
        self.case_id = case_id


def payload(case_id: str) -> str:
    return (FIXTURES / f"{case_id}.json").read_text(encoding="utf-8")


def test_answer_key_scores_one():
    # The pin, reached through the subprocess seam. If the CLI moves or
    # its output shape changes, this is what says so.
    metric = make_metric()
    score = metric(Example("order-management"), Prediction(payload("order-management")))
    assert score == pytest.approx(1.0)


def test_schema_comes_from_the_cli_and_is_the_real_one():
    # Not a literal in this repo. Checked by shape rather than by bytes,
    # because pinning bytes would make every schema edit fail here for
    # no reason.
    schema = extraction_schema()
    assert schema["type"] == "object"
    assert "object_types" in schema["properties"]
    assert "fact_types" in schema["properties"]


def test_unparseable_answer_scores_zero_rather_than_raising():
    # An unparseable answer is a bad answer, not a crash. Aborting the
    # compile on one would throw away every call already spent.
    log = MetricLog()
    metric = make_metric(log)
    assert metric(Example("order-management"), Prediction("not json at all")) == 0.0
    assert log.unparseable == 1
    assert log.scores == [0.0]


def test_missing_field_scores_zero():
    log = MetricLog()
    metric = make_metric(log)

    class Empty:
        pass

    assert metric(Example("order-management"), Empty()) == 0.0
    assert log.unparseable == 1


def test_fenced_json_is_tolerated():
    # Models fence JSON even when asked not to. The production parser
    # tolerates it, so scoring it as a modelling failure would measure a
    # formatting habit.
    body = payload("project-staffing")
    metric = make_metric()
    score = metric(Example("project-staffing"), Prediction(f"```json\n{body}\n```"))
    assert score == pytest.approx(1.0)


def test_log_keeps_rule_tallies_not_just_the_mean():
    # The whole reason the log exists: a named rule is a count, and a
    # count is legible at sample sizes where a mean is not.
    log = MetricLog()
    metric = make_metric(log)

    doc = json.loads(payload("order-management"))
    fact = doc["fact_types"][0]
    doc["inferred_constraints"].append(
        {
            "type": "exclusion",
            "fact_type": fact["name"],
            "roles": [fact["roles"][0]["player"]],
            "description": "malformed: exclusion over a single role",
            "confidence": "high",
            "source_references": [{"lines": [1, 2], "excerpt": "test"}],
        }
    )
    metric(Example("order-management"), Prediction(json.dumps(doc)))

    assert sum(log.corrections_by_category.values()) == 1
    assert log.mean < 1.0


def test_resolvable_difference_matches_the_suite_formula():
    # 1.96 * SE * sqrt(2), the figure runSuite reports. Restated here so
    # a compile run can say whether its margin cleared it.
    assert resolvable_difference(0.1, 5) == pytest.approx(1.96 * (0.1 / 5**0.5) * 2**0.5)


def test_one_sample_resolves_nothing():
    # Distinct from "resolves zero". With one sample the spread is not
    # knowable at all, and infinity is the honest answer.
    assert resolvable_difference(0.1, 1) == float("inf")


def test_case_means_collapse_repeats_of_one_case():
    log = MetricLog()
    for case_id, score in [("vendor", 0.281), ("sub", 0.460), ("inc", 0.646)]:
        for _ in range(5):
            log._append(case_id, score)
    # approx, not ==: summing five copies of 0.460 and dividing lands on
    # 0.4600000000000001. The mean is right; binary floating point is
    # not the thing under test.
    assert log.case_means() == pytest.approx([0.281, 0.460, 0.646])
    # 15 evaluations, 3 independent observations. The distinction is the
    # whole fix; a flat `scores` list cannot express it.
    assert len(log.scores) == 15


def test_resolvable_is_computed_over_cases_not_repeats():
    """The barwise-908 arithmetic, pinned.

    The 2026-08-29 mipro run scored three dev cases five times each and
    got byte-identical scores per case -- DSPy defaults to `cache=True`,
    so the repeats were the same response read again. The old pairing
    took the sd over all 15 scores (dominated by BETWEEN-CASE spread,
    0.154) and divided by sqrt(5 repeats), reporting 0.191 where the
    honest figure over case means is 0.292. It understated the threshold
    by 35%, which is the direction that calls margins resolvable when
    they are not.

    Written with identical repeats on purpose: that is the input where
    the two computations diverge most, and it is the input a cached run
    actually produces.
    """
    log = MetricLog()
    for case_id, score in [("vendor", 0.281), ("sub", 0.460), ("inc", 0.646)]:
        for _ in range(5):
            log._append(case_id, score)

    means = log.case_means()
    honest = resolvable_difference(sample_sd(means), len(means))
    assert honest == pytest.approx(0.292, abs=0.001)

    # And it must NOT be the old figure. Asserting the correct value
    # alone would still pass if someone reverted to the flat list and
    # the constant drifted with it; naming the wrong answer is what
    # makes the regression visible.
    flat = resolvable_difference(sample_sd(log.scores), 5)
    assert flat == pytest.approx(0.191, abs=0.001)
    assert honest > flat


def test_a_failure_keeps_scores_and_case_ids_in_step():
    # The three failure paths used to append to `scores` directly. A
    # fourth appender that forgot `case_ids` would desynchronise the
    # pair, and `case_means` would then silently attribute scores to the
    # wrong cases rather than fail.
    log = MetricLog()
    log._append("vendor", 0.9)
    log.record_failure("sub", "unparseable")
    log.record_failure("inc", "failed")
    assert len(log.scores) == len(log.case_ids) == 3
    assert log.unparseable == 1 and log.failed == 1
    assert log.case_means() == pytest.approx([0.9, 0.0, 0.0])


def test_sample_sd_uses_n_minus_one():
    assert sample_sd([1.0, 2.0, 3.0]) == pytest.approx(1.0)
    assert sample_sd([1.0]) == 0.0


def test_a_floored_score_is_distinguished_from_a_genuine_zero():
    """The detector the saturation guard rests on, exercised for real.

    `scoreExtraction` clamps at zero, so a run whose penalties exceed
    1.0 reports 0.000 however much worse than that it was -- and two
    such runs compare equal while being nothing of the sort. The
    evidence that a zero is a clamp is a rubric that still passed
    something.

    Added because a mutation making `floored` always False was caught by
    nothing: the report tests supply the count as a literal, so they
    assert the consumer and never the computation. The same shape as the
    barwise-840 sweep.
    """
    doc = json.loads(payload("order-management"))
    fact = doc["fact_types"][0]
    # Enough malformed constraints to drive the penalty past 1.0 at
    # 0.02 each, while the rubric keeps passing.
    for i in range(60):
        doc["inferred_constraints"].append(
            {
                "type": "exclusion",
                "fact_type": fact["name"],
                "roles": [fact["roles"][0]["player"]],
                "description": f"malformed {i}: exclusion over a single role",
                "confidence": "high",
                "source_references": [{"lines": [1, 2], "excerpt": "test"}],
            }
        )

    case = score_extraction("order-management", json.dumps(doc))

    assert case.score == 0.0
    assert case.rubric_passed > 0
    assert case.floored is True


def test_an_answer_key_is_not_floored():
    case = score_extraction("order-management", payload("order-management"))
    assert case.score == pytest.approx(1.0)
    assert case.floored is False


def test_a_zero_with_nothing_passing_is_not_called_floored():
    # A genuine nothing, not a clamp. Distinguishing the two is the
    # whole job.
    case = CaseScore(case_id="x", score=0.0, rubric_passed=0, rubric_total=6)
    assert case.floored is False


def test_the_log_counts_floored_evaluations():
    log = MetricLog()
    log.record(CaseScore(case_id="x", score=0.0, rubric_passed=4, rubric_total=6))
    log.record(CaseScore(case_id="y", score=0.9, rubric_passed=6, rubric_total=6))

    assert log.floored == 1
    assert log.summary()["floored"] == 1


def test_a_stale_cli_build_is_diagnosed_rather_than_raised_raw(tmp_path, monkeypatch):
    """A CLI older than this lane says so, and says how to fix it.

    The seam runs `packages/cli/dist/index.js` -- built output, not
    sources -- so pulling a branch that adds a command leaves this lane
    calling a CLI without it. Commander answers "unknown command
    'artifact'", which names the symptom and not the cause; the first
    time it happened it cost an attempted compilation to work out.
    """
    stub = tmp_path / "old-cli.js"
    stub.write_text(
        "console.error(\"error: unknown command 'artifact'\");\nprocess.exit(1);\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("BARWISE_CLI", f"node {stub}")

    with pytest.raises(BarwiseCliError) as raised:
        default_instructions(provider="anthropic", model="claude-haiku-4-5")

    assert "npm run build" in str(raised.value)
    assert "BUILT output" in str(raised.value)


def test_an_ordinary_cli_failure_still_reports_plainly(tmp_path, monkeypatch):
    # Only the stale-build shape gets the special message; everything
    # else must not be dressed up as one.
    stub = tmp_path / "broken-cli.js"
    stub.write_text(
        'console.error("Error: no such eval case");\nprocess.exit(1);\n', encoding="utf-8"
    )
    monkeypatch.setenv("BARWISE_CLI", f"node {stub}")

    with pytest.raises(BarwiseCliError) as raised:
        default_instructions()

    assert "npm run build" not in str(raised.value)
    assert "no such eval case" in str(raised.value)


def test_scored_excludes_runs_that_produced_no_tallies():
    # The denominator behind every rule count. A failed or unparseable
    # run is appended as 0.0 and contributes nothing to the tallies, so
    # dividing occurrences by `evaluations` divides by runs that could
    # not have contributed to them.
    log = MetricLog()
    log.record(CaseScore(case_id="a", score=0.9, rubric_passed=6, rubric_total=6))
    log.unparseable += 1
    log.scores.append(0.0)
    log.failed += 1
    log.scores.append(0.0)

    assert log.summary()["evaluations"] == 3
    assert log.summary()["scored"] == 1
