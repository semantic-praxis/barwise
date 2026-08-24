"""The whole compile path, run offline.

`run()` was the last thing here that had never executed: compile,
evaluate, export, report. Smoke-running it found two bugs that would
otherwise have surfaced only after a paid compilation --

  1. the exported instructions carried the 11.5 KB schema, so the
     candidate was 20 KB and duplicated in every request what production
     already sends as the tool's `input_schema`;
  2. the candidate had no `match` block, and `resolveArtifact` skips
     artifacts without one -- so the gating eval would have silently
     measured the default prompt while reporting on the candidate.

Both are now guarded by their own tests. This one keeps the path itself
exercised, because a path nothing runs is where the next pair hides.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

import dspy
import pytest
import yaml
from dspy.utils.dummies import DummyLM

from barwise_optimizer.barwise_cli import resolve_cli
from barwise_optimizer.compile import RunConfig, run

TARGET = "anthropic/claude-haiku-4-5"


def repo_root() -> Path:
    here = Path(__file__).resolve()
    for parent in here.parents:
        if (parent / "packages" / "cli").is_dir():
            return parent
    raise AssertionError("monorepo not found")


@pytest.fixture
def compiled(tmp_path: Path) -> dict:
    payload = (
        repo_root()
        / "packages/promptlab/tests/fixtures/responses/order-management.json"
    ).read_text(encoding="utf-8")
    # One canned answer, reused. Every case gets order-management's
    # payload, so the scores are meaningless -- the path is the subject,
    # not the numbers.
    dspy.configure(lm=DummyLM([{"extraction": payload}] * 400))

    config = RunConfig(
        target_model=TARGET,
        optimizer="bootstrap",
        max_calls=50,
        samples_per_candidate=2,
    )
    result = run(config, tmp_path)
    result["dir"] = tmp_path
    return result


def test_the_run_writes_a_candidate_and_a_report(compiled):
    out = compiled["dir"]
    assert (out / f"extraction.dspy-bootstrap-1.prompt.yaml").is_file()
    assert (out / "delta-dspy-bootstrap-1.md").is_file()
    assert compiled["baseline"]["evaluations"] > 0
    assert compiled["candidate"]["evaluations"] > 0


def test_the_candidate_is_small_because_the_schema_stays_out_of_it(compiled):
    doc = yaml.safe_load(
        Path(compiled["artifact"]).read_text(encoding="utf-8")
    )
    assert "object_types" not in doc["instructions"]
    assert len(doc["instructions"]) < 2000


def test_the_candidate_declares_the_match_it_needs_to_resolve(compiled):
    doc = yaml.safe_load(Path(compiled["artifact"]).read_text(encoding="utf-8"))
    assert doc["match"] == {
        "provider": "anthropic",
        "modelPrefix": "claude-haiku-4-5",
    }
    assert doc["provenance"]["scoredAgainst"] == TARGET


def test_the_candidate_resolves_through_the_production_loader(compiled):
    """The round trip that found the missing match block.

    Runs the real `prompt eval --artifacts` far enough to print which
    artifact it resolved, then lets it fail on the calls. Asserting the
    exporter's own YAML would only prove this package agrees with
    itself; the loader is the thing that has to accept it.
    """
    artifacts_dir = Path(compiled["artifact"]).parent
    proc = subprocess.run(
        resolve_cli()
        + [
            "prompt", "eval",
            "--artifacts", str(artifacts_dir),
            "--provider", "anthropic",
            "--model", "claude-haiku-4-5",
            "--split", "train",
            "--no-history",
        ],
        capture_output=True,
        text=True,
        check=False,
        env={"PATH": "/usr/bin:/bin:/usr/local/bin", "HOME": "/tmp"},
    )

    assert "Using artifact version dspy-bootstrap-1." in proc.stderr
    assert "Using the default prompt artifact." not in proc.stderr
