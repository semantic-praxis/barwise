"""The eval suite, read as DSPy examples.

The split discipline is the whole reason this module exists rather than
a glob. `suite.yaml` declares `train` and `dev`, and the dev cases are
held out precisely so a tuned prompt can be caught overfitting. An
optimizer handed the whole suite would compile against the held-out set
and report a number that means nothing, and it would do so silently.

So `load_examples` takes a split by name and there is no way to ask for
"everything" while compiling: `compile_set()` is train, `report_set()`
is dev, and both say so.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import dspy
import yaml


class SuiteError(RuntimeError):
    """The suite could not be read as this lane needs it."""


def default_suite_path() -> Path:
    here = Path(__file__).resolve()
    for parent in here.parents:
        candidate = parent / "packages" / "promptlab" / "evals" / "suite.yaml"
        if candidate.is_file():
            return candidate
    raise SuiteError("Could not locate packages/promptlab/evals/suite.yaml.")


@dataclass(frozen=True)
class Suite:
    version: str
    path: Path
    splits: dict[str, list[str]]


def load_suite(suite_path: Path | None = None) -> Suite:
    path = Path(suite_path) if suite_path else default_suite_path()
    doc = yaml.safe_load(path.read_text(encoding="utf-8"))
    splits = doc.get("splits")
    if not splits:
        raise SuiteError(
            f"{path} declares no `splits`. This lane refuses to compile "
            "without one, because compiling against the held-out cases "
            "produces a number that cannot detect overfitting."
        )
    return Suite(
        version=str(doc.get("version", "unknown")),
        path=path,
        splits={name: list(ids) for name, ids in splits.items()},
    )


def load_examples(split: str, suite_path: Path | None = None) -> list[dspy.Example]:
    """The cases in one split, as DSPy examples.

    `case_id` rides along because the metric needs it: scoring is per
    case against that case's own rubric, so an example without its id
    cannot be scored at all.
    """
    suite = load_suite(suite_path)
    if split not in suite.splits:
        raise SuiteError(
            f"Unknown split {split!r}. The manifest declares: "
            f"{', '.join(sorted(suite.splits))}."
        )

    evals_dir = suite.path.parent
    examples: list[dspy.Example] = []
    for case_id in suite.splits[split]:
        case_file = evals_dir / f"{case_id}.eval.yaml"
        if not case_file.is_file():
            raise SuiteError(f"Split {split!r} names {case_id}, but {case_file} is missing.")
        case = yaml.safe_load(case_file.read_text(encoding="utf-8"))
        transcript_file = evals_dir / case["transcript"]
        transcript = transcript_file.read_text(encoding="utf-8")
        examples.append(
            dspy.Example(case_id=case_id, transcript=transcript).with_inputs("transcript")
        )
    return examples


def compile_set(suite_path: Path | None = None) -> list[dspy.Example]:
    """The train split. The only set an optimizer may see."""
    return load_examples("train", suite_path)


def report_set(suite_path: Path | None = None) -> list[dspy.Example]:
    """The dev split. Reported on, never compiled against."""
    return load_examples("dev", suite_path)
