"""Run an optimizer under an explicit budget, and say what it resolved.

Three things this module refuses to do by default, each because a
library default would be wrong here rather than merely suboptimal.

**It will not start without a call budget.** Every evaluation is a paid
call against a real transcript. An optimizer left to its own defaults
can issue thousands, and the operator finds out from the bill.

**It will not take the bootstrap demo default.** 4-16 demos on a
4,540-token prompt is a 3x to 8x prompt paid on every call
(`export.py` carries the measurement).

**It will not report a winner without saying whether the win resolved.**
At `repeat=5` the suite's resolvable difference is about 0.086. A
candidate ahead by 0.03 has not been shown to be better, and a run
report that prints only the mean invites exactly that reading.
"""

from __future__ import annotations

import argparse
import json
import os
from dataclasses import dataclass
from pathlib import Path

import dspy

from .dataset import compile_set, load_suite, report_set
from .export import (
    Provenance,
    demos_from_program,
    match_for_target,
    render_delta_report,
    write_candidate,
    write_delta_report,
)
from .metric import MetricLog, make_metric, resolvable_difference, sample_sd
from .program import SEED_INSTRUCTIONS, ExtractionProgram

OPTIMIZERS = ("bootstrap", "mipro", "gepa")


class BudgetError(RuntimeError):
    """The run was not given enough to be interpretable."""


@dataclass(frozen=True)
class RunConfig:
    target_model: str
    optimizer: str
    max_calls: int
    samples_per_candidate: int
    max_demos: int = 2
    proposer_model: str | None = None

    def validate(self) -> None:
        if self.optimizer not in OPTIMIZERS:
            raise BudgetError(
                f"Unknown optimizer {self.optimizer!r}. Choose one of: "
                f"{', '.join(OPTIMIZERS)}."
            )
        if self.max_calls < 1:
            raise BudgetError(
                "A call budget is required. Every evaluation is a paid call, "
                "and an optimizer left to its defaults will spend until it is "
                "satisfied rather than until you are."
            )
        if self.samples_per_candidate < 2:
            raise BudgetError(
                "samples_per_candidate must be at least 2. With one sample "
                "per candidate nothing about the spread is knowable, so the "
                "run cannot say whether its winner beat the noise -- which is "
                "the only question that makes the result usable."
            )
        if self.optimizer == "gepa" and not self.proposer_model:
            raise BudgetError(
                "gepa requires --proposer-model: it reflects on the program "
                "with a second model to propose new instructions, and DSPy "
                "refuses to construct without one. Raised here so it costs a "
                "flag rather than a run."
            )


def build_optimizer(config: RunConfig, metric):
    """Construct the DSPy optimizer named by the config.

    Imported by name rather than dispatched dynamically so an unknown
    optimizer fails at configuration time, before any call is spent.

    The LM check is uniform on purpose. `MIPROv2` reads
    `dspy.settings.lm` in its constructor and raises without one, while
    `BootstrapFewShot` constructs happily and fails much later -- so
    building the optimizer before `dspy.configure` breaks one choice and
    not another, which is the kind of inconsistency that gets diagnosed
    as "mipro is broken". Requiring it for all three makes the ordering
    a stated precondition rather than a property of whichever optimizer
    was picked.
    """
    if dspy.settings.lm is None:
        raise BudgetError(
            "No LM is configured. Call dspy.configure(lm=...) before building "
            "an optimizer -- MIPROv2 reads it at construction and the others "
            "would fail later, at a point that no longer names this cause."
        )
    if config.optimizer == "bootstrap":
        # No proposer: bootstrap selects demos, it does not rewrite text.
        return dspy.BootstrapFewShot(
            metric=metric,
            max_bootstrapped_demos=config.max_demos,
            max_labeled_demos=0,
            max_rounds=1,
        )

    # The two instruction-rewriting optimizers each need a *second*
    # model to propose text, and each calls it something different.
    # `proposer_model` is that model. It was already recorded in
    # provenance, so leaving it unwired would have meant a candidate
    # naming a proposer that never proposed anything.
    proposer = dspy.LM(config.proposer_model) if config.proposer_model else None

    if config.optimizer == "mipro":
        return dspy.MIPROv2(
            metric=metric,
            max_bootstrapped_demos=config.max_demos,
            max_labeled_demos=0,
            num_threads=1,
            **({"prompt_model": proposer} if proposer else {}),
        )
    return dspy.GEPA(
        metric=metric,
        max_metric_calls=config.max_calls,
        reflection_lm=proposer,
    )


def evaluate(program, examples, metric, samples: int) -> MetricLog:
    """Score a program over a set, `samples` times per case.

    Sequential on purpose. These are paid calls against a rate-limited
    provider, and the run's value is in its record rather than its wall
    clock.
    """
    log = MetricLog()
    for _ in range(samples):
        for example in examples:
            prediction = program(transcript=example.transcript)
            metric(example, prediction)
    return log


def run(config: RunConfig, out_dir: Path) -> dict:
    """Compile, evaluate on the held-out split, and write the artifacts."""
    config.validate()
    suite = load_suite()

    baseline_log = MetricLog()
    candidate_log = MetricLog()

    train = compile_set()
    dev = report_set()

    baseline = ExtractionProgram(SEED_INSTRUCTIONS)
    evaluate(baseline, dev, make_metric(baseline_log), config.samples_per_candidate)

    optimizer = build_optimizer(config, make_metric())
    compiled = optimizer.compile(ExtractionProgram(SEED_INSTRUCTIONS), trainset=train)

    evaluate(compiled, dev, make_metric(candidate_log), config.samples_per_candidate)

    sd = sample_sd(candidate_log.scores)
    resolvable = resolvable_difference(sd, config.samples_per_candidate)

    version = f"dspy-{config.optimizer}-1"
    artifact_path = out_dir / f"extraction.{version}.prompt.yaml"
    write_candidate(
        artifact_path,
        version=version,
        instructions=compiled.instructions,
        # Derived from the target, never omitted: an artifact without a
        # match block never resolves, so the gating run would silently
        # measure the default instead of this candidate.
        match=match_for_target(config.target_model),
        demos=demos_from_program(compiled),
        provenance=Provenance(
            optimizer=f"dspy/{config.optimizer} ({dspy.__version__})",
            proposer_model=config.proposer_model,
            scored_against=config.target_model,
            suite_version=suite.version,
            score=candidate_log.mean,
        ),
    )

    report = render_delta_report(
        candidate_version=version,
        baseline=baseline_log.summary(),
        candidate=candidate_log.summary(),
        samples_per_candidate=config.samples_per_candidate,
        resolvable=resolvable,
        artifact_path=artifact_path,
    )
    write_delta_report(out_dir / f"delta-{version}.md", report)

    return {
        "artifact": str(artifact_path),
        "baseline": baseline_log.summary(),
        "candidate": candidate_log.summary(),
        "resolvable": resolvable,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="barwise-optimize",
        description="Compile an extraction prompt with DSPy (offline dev tool).",
    )
    parser.add_argument("--target-model", required=True, help="Model the prompt is for.")
    parser.add_argument("--optimizer", default="bootstrap", choices=OPTIMIZERS)
    parser.add_argument(
        "--max-calls",
        type=int,
        required=True,
        help="Hard ceiling on LLM calls. Required: there is no safe default.",
    )
    parser.add_argument(
        "--samples-per-candidate",
        type=int,
        required=True,
        help="Evaluations per case. Below 2 the run cannot report a spread.",
    )
    parser.add_argument("--max-demos", type=int, default=2)
    parser.add_argument("--proposer-model", default=None)
    parser.add_argument("--out", default="out", help="Directory for candidate + report.")
    args = parser.parse_args(argv)

    config = RunConfig(
        target_model=args.target_model,
        optimizer=args.optimizer,
        max_calls=args.max_calls,
        samples_per_candidate=args.samples_per_candidate,
        max_demos=args.max_demos,
        proposer_model=args.proposer_model,
    )
    config.validate()

    if not os.environ.get("ANTHROPIC_API_KEY") and not os.environ.get("OPENAI_API_KEY"):
        parser.error(
            "No API key in the environment. This command spends real calls; "
            "set ANTHROPIC_API_KEY or OPENAI_API_KEY. Never pass a key as an "
            "argument -- it lands in shell history and process listings."
        )

    dspy.configure(lm=dspy.LM(config.target_model))
    result = run(config, Path(args.out))
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
