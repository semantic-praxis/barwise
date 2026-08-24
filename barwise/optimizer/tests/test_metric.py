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

from barwise_optimizer.barwise_cli import extraction_schema, score_extraction
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


def test_sample_sd_uses_n_minus_one():
    assert sample_sd([1.0, 2.0, 3.0]) == pytest.approx(1.0)
    assert sample_sd([1.0]) == 0.0
