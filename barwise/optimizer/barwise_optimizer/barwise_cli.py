"""The only crossing point between this lane and TypeScript.

Everything here shells out to the `barwise` CLI. There is no shared
library, no FFI, and no second copy of the schema or the scorer -- both
`prompt schema` and `prompt score` are ordinary commands that any
operator can run by hand, which is what makes them a seam rather than a
back door.

Keeping the crossing in one module is the point: if a future change
needs something else from the TypeScript side, it is added here and the
rest of the lane stays unaware that a subprocess exists.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
from dataclasses import dataclass, field
from pathlib import Path


class BarwiseCliError(RuntimeError):
    """The CLI could not answer. Carries stderr, which names the cause."""


def _repo_root() -> Path:
    """The monorepo directory (the one holding `packages/`)."""
    here = Path(__file__).resolve()
    for parent in here.parents:
        if (parent / "packages" / "cli").is_dir():
            return parent
    raise BarwiseCliError(
        "Could not locate the barwise monorepo from "
        f"{here}. Expected a parent directory containing packages/cli."
    )


def resolve_cli() -> list[str]:
    """The command that runs the CLI.

    `BARWISE_CLI` overrides it, which is how a test points at a stub and
    how an operator points at an installed binary. Otherwise the built
    entry point in the workspace is used -- built, not sources, because
    this lane never carries a TypeScript toolchain.
    """
    override = os.environ.get("BARWISE_CLI")
    if override:
        return override.split()

    built = _repo_root() / "packages" / "cli" / "dist" / "index.js"
    if built.is_file():
        node = shutil.which("node") or "node"
        return [node, str(built)]

    on_path = shutil.which("barwise")
    if on_path:
        return [on_path]

    raise BarwiseCliError(
        f"No barwise CLI found. Build it with `npm run build` (looked for "
        f"{built}), put `barwise` on PATH, or set BARWISE_CLI."
    )


#: Commander's wording when a subcommand or flag does not exist. The
#: only way a *correct* call reaches it is a CLI older than this lane.
_STALE_MARKERS = ("unknown command", "unknown option")


def _run(args: list[str]) -> str:
    cmd = resolve_cli() + args
    proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if proc.returncode != 0:
        stderr = proc.stderr.strip()
        if any(marker in stderr.lower() for marker in _STALE_MARKERS):
            # The seam runs `packages/cli/dist/index.js` -- built output,
            # not sources -- so pulling a branch that adds a command
            # leaves this lane calling a CLI that does not have it yet.
            # The raw commander error names the symptom and not the
            # cause, and it costs an attempted run to work out.
            raise BarwiseCliError(
                f"The barwise CLI does not recognise this call:\n  {stderr}\n\n"
                "This lane runs the CLI's BUILT output "
                "(packages/cli/dist/index.js), so a freshly pulled branch "
                "that adds a command still has the previous build on disk. "
                "Rebuild it:\n\n"
                "    cd barwise && npm run build\n\n"
                "If the command genuinely does not exist in this checkout, "
                "the lane is newer than the CLI it is pointed at -- check "
                "BARWISE_CLI."
            )
        raise BarwiseCliError(
            f"`{' '.join(cmd)}` exited {proc.returncode}.\n{stderr}"
        )
    return proc.stdout


def extraction_schema() -> dict:
    """The structured-output JSON Schema, from the CLI rather than a copy.

    Fetched every run on purpose. A literal pasted into this file would
    be correct on the day it was pasted and silently wrong afterwards,
    which is the failure the whole artifact seam exists to avoid.
    """
    return json.loads(_run(["prompt", "schema", "--surface", "extraction"]))


def default_instructions(provider: str | None = None, model: str | None = None) -> str:
    """The instructions the shipped artifact would actually send.

    Fetched, like the schema, because the default artifact is compiled
    into TypeScript rather than living in a `.prompt.yaml` -- there is no
    file for Python to read, and parsing the generated module would be
    a second copy of the worst kind.

    Resolution keys on the (provider, model) pair, so this returns the
    *variant* when one matches. That is deliberate: seeding a compile
    from "the shipped prompt" should mean the prompt that model actually
    gets, not the fallback.
    """
    args = ["prompt", "artifact", "--surface", "extraction"]
    if provider:
        args += ["--provider", provider]
    if model:
        args += ["--model", model]
    return _run(args).rstrip("\n")


@dataclass(frozen=True)
class CaseScore:
    """What `barwise prompt score` returns, as this lane reads it.

    `score` is what DSPy optimizes. The three tallies are what the delta
    report is written from, and they are the more useful half: a rule
    count moving from 18 to 4 is a far lower-variance observation than a
    0.03 shift in a mean, and it comes from the same calls.
    """

    case_id: str
    score: float
    rubric_passed: int
    rubric_total: int
    errors_by_rule: dict[str, int] = field(default_factory=dict)
    warnings_by_rule: dict[str, int] = field(default_factory=dict)
    corrections_by_category: dict[str, int] = field(default_factory=dict)
    # Object types plus fact types in the candidate model: the
    # denominator its penalty rates were computed over. The scorer
    # records it so that an arm inflating its denominator is visible --
    # forty elements, half defective, scores like four with two -- and
    # this side dropped it for a year (barwise-853).
    element_count: int = 0

    @property
    def floored(self) -> bool:
        """The score hit zero with a rubric that was not entirely failed.

        The distinction the mean cannot make. `scoreExtraction` floors at
        zero, so a run whose penalties exceed 1.0 reports 0.000 no matter
        how much worse than that it was -- and two such runs compare
        equal while being nothing of the sort. A rubric that passed
        something is the evidence that the zero is a floor rather than a
        genuine nothing.
        """
        return self.score == 0.0 and self.rubric_passed > 0

    @staticmethod
    def from_json(payload: dict) -> "CaseScore":
        return CaseScore(
            case_id=payload.get("caseId", ""),
            score=float(payload.get("score", 0.0)),
            rubric_passed=int(payload.get("rubricPassed", 0)),
            rubric_total=int(payload.get("rubricTotal", 0)),
            errors_by_rule=dict(payload.get("errorsByRule") or {}),
            warnings_by_rule=dict(payload.get("warningsByRule") or {}),
            corrections_by_category=dict(payload.get("correctionsByCategory") or {}),
            element_count=int(payload.get("elementCount", 0)),
        )


def score_extraction(case_id: str, extraction_json: str) -> CaseScore:
    """Score one candidate payload against one eval case.

    The payload goes through a temp file because that is the command's
    interface. Passing it on the command line would break on the first
    15 KB extraction and would put transcript-derived content into the
    process list.
    """
    with tempfile.NamedTemporaryFile(
        "w", suffix=".json", delete=False, encoding="utf-8"
    ) as handle:
        handle.write(extraction_json)
        path = handle.name
    try:
        out = _run(["prompt", "score", "--case", case_id, "--extraction", path])
    finally:
        os.unlink(path)
    return CaseScore.from_json(json.loads(out))
