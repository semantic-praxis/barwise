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
import sys
from dataclasses import dataclass
from pathlib import Path

import dspy

from .budget import BudgetExceeded, CallBudget
from .dataset import compile_set, load_suite, report_set
from .export import (
    SATURATION_SHARE,
    Provenance,
    demos_from_program,
    match_for_target,
    render_delta_report,
    write_candidate,
    write_delta_report,
)
from .barwise_cli import default_instructions
from .metric import MetricLog, make_metric
from .verdict import decide
from .program import SEED_INSTRUCTIONS, ExtractionProgram

OPTIMIZERS = ("bootstrap", "mipro", "gepa")
SEED_SOURCES = ("minimal", "default")


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
    seed_from: str = "minimal"

    def validate(self) -> None:
        if self.seed_from not in SEED_SOURCES:
            raise BudgetError(
                f"Unknown --seed-from {self.seed_from!r}. Choose one of: "
                f"{', '.join(SEED_SOURCES)}."
            )
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
        # MIPROv2 imports optuna at the optimization step, which is after
        # its bootstrap and instruction-proposal calls have been spent.
        # Checking here turns a dozen wasted paid calls into a message.
        try:
            import optuna  # noqa: F401
        except ImportError as missing:
            raise BudgetError(
                "mipro needs optuna, which DSPy imports only at the "
                "optimization step -- so without it a run dies after paying "
                "for bootstrapping and instruction proposal. Install it with "
                "`uv sync --frozen` (it is a base dependency in pyproject.toml)."
            ) from missing
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


def compile_kwargs(config: RunConfig) -> dict:
    """Per-optimizer arguments to `compile`, for this suite's size.

    MIPROv2 only. Two of its defaults do not survive a seven-case train
    split:

    `requires_permission_to_run` prompts on stdin for confirmation of
    the estimated cost. `--max-calls` is already a hard ceiling and is
    mandatory, so the prompt is a weaker duplicate of a gate we enforce
    ourselves -- and a run left waiting on stdin is a run that hangs in
    anything non-interactive.

    `minibatch` samples 35 examples per trial from a set that has seven,
    which is not a minibatch. Turning it off evaluates the full split,
    which is what happens anyway, and avoids the library's small-set
    edge cases (its own MIN_MINIBATCH_SIZE is 50).
    """
    if config.optimizer != "mipro":
        return {}
    return {"requires_permission_to_run": False, "minibatch": False}


def seed_instructions(config: RunConfig) -> str:
    """The instruction text a compile starts from.

    `minimal` is a 137-token summary. It is the right start for the
    instruction-rewriting optimizers, which propose replacements --
    seeding those with the shipped 4,540-token prompt biases the search
    toward paraphrases of what already exists.

    `default` is what the target model would actually be sent today,
    fetched through the CLI. It is the right start for `bootstrap`,
    which never rewrites instructions and only selects demos: from the
    minimal seed, bootstrap selects demos generated *by* the minimal
    seed, so it amplifies that prompt's defects rather than improving on
    anything. The first real compilation showed this -- `misplaced_is_preferred`
    went 10 to 70 -- and it also floored the score, because a 137-token
    prompt earns more penalty than the rubric can offset.
    """
    if config.seed_from == "default":
        return shipped_instructions(config)
    return SEED_INSTRUCTIONS


def shipped_instructions(config: RunConfig) -> str:
    """What the target model would actually be sent today.

    One reader of the CLI seam, so the seed path and the shipped
    comparator cannot disagree about which artifact "shipped" means.
    """
    provider, _, model = config.target_model.partition("/")
    return default_instructions(provider=provider or None, model=model or None)


def run(config: RunConfig, out_dir: Path) -> dict:
    """Compile, evaluate on the held-out split, and write the artifacts.

    The budget is registered as a DSPy callback rather than threaded
    through the program, because the optimizer deep-copies the student
    during compilation and a counter living on the program would stop
    being shared exactly when it started mattering.
    """
    config.validate()
    suite = load_suite()

    budget = CallBudget(config.max_calls)
    previous_callbacks = list(dspy.settings.callbacks or [])
    dspy.settings.configure(callbacks=[*previous_callbacks, budget])
    try:
        return _run_under_budget(config, out_dir, suite, budget)
    finally:
        # Restored, not left appended. `dspy.settings` is global, so a
        # second run in the same process would otherwise still be
        # counting against the first run's ceiling -- and would trip it
        # partway through for reasons nothing in that run explains.
        dspy.settings.configure(callbacks=previous_callbacks)


class ProgressReporter:
    """One stderr line per evaluation, naming the phase and the burn.

    A compile is otherwise silent between tqdm ticks ~80s apart at
    sonnet latency, so a healthy run, a rate-limited one and a hung one
    are indistinguishable from outside -- and the operator cannot tell
    whether scores are flat and the run is worth aborting
    (barwise-897). The eval runner learned this already: `--verbose`
    exists there for the same reason.

    stderr, not stdout, because `compile` prints its result as JSON and
    a progress line in that stream would break every reader of it.
    """

    def __init__(self, budget: CallBudget):
        self._budget = budget
        self.phase = "baseline"

    def __call__(self, case_id: str, score: float, outcome: str | None) -> None:
        detail = f"score={score:.3f}" if outcome is None else f"{outcome} (0.000)"
        print(
            f"[{self.phase}] {case_id:<22} {detail}  "
            f"calls={self._budget.spent}/{self._budget.max_calls}",
            file=sys.stderr,
            flush=True,
        )


def _run_under_budget(config: RunConfig, out_dir: Path, suite, budget: CallBudget) -> dict:
    baseline_log = MetricLog()
    candidate_log = MetricLog()
    progress = ProgressReporter(budget)

    train = compile_set()
    dev = report_set()

    seed = seed_instructions(config)

    baseline = ExtractionProgram(seed)
    evaluate(baseline, dev, make_metric(baseline_log, progress), config.samples_per_candidate)

    # The shipped comparator, and the reason it is not optional
    # (barwise-899). "baseline" here is the SEED program, which for
    # `--seed-from minimal` is 90 words; a reader takes the word to mean
    # "what we ship". The 2026-08-29 bootstrap run reported baseline
    # 0.380 / candidate 0.355 and read as a near-tie, while the shipped
    # prompt scored 0.814 on these same dev cases -- a candidate that
    # lost to production by 0.45 looked like noise. So the run scores
    # what production sends, on the same cases, through the same harness.
    #
    # Same harness is the point AND the caveat: DSPy renders these
    # instructions its own way, so none of the three blocks is
    # byte-identical to a `barwise prompt eval` row. They are comparable
    # to each other, which is the comparison the decision needs; they are
    # not comparable to a recorded history row.
    #
    # Skipped only when the seed already IS the shipped prompt, where
    # `baseline` answers the question and a second sweep buys nothing.
    shipped_log: MetricLog | None = None
    if config.seed_from != "default":
        shipped_log = MetricLog()
        progress.phase = "shipped"
        evaluate(
            ExtractionProgram(shipped_instructions(config)),
            dev,
            make_metric(shipped_log, progress),
            config.samples_per_candidate,
        )

    progress.phase = "compile"
    optimizer = build_optimizer(config, make_metric(progress=progress))
    compiled = optimizer.compile(ExtractionProgram(seed), trainset=train, **compile_kwargs(config))

    progress.phase = "candidate"
    evaluate(compiled, dev, make_metric(candidate_log, progress), config.samples_per_candidate)

    # Over CASE MEANS, with n = cases -- not over every score with n =
    # repeats. Repeats of one case are not independent observations:
    # under DSPy's default `cache=True` they are the same response read
    # again, which the 2026-08-29 mipro run showed as byte-identical
    # scores across all five. The old pairing divided a between-case
    # spread by the repeat count and understated the threshold by 35%
    # (barwise-908). Computing over case means is also the right answer
    # when the cache is off, since it makes no independence assumption
    # about repeats at all.
    resolvable, resolvable_n = candidate_log.resolvable()

    version = f"dspy-{config.optimizer}-{config.seed_from}-1"
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

    # When the seed is the shipped prompt, `baseline` already is the
    # shipped comparator; say so rather than reporting the same sweep
    # twice or leaving the block out and inviting the 899 misreading.
    shipped_summary = (
        shipped_log.summary() if shipped_log is not None else baseline_log.summary()
    )

    report = render_delta_report(
        candidate_version=version,
        shipped=shipped_summary,
        baseline=baseline_log.summary(),
        candidate=candidate_log.summary(),
        samples_per_candidate=config.samples_per_candidate,
        resolvable=resolvable,
        artifact_path=artifact_path,
    )
    write_delta_report(out_dir / f"delta-{version}.md", report)

    # The verdict travels as DATA, not only as prose in the delta report.
    # It was already decided deterministically; emitting it only as
    # English meant anything downstream had to grep a paragraph, which
    # `compile-runner.sh` did until this landed.
    candidate_summary = candidate_log.summary()
    baseline_summary = baseline_log.summary()
    floored = candidate_summary.get("floored", 0)
    scored = candidate_summary.get("scored", 0)
    gate = decide(
        shipped_mean=shipped_summary.get("mean") if shipped_summary else None,
        baseline_mean=baseline_summary.get("mean"),
        candidate_mean=candidate_summary.get("mean"),
        resolvable=resolvable,
        saturated=scored > 0 and floored / scored >= SATURATION_SHARE,
    )

    result = {
        "artifact": str(artifact_path),
        "shipped": shipped_summary,
        "baseline": baseline_summary,
        "candidate": candidate_summary,
        "resolvable": resolvable,
        # The UNIT the figure was computed over, recorded rather than
        # assumed. The barwise-908 defect was invisible in the report:
        # 0.191 looks like a threshold whether it came from cases or
        # repeats. With `n` beside it, a reader (and a test) can see
        # that it is the case count and not `samples_per_candidate`.
        "resolvableOver": {"unit": "cases", "n": resolvable_n},
        "budget": budget.summary(),
        "verdict": gate.as_dict(),
    }

    # Written HERE, beside the artifact and the delta report, rather than
    # left to whoever captures stdout. It was stdout-only, and
    # `compile-runner.sh` reconstructed report.json with a shell
    # redirection -- which on a real 40-minute mipro run produced an
    # EMPTY file, so the run's verdict was unreadable after the calls
    # were already paid for. The root cause of the empty capture was
    # never reproduced offline, which is exactly the argument for not
    # depending on it: the report is this program's output, so this
    # program writes it, and stdout stays a convenience for pipelines.
    (out_dir / "report.json").write_text(
        json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    return result


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
        help=(
            "Hard ceiling on LLM calls, enforced for every optimizer. The run "
            "stops mid-compile rather than overspending. Required: there is no "
            "safe default."
        ),
    )
    parser.add_argument(
        "--samples-per-candidate",
        type=int,
        required=True,
        help="Evaluations per case. Below 2 the run cannot report a spread.",
    )
    parser.add_argument("--max-demos", type=int, default=2)
    parser.add_argument(
        "--seed-from",
        default="minimal",
        choices=SEED_SOURCES,
        help=(
            "Instruction text to start from. 'minimal' is a short summary, "
            "right for mipro/gepa which propose replacements. 'default' is "
            "the shipped prompt for the target model, right for bootstrap, "
            "which only selects demos and otherwise amplifies whatever the "
            "seed does wrong."
        ),
    )
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
        seed_from=args.seed_from,
    )
    config.validate()

    if not os.environ.get("ANTHROPIC_API_KEY") and not os.environ.get("OPENAI_API_KEY"):
        parser.error(
            "No API key in the environment. This command spends real calls; "
            "set ANTHROPIC_API_KEY or OPENAI_API_KEY. Never pass a key as an "
            "argument -- it lands in shell history and process listings."
        )

    dspy.configure(lm=dspy.LM(config.target_model))
    try:
        result = run(config, Path(args.out))
    except BudgetExceeded as exhausted:
        # Deliberately not a traceback: the operator set this ceiling
        # and hitting it is an answer, not a crash.
        print(f"Stopped: {exhausted}")
        return 2
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
