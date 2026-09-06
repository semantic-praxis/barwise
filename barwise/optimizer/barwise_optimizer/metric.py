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
    # Parallel to `scores`, one entry per evaluation. Kept because the
    # spread that matters is BETWEEN CASES, not between repeats of one
    # case, and a flat list of scores cannot tell them apart -- which is
    # exactly how `resolvable` came to divide a between-case spread by a
    # repeat count (barwise-908).
    case_ids: list[str] = field(default_factory=list)
    errors_by_rule: Counter = field(default_factory=Counter)
    warnings_by_rule: Counter = field(default_factory=Counter)
    corrections_by_category: Counter = field(default_factory=Counter)
    # One entry per SCORED evaluation, not per evaluation: a run that
    # produced nothing scorable produced no elements either, and a zero
    # here would read as restraint (barwise-853).
    element_counts: list[int] = field(default_factory=list)
    unparseable: int = 0
    failed: int = 0
    floored: int = 0

    def record(self, case: CaseScore) -> None:
        self._append(case.case_id, case.score)
        self.element_counts.append(case.element_count)
        if case.floored:
            self.floored += 1
        self.errors_by_rule.update(case.errors_by_rule)
        self.warnings_by_rule.update(case.warnings_by_rule)
        self.corrections_by_category.update(case.corrections_by_category)

    def record_failure(self, case_id: str, kind: str) -> None:
        """A run that produced no score: unparseable, or the scorer refused.

        Appended as 0.0, like `record`, so the mean reflects it -- but
        through the same entry point, because three call sites appending
        to `scores` by hand is how `scores` and `case_ids` would drift
        apart, and a drifted pair is silently wrong rather than loud.
        """
        if kind == "unparseable":
            self.unparseable += 1
        elif kind == "failed":
            self.failed += 1
        else:  # pragma: no cover - guards a typo at the call site
            raise ValueError(f"unknown failure kind: {kind!r}")
        self._append(case_id, 0.0)

    def _append(self, case_id: str, score: float) -> None:
        self.scores.append(score)
        self.case_ids.append(case_id)

    def resolvable(self) -> tuple[float, int]:
        """This arm's resolvable difference, and the n it was computed over.

        Returned together on purpose. The defect this replaces was not a
        wrong formula but a wrong PAIRING -- a between-case spread
        divided by a repeat count (barwise-908) -- and a function that
        hands back only the figure invites the next caller to supply its
        own n. Here there is nothing to supply.
        """
        means = self.case_means()
        return resolvable_difference(sample_sd(means), len(means)), len(means)

    def case_means(self) -> list[float]:
        """One mean per distinct case, in first-seen order.

        The unit an arm's uncertainty should be computed over. Repeats of
        a single case are not independent observations -- under DSPy's
        default `cache=True` they are literally the same response read
        again -- so treating 15 scores from 3 cases as 15 samples claims
        a precision the run does not have.
        """
        totals: dict[str, list[float]] = {}
        for case_id, score in zip(self.case_ids, self.scores):
            totals.setdefault(case_id, []).append(score)
        return [sum(v) / len(v) for v in totals.values()]

    @property
    def scored(self) -> int:
        """Evaluations that produced rule tallies.

        Not the same as `len(scores)`. A run that failed or came back
        unparseable is appended as a 0.0 and contributes NO tallies, so
        counting rule occurrences over `evaluations` divides by a
        denominator that includes runs which could not have contributed
        to it. Two arms with different failure counts are then compared
        as though their raw counts were commensurate, which they are
        not.
        """
        return len(self.scores) - self.unparseable - self.failed

    @property
    def mean(self) -> float:
        return sum(self.scores) / len(self.scores) if self.scores else 0.0

    @property
    def mean_element_count(self) -> float:
        """Mean model size over scored runs -- the denominator behind the mean."""
        counts = self.element_counts
        return sum(counts) / len(counts) if counts else 0.0

    def summary(self) -> dict:
        return {
            "evaluations": len(self.scores),
            "scored": self.scored,
            "mean": self.mean,
            "meanElementCount": self.mean_element_count,
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


def _report(progress, example, score: float, outcome: str | None) -> None:
    """Hand one evaluation to the progress callback, if there is one.

    Swallows a throwing callback for the reason the observability sinks
    do: progress that can fail the run it reports on is worse than no
    progress, and a compile costs real money to reach this point.
    """
    if progress is None:
        return
    try:
        progress(getattr(example, "case_id", "?"), score, outcome)
    except Exception:  # noqa: BLE001
        pass


def make_metric(log: MetricLog | None = None, progress=None):
    """Build the metric DSPy calls, optionally accumulating into `log`.

    A candidate that produces nothing parseable scores 0 rather than
    raising. That matches the suite runner's treatment and it is the
    right shape for a search: an unparseable answer *is* a bad answer,
    and aborting the compile on one would throw away the run.

    `progress(case_id, score, outcome)` is called once per evaluation
    when supplied. It exists because a compile is otherwise silent
    between tqdm ticks that are ~80s apart at sonnet latency, and a
    healthy run and a hung one look identical from outside
    (barwise-897). Every return path reports, including the two that
    score zero without calling the scorer -- silence on the failure
    paths is exactly what made the silence dangerous.
    """

    def metric(example, prediction, trace=None) -> float:
        payload = _extract_payload(prediction)
        if payload is None:
            if log is not None:
                log.record_failure(example.case_id, "unparseable")
            _report(progress, example, 0.0, "no extraction field")
            return 0.0
        try:
            json.loads(payload)
        except json.JSONDecodeError:
            if log is not None:
                log.record_failure(example.case_id, "unparseable")
            _report(progress, example, 0.0, "not JSON")
            return 0.0

        try:
            case = score_extraction(example.case_id, payload)
        except BarwiseCliError:
            # The scorer itself refused -- a payload it could not parse
            # into a model. Same verdict, counted apart from a malformed
            # string so the report can tell the two failures apart.
            if log is not None:
                log.record_failure(example.case_id, "failed")
            _report(progress, example, 0.0, "scorer refused")
            return 0.0

        if log is not None:
            log.record(case)
        _report(progress, example, case.score, None)
        return case.score

    return metric


def resolvable_difference(sd: float, samples: int) -> float:
    """The smallest difference two means can be distinguished by.

    1.96 * SE * sqrt(2), the same figure `runSuite` reports, restated
    here so a compile run can say whether its winning margin cleared it
    without an operator computing it. Defining that out of existence for
    the caller is the point.

    **`sd` and `samples` must describe the same unit.** They did not
    once: `sd` was taken over every score (3 cases x 5 repeats) while
    `samples` was the repeat count, so a between-case spread of 0.154
    was divided by sqrt(5) and reported 0.191 where the honest figure
    over case means was 0.292 -- understating the threshold by 35% and
    calling margins resolvable that were not (barwise-908). Feed it
    `MetricLog.case_means()` and that list's length.
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
