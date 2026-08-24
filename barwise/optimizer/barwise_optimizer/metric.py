"""The metric: a candidate extraction, scored by the deterministic scorer.

DSPy wants a float. The float alone is the weaker half of what the run
produces, so this module keeps both: the score it returns to the
optimizer, and a record of the rule tallies behind every evaluation.

That distinction is the point. At `repeat=5` the suite's resolvable
difference is about 0.086, so a candidate winning by 0.03 has not been
shown to be better. A named rule going from 18 occurrences to 4 is a
direct count from the same calls, and it says what changed rather than
only that something did.
"""

from __future__ import annotations

import json
from collections import Counter
from dataclasses import dataclass, field

import dspy

from .barwise_cli import BarwiseCliError, CaseScore, score_extraction


@dataclass
class MetricLog:
    """What every evaluation produced, accumulated across a run.

    Held separately from the score so the delta report can be written
    from observations rather than from the optimizer's summary, which
    reports only the mean it selected on.
    """

    scores: list[float] = field(default_factory=list)
    errors_by_rule: Counter = field(default_factory=Counter)
    warnings_by_rule: Counter = field(default_factory=Counter)
    corrections_by_category: Counter = field(default_factory=Counter)
    unparseable: int = 0
    failed: int = 0
    floored: int = 0

    def record(self, case: CaseScore) -> None:
        self.scores.append(case.score)
        if case.floored:
            self.floored += 1
        self.errors_by_rule.update(case.errors_by_rule)
        self.warnings_by_rule.update(case.warnings_by_rule)
        self.corrections_by_category.update(case.corrections_by_category)

    @property
    def mean(self) -> float:
        return sum(self.scores) / len(self.scores) if self.scores else 0.0

    def summary(self) -> dict:
        return {
            "evaluations": len(self.scores),
            "mean": self.mean,
            "unparseable": self.unparseable,
            "failed": self.failed,
            "floored": self.floored,
            "errorsByRule": dict(self.errors_by_rule),
            "warningsByRule": dict(self.warnings_by_rule),
            "correctionsByCategory": dict(self.corrections_by_category),
        }


def _extract_payload(prediction) -> str | None:
    text = getattr(prediction, "extraction", None)
    if not isinstance(text, str):
        return None
    text = text.strip()
    # Some models fence JSON even when asked not to. The production
    # parser tolerates it, so tolerating it here keeps the metric from
    # scoring a formatting habit as a modelling failure.
    if text.startswith("```"):
        body = text.split("\n", 1)[-1]
        if body.rstrip().endswith("```"):
            body = body.rstrip()[: -len("```")]
        text = body.strip()
    return text or None


def make_metric(log: MetricLog | None = None):
    """Build the metric DSPy calls, optionally accumulating into `log`.

    A candidate that produces nothing parseable scores 0 rather than
    raising. That matches the suite runner's treatment and it is the
    right shape for a search: an unparseable answer *is* a bad answer,
    and aborting the compile on one would throw away the run.
    """

    def metric(example, prediction, trace=None) -> float:
        payload = _extract_payload(prediction)
        if payload is None:
            if log is not None:
                log.unparseable += 1
                log.scores.append(0.0)
            return 0.0
        try:
            json.loads(payload)
        except json.JSONDecodeError:
            if log is not None:
                log.unparseable += 1
                log.scores.append(0.0)
            return 0.0

        try:
            case = score_extraction(example.case_id, payload)
        except BarwiseCliError:
            # The scorer itself refused -- a payload it could not parse
            # into a model. Same verdict, counted apart from a malformed
            # string so the report can tell the two failures apart.
            if log is not None:
                log.failed += 1
                log.scores.append(0.0)
            return 0.0

        if log is not None:
            log.record(case)
        return case.score

    return metric


def resolvable_difference(sd: float, samples: int) -> float:
    """The smallest difference two means can be distinguished by.

    1.96 * SE * sqrt(2), the same figure `runSuite` reports, restated
    here so a compile run can say whether its winning margin cleared it
    without an operator computing it. Defining that out of existence for
    the caller is the point.
    """
    if samples < 2:
        return float("inf")
    standard_error = sd / (samples ** 0.5)
    return 1.96 * standard_error * (2 ** 0.5)


def sample_sd(values: list[float]) -> float:
    """Sample standard deviation (n-1), matching the suite's dispersion."""
    n = len(values)
    if n < 2:
        return 0.0
    mean = sum(values) / n
    return (sum((v - mean) ** 2 for v in values) / (n - 1)) ** 0.5
