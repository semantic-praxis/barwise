"""Compiled program to a candidate `.prompt.yaml`, plus a delta report.

Two rules the exporter enforces, both learned rather than assumed.

**A candidate never overwrites a shipped artifact.** Adoption is a human
act: run `barwise prompt eval` on the candidate, read the delta, commit.
An exporter that wrote over the active file would make a compile run
change production silently.

**Demos are budgeted in tokens and truncated to fit.** Measured against
the recorded payloads: the extraction system prompt is about 4,540
tokens and a demo payload runs 1,103 to 3,851 (mean 1,984). DSPy's
`BootstrapFewShot` defaults to 4-16 demos, which is 8,000 to 32,000
tokens of demos on a 4,540-token prompt -- a 3x to 8x prompt paid on
every call, before the transcript. A library default that quietly
octuples the prompt is not one this repository can accept.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import date
from pathlib import Path

import yaml

#: Chars per token. Crude on purpose -- this is a budget guard, not an
#: accounting figure, and a tokenizer dependency for a safety margin
#: would be the trivial dependency the house rules forbid.
CHARS_PER_TOKEN = 4

#: Total token budget for all demos in one artifact. Roughly a third of
#: the system prompt: enough for one or two grounded examples, far short
#: of the multiple that the bootstrap default would produce.
DEMO_TOKEN_BUDGET = 1500

#: No single demo may take more than this share of the budget, so one
#: large payload cannot crowd out every other example.
MAX_DEMO_TOKENS = 900

#: Share of floored evaluations above which the means stop being
#: comparable at all. A quarter is a judgement, deliberately low: one
#: floored run in four already means the mean is averaging a clamp with
#: a measurement, and no threshold makes that meaningful.
SATURATION_SHARE = 0.25


class ExportError(RuntimeError):
    """The candidate could not be written."""


@dataclass(frozen=True)
class Provenance:
    optimizer: str
    proposer_model: str | None = None
    scored_against: str | None = None
    suite_version: str | None = None
    score: float | None = None
    on: str | None = None

    def to_yaml_block(self) -> dict:
        block: dict[str, object] = {"optimizer": self.optimizer}
        if self.proposer_model:
            block["proposerModel"] = self.proposer_model
        if self.scored_against:
            block["scoredAgainst"] = self.scored_against
        if self.suite_version:
            block["suiteVersion"] = self.suite_version
        if self.score is not None:
            block["score"] = round(float(self.score), 4)
        block["date"] = self.on or date.today().isoformat()
        return block


def _truncate(text: str, max_tokens: int) -> str:
    limit = max_tokens * CHARS_PER_TOKEN
    if len(text) <= limit:
        return text
    # A marker rather than a silent cut: a demo that was shortened is
    # still useful, but a reader must be able to tell it is partial.
    return text[: limit - 20].rstrip() + "\n... [truncated]"


def budget_demos(
    demos: list[dict], budget_tokens: int = DEMO_TOKEN_BUDGET
) -> list[dict]:
    """Fit demos into the token budget, truncating and then dropping.

    Smallest first: a budget spent on one enormous payload teaches the
    model less than the same budget spent on two compact ones.
    """
    prepared = []
    for demo in demos:
        excerpt = str(demo.get("transcriptExcerpt", ""))
        extraction = str(demo.get("extraction", ""))
        if not excerpt or not extraction:
            continue
        prepared.append(
            {
                "transcriptExcerpt": _truncate(excerpt, MAX_DEMO_TOKENS // 3),
                "extraction": _truncate(extraction, MAX_DEMO_TOKENS),
            }
        )

    prepared.sort(key=lambda d: len(d["transcriptExcerpt"]) + len(d["extraction"]))

    kept: list[dict] = []
    spent = 0
    for demo in prepared:
        cost = (len(demo["transcriptExcerpt"]) + len(demo["extraction"])) // CHARS_PER_TOKEN
        if spent + cost > budget_tokens:
            break
        kept.append(demo)
        spent += cost
    return kept


def demos_from_program(program) -> list[dict]:
    """Read bootstrapped demos off a compiled program.

    DSPy stores them on the predictor. Anything without both a
    transcript and an extraction is skipped rather than emitted half
    formed -- `renderDemos` on the TypeScript side requires both.
    """
    predictor = getattr(program, "predict", None)
    raw = list(getattr(predictor, "demos", []) or [])
    demos = []
    for item in raw:
        get = item.get if isinstance(item, dict) else lambda k, d=None: getattr(item, k, d)
        transcript = get("transcript", None)
        extraction = get("extraction", None)
        if isinstance(transcript, str) and isinstance(extraction, str):
            demos.append({"transcriptExcerpt": transcript, "extraction": extraction})
    return demos


def match_for_target(target_model: str) -> dict:
    """The `match` block for a model the candidate was compiled against.

    DSPy names models `provider/model`; `resolveArtifact` wants a
    provider and a model prefix. The prefix is the full model id rather
    than a family stem, because a candidate compiled against one model
    has been shown to help only that model -- widening it to a family is
    a claim the run did not make.
    """
    provider, _, model = target_model.partition("/")
    if not model:
        raise ExportError(
            f"Cannot derive a match block from target model {target_model!r}. "
            "Expected `provider/model`, e.g. anthropic/claude-haiku-4-5."
        )
    return {"provider": provider, "modelPrefix": model}


def write_candidate(
    path: Path,
    *,
    version: str,
    instructions: str,
    provenance: Provenance,
    match: dict,
    demos: list[dict] | None = None,
    force: bool = False,
) -> Path:
    """Write a candidate artifact. Refuses to clobber unless told to.

    `match` is required, and that is not a style choice.
    `resolveArtifact` filters to artifacts that declare one -- an
    artifact without a match block **can never resolve**. A candidate
    missing it would load without complaint and then be silently
    skipped, so the operator would read "Using the default prompt
    artifact." while believing they had just gated the candidate they
    paid to compile. Found by round-tripping an export through the
    production loader.
    """
    path = Path(path)
    if path.exists() and not force:
        raise ExportError(
            f"{path} already exists. A compile run must not replace a shipped "
            "artifact -- write a new candidate path, or pass force=True if you "
            "genuinely mean to overwrite this one."
        )
    if not match or not (match.get("provider") or match.get("modelPrefix")):
        raise ExportError(
            "A candidate needs a match block naming at least a provider or a "
            "modelPrefix. resolveArtifact skips artifacts without one, so a "
            "candidate lacking it would be silently ignored by the very eval "
            "run meant to gate it."
        )

    artifact: dict[str, object] = {
        "surface": "extraction",
        "version": version,
        "match": match,
    }
    artifact["instructions"] = instructions
    budgeted = budget_demos(demos or [])
    if budgeted:
        artifact["demos"] = budgeted
    artifact["provenance"] = provenance.to_yaml_block()

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        yaml.safe_dump(artifact, sort_keys=False, width=80, allow_unicode=True),
        encoding="utf-8",
    )
    return path


def _rule_delta(before: dict, after: dict) -> list[tuple[str, int, int]]:
    keys = sorted(set(before) | set(after))
    rows = [(k, int(before.get(k, 0)), int(after.get(k, 0))) for k in keys]
    return [r for r in rows if r[1] != r[2]]


def _scored(summary: dict) -> int:
    """Evaluations behind an arm's rule counts.

    Falls back to `evaluations` for summaries written before `scored`
    existed, so an old run still renders.
    """
    if "scored" in summary:
        return int(summary["scored"])
    return int(summary.get("evaluations", 0))


def render_delta_report(
    *,
    candidate_version: str,
    shipped: dict,
    baseline: dict,
    candidate: dict,
    samples_per_candidate: int,
    resolvable: float,
    artifact_path: Path,
) -> str:
    """The report a human reads before deciding whether to gate a candidate.

    It leads with whether the margin is resolvable, because that is the
    question the mean alone cannot answer and the one most likely to be
    skipped. The rule deltas follow, because they are what survives when
    the margin does not.

    Three arms, not two, and the third is the one the decision turns on
    (barwise-899). `baseline` is the SEED the optimizer started from --
    90 words under `--seed-from minimal` -- and a reader takes the word
    to mean "what we ship". So `shipped` is scored too, on the same dev
    cases through this same harness: a candidate can beat its seed
    handily and still lose to production, which is exactly what the
    2026-08-29 bootstrap run did while reading as a near-tie.
    """
    margin = float(candidate.get("mean", 0.0)) - float(baseline.get("mean", 0.0))
    shipped_margin = float(candidate.get("mean", 0.0)) - float(shipped.get("mean", 0.0))

    # Saturation beats resolvability, and has to be checked first.
    # `scoreExtraction` floors at zero, so runs whose penalties exceed
    # 1.0 all report 0.000 however much worse than that they were. Two
    # such arms compare equal while being nothing of the sort -- and the
    # flooring also collapses the SD, which shrinks `resolvable` toward
    # zero and makes a meaningless margin look decisive. The first real
    # compilation hit exactly this: means of 0.000 and 0.001 against a
    # manufactured threshold of 0.002.
    floored = int(baseline.get("floored", 0)) + int(candidate.get("floored", 0))
    total = int(baseline.get("evaluations", 0)) + int(candidate.get("evaluations", 0))
    saturated = total > 0 and floored / total >= SATURATION_SHARE
    resolved = (not saturated) and abs(margin) > resolvable

    lines: list[str] = []
    lines.append(f"# Candidate {candidate_version}")
    lines.append("")
    lines.append(f"Artifact: `{artifact_path}`")
    lines.append("")
    lines.append("## Did anything resolve?")
    lines.append("")
    lines.append(
        f"- shipped mean: {shipped.get('mean', 0.0):.3f} "
        "(what the target model is sent today)"
    )
    lines.append(
        f"- baseline mean: {baseline.get('mean', 0.0):.3f} "
        "(the seed this run started from)"
    )
    lines.append(f"- candidate mean: {candidate.get('mean', 0.0):.3f}")
    lines.append(f"- margin over baseline: {margin:+.3f}")
    lines.append(f"- margin over shipped: {shipped_margin:+.3f}")
    lines.append(f"- samples per candidate: {samples_per_candidate}")
    if floored:
        lines.append(f"- evaluations floored at zero: {floored} of {total}")
    lines.append(f"- resolvable difference at that sample count: {resolvable:.3f}")
    for label, arm in (("baseline", baseline), ("candidate", candidate)):
        evaluations = int(arm.get("evaluations", 0))
        scored = _scored(arm)
        if scored != evaluations:
            lines.append(
                f"- {label} runs behind the rule counts: {scored} of "
                f"{evaluations} ({evaluations - scored} produced nothing "
                "scorable)"
            )
    lines.append("")
    if saturated:
        lines.append(
            f"**{floored} of {total} evaluations scored zero with a rubric that "
            "passed something, so the score was floored rather than measured.** "
            "Penalties exceeded the maximum, and `scoreExtraction` clamps at "
            "zero -- so these arms compare equal while being nothing of the "
            "sort, and the flooring collapses the spread that "
            f"`resolvable` ({resolvable:.3f}) is derived from. **The margin "
            "above means nothing.** Read the rule deltas below, which are "
            "counts and remain legible, and fix what they name before "
            "comparing means again."
        )
    elif resolved:
        lines.append(
            f"**The margin ({abs(margin):.3f}) exceeds what this run can "
            f"resolve ({resolvable:.3f}).** It is a real difference at 95%."
        )
    else:
        lines.append(
            f"**The margin ({abs(margin):.3f}) is inside the noise band "
            f"({resolvable:.3f}), so this run did not show a difference.** "
            "Whichever way it points, it is not evidence. Either raise the "
            "sample count or read the rule deltas below, which are counts "
            "rather than means and do not need a margin to be legible."
        )
    lines.append("")

    # The gate, stated separately from the margin over the seed: beating
    # the seed is how the optimizer shows it did something, but only
    # beating what production sends is a reason to ship anything.
    if not saturated:
        if shipped_margin > resolvable:
            lines.append(
                f"**It also beats what we ship ({shipped_margin:+.3f}, outside "
                f"the {resolvable:.3f} noise band).** That is the margin worth "
                "confirming with a keyed `barwise prompt eval` arm against a "
                "same-suite-version control."
            )
        elif abs(shipped_margin) <= resolvable:
            lines.append(
                f"**Against what we ship it is a tie ({shipped_margin:+.3f}, "
                f"inside the {resolvable:.3f} band).** Improving on the seed is "
                "not the bar; there is nothing here to gate."
            )
        else:
            lines.append(
                f"**It loses to what we ship by {abs(shipped_margin):.3f}, "
                f"outside the {resolvable:.3f} band.** Whatever it did to the "
                "seed, this candidate is worse than what the target model is "
                "sent today -- do not spend a keyed arm confirming it."
            )
        lines.append("")

    lines.append(
        "_All three arms are scored through the DSPy harness, so they are "
        "comparable to each other and NOT to a recorded `barwise prompt eval` "
        "history row, which renders the prompt production's way._"
    )
    lines.append("")
    lines.append("## What moved, by name")
    lines.append("")
    base_n, cand_n = _scored(baseline), _scored(candidate)
    uneven = base_n != cand_n and base_n > 0 and cand_n > 0
    if uneven:
        # Raw counts across different denominators are not a comparison.
        # A candidate whose runs fail more often produces fewer tallies
        # and can look *better* on every rule while being worse per run.
        lines.append(
            f"**The two arms scored a different number of runs ({base_n} and "
            f"{cand_n}), so the raw counts are not comparable.** Per-run rates "
            "are given alongside; read those."
        )
        lines.append("")
    for label, key in (
        ("Validation errors", "errorsByRule"),
        ("Validation warnings", "warningsByRule"),
        ("Conformance corrections", "correctionsByCategory"),
    ):
        rows = _rule_delta(baseline.get(key) or {}, candidate.get(key) or {})
        lines.append(f"### {label}")
        lines.append("")
        if not rows:
            lines.append("No change.")
        elif uneven:
            lines.append(
                "| rule | baseline | /run | candidate | /run | delta /run |"
            )
            lines.append("| --- | ---: | ---: | ---: | ---: | ---: |")
            for name, was, now in rows:
                was_rate, now_rate = was / base_n, now / cand_n
                lines.append(
                    f"| `{name}` | {was} | {was_rate:.2f} | {now} | "
                    f"{now_rate:.2f} | {now_rate - was_rate:+.2f} |"
                )
        else:
            lines.append("| rule | baseline | candidate | delta |")
            lines.append("| --- | ---: | ---: | ---: |")
            for name, was, now in rows:
                lines.append(f"| `{name}` | {was} | {now} | {now - was:+d} |")
        lines.append("")

    lines.append("## Before adopting")
    lines.append("")
    lines.append(
        "This report is the optimizer's own view, assembled by DSPy's "
        "adapter rather than the production renderer. It is a search "
        "signal, never the accepted number. Gate the candidate through "
        "the real path before committing it:"
    )
    lines.append("")
    lines.append("```sh")
    # The candidate's own directory, and its version forced. Pointing
    # `--artifacts` at `packages/llm/prompts` -- which this block did --
    # widens the set with the directory the SHIPPED builtins are
    # generated from, so the run resolves a shipped variant on
    # provider/model match and measures it while the reader believes
    # they are gating the candidate. That is barwise-850 reproduced in
    # an instruction. `--artifact-version` is what makes the choice
    # explicit rather than a race between matching artifacts.
    lines.append(
        f"barwise prompt eval --artifacts {artifact_path.parent} "
        f"--artifact-version {candidate_version} \\"
    )
    lines.append(
        "  --provider anthropic --model <target> --split dev --repeat 5"
    )
    lines.append("```")
    lines.append("")
    lines.append(
        "Confirm the resolution first, for free: the same flags on "
        "`barwise prompt artifact` print the version and hash that would "
        "be sent."
    )
    lines.append("")
    return "\n".join(lines)


def write_delta_report(path: Path, body: str) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body, encoding="utf-8")
    return path


def summary_json(log_summary: dict) -> str:
    return json.dumps(log_summary, indent=2, sort_keys=True)
