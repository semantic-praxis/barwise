"""The compile's verdict, as data rather than as prose.

Every input to the decision -- the three arm means, the resolvable
difference, whether the run saturated -- was already computed, and the
decision itself was already made deterministically. It was then emitted
only as English inside a markdown document, so acting on it meant a
person (or a `grep` over wording nobody owns) reading a paragraph.

That is the same shape as an offline re-score that lives in a throwaway
script: a computation whose only output is human-readable decays, and
anything downstream has to re-derive it. `compile-runner.sh` grepped the
report's prose for exactly this, which would have gone silently empty the
first time a sentence was reworded.

So the verdict is computed here, `report.json` carries it, and the
markdown renders it. One authority, two presentations.
"""

from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import Literal

Gate = Literal["beats", "ties", "loses", "unmeasurable"]


@dataclass(frozen=True)
class Verdict:
    """What the run decided, and what it licenses next."""

    #: Against what production sends the target model today.
    gate: Gate
    #: Candidate minus shipped. Positive means the candidate scored higher.
    margin_over_shipped: float
    #: Candidate minus the seed the search started from.
    margin_over_baseline: float
    #: The smallest gap this run's precision resolves at 95%.
    resolvable: float
    #: True when flooring collapsed the spread, which makes every margin
    #: meaningless rather than merely small.
    saturated: bool
    #: Whether a keyed `barwise prompt eval` arm is worth its calls.
    worth_gating: bool
    #: One line a script or a person can act on without reading further.
    summary: str

    def as_dict(self) -> dict:
        return asdict(self)


def decide(
    *,
    shipped_mean: float | None,
    baseline_mean: float | None,
    candidate_mean: float | None,
    resolvable: float,
    saturated: bool,
) -> Verdict:
    """The gate, from the three arms.

    Saturation is checked first and overrides everything: `scoreExtraction`
    clamps at zero, so floored arms compare equal while being nothing of
    the sort, and the clamping also collapses the spread `resolvable` is
    derived from. A margin computed from that is not small, it is
    meaningless -- which is a different instruction to the reader than
    "not resolved".

    A missing arm is `unmeasurable` rather than a zero. `--seed-from
    default` skips the shipped sweep because the baseline IS the shipped
    prompt, and treating an absent mean as 0.0 would report a candidate
    beating production by its whole score.
    """
    over_baseline = (
        candidate_mean - baseline_mean
        if candidate_mean is not None and baseline_mean is not None
        else 0.0
    )

    if saturated:
        return Verdict(
            gate="unmeasurable",
            margin_over_shipped=0.0,
            margin_over_baseline=over_baseline,
            resolvable=resolvable,
            saturated=True,
            worth_gating=False,
            summary=(
                "Arms floored, so the margins mean nothing. Read the rule "
                "counts and fix what they name before comparing means."
            ),
        )

    if shipped_mean is None or candidate_mean is None:
        return Verdict(
            gate="unmeasurable",
            margin_over_shipped=0.0,
            margin_over_baseline=over_baseline,
            resolvable=resolvable,
            saturated=False,
            worth_gating=False,
            summary=(
                "No shipped arm to gate against, so this run cannot say "
                "whether the candidate beats production."
            ),
        )

    over_shipped = candidate_mean - shipped_mean

    if over_shipped > resolvable:
        return Verdict(
            gate="beats",
            margin_over_shipped=over_shipped,
            margin_over_baseline=over_baseline,
            resolvable=resolvable,
            saturated=False,
            worth_gating=True,
            summary=(
                f"Beats what we ship by {over_shipped:+.3f}, outside the "
                f"{resolvable:.3f} noise band. Worth a keyed eval arm."
            ),
        )

    if abs(over_shipped) <= resolvable:
        return Verdict(
            gate="ties",
            margin_over_shipped=over_shipped,
            margin_over_baseline=over_baseline,
            resolvable=resolvable,
            saturated=False,
            worth_gating=False,
            summary=(
                f"Ties what we ship ({over_shipped:+.3f}, inside the "
                f"{resolvable:.3f} band). Beating the seed is not the bar; "
                "nothing here to gate."
            ),
        )

    return Verdict(
        gate="loses",
        margin_over_shipped=over_shipped,
        margin_over_baseline=over_baseline,
        resolvable=resolvable,
        saturated=False,
        worth_gating=False,
        summary=(
            f"Loses to what we ship by {abs(over_shipped):.3f}, outside the "
            f"{resolvable:.3f} band. Do not spend a keyed arm confirming it."
        ),
    )
