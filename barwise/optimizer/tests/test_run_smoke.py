"""The whole compile path, run offline.

The version string carries the seed source (`dspy-bootstrap-minimal-1`)
because two runs of the same optimizer from different seeds are
different experiments, and a shared version would make the recorded
artifacts indistinguishable.

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

import json
import subprocess
from pathlib import Path

import dspy
import pytest
import yaml
from dspy.utils.dummies import DummyLM

from barwise_optimizer.barwise_cli import resolve_cli
from barwise_optimizer.compile import RunConfig, run
from barwise_optimizer.dataset import report_set

TARGET = "anthropic/claude-haiku-4-5"


def repo_root() -> Path:
    here = Path(__file__).resolve()
    for parent in here.parents:
        if (parent / "packages" / "cli").is_dir():
            return parent
    raise AssertionError("monorepo not found")


# Module-scoped, and the scope is the point: this fixture runs the WHOLE
# offline compile, which takes ~30s, and function scope ran it once per
# test -- five identical compilations for five reads of their output,
# 152s of a 210s suite. The tests only read what the run produced (files,
# and subprocesses over the artifacts directory), so one run serves all
# five. `tmp_path_factory` rather than `tmp_path` because the latter is
# function-scoped and cannot be requested from a module-scoped fixture.
@pytest.fixture(scope="module")
def compiled(tmp_path_factory: pytest.TempPathFactory) -> dict:
    tmp_path = tmp_path_factory.mktemp("smoke")
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
    assert (out / "extraction.dspy-bootstrap-minimal-1.prompt.yaml").is_file()
    assert (out / "delta-dspy-bootstrap-minimal-1.md").is_file()
    assert compiled["baseline"]["evaluations"] > 0
    assert compiled["candidate"]["evaluations"] > 0
    # The shipped comparator is scored too, and under `--seed-from
    # minimal` it is a THIRD sweep rather than the baseline relabelled:
    # without it the report's "baseline" reads as production and a
    # candidate that lost to production reads as a near-tie
    # (barwise-899).
    assert compiled["shipped"]["evaluations"] > 0
    assert (
        "margin over shipped"
        in (compiled["dir"] / "delta-dspy-bootstrap-minimal-1.md").read_text(
            encoding="utf-8"
        )
    )


def test_the_run_writes_its_own_report_json(compiled):
    """The report is a file the program writes, not a stdout capture.

    It used to exist only because `compile-runner.sh` redirected stdout
    into it. On a real 40-minute mipro run that file came out EMPTY, so
    the verdict for 118 paid calls was unreadable and the runner could
    only print that it could not read it. The redirection is correct in
    isolation and the failure was never reproduced offline -- which is
    the argument for this test rather than against it: nothing offline
    exercised the path at all, so the only place it could fail was in
    front of an operator who had already spent the money.
    """
    report = Path(compiled["dir"]) / "report.json"
    assert report.is_file(), "run() must write report.json into its out dir"
    doc = json.loads(report.read_text(encoding="utf-8"))
    # The verdict is the reason the file exists; a report without it
    # sends the reader back to grepping the delta report's prose.
    assert doc["verdict"]["gate"] in {"beats", "ties", "loses", "unmeasurable"}
    assert doc["artifact"] == compiled["artifact"]

    # The call-site assertion for barwise-908, and the reason the report
    # records the unit at all. `resolvable` is computed over CASE means
    # with n = cases; it used to be computed over every score with n =
    # `samples_per_candidate`. Both produce a plausible-looking float,
    # so the figure alone cannot distinguish them -- but the n can, and
    # here the two differ (this run uses samples_per_candidate=2).
    over = doc["resolvableOver"]
    assert over["unit"] == "cases"
    assert over["n"] != 2, "n must be the case count, not samples_per_candidate"
    assert over["n"] == len(report_set()), "n must be the size of the dev split"


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
            # `--artifact-version` is the explicit form: it pins the
            # candidate whatever else matches, and the delta report's
            # gating command and eval-runner.sh use it. Without it the
            # resolver now picks the candidate on its own (the test
            # below), because its prefix -- the full target model id --
            # is longer than the shipped family prefix (barwise-854).
            # Between the two shipping haiku45-2 (2026-07) and that
            # ranking, `--artifacts` alone was refused as ambiguous.
            "--artifact-version", "dspy-bootstrap-minimal-1",
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

    # The forced form, verbatim. The old assertion looked for
    # "...minimal-1." with a trailing period, which the CLI has not
    # emitted since it started echoing the client it resolved against
    # (barwise-850) -- so this test had a stale expected string on top
    # of the ambiguity, and would have kept failing after the flag was
    # added. Asserting the "forced by" wording also pins the distinction
    # the CLI draws on purpose: an operator pinned this, it did not
    # match the client, so it claims nothing about production.
    assert (
        "Using artifact version dspy-bootstrap-minimal-1 "
        "(forced by --artifact-version;" in proc.stderr
    )
    assert "Using the default prompt artifact" not in proc.stderr


def test_artifacts_alone_selects_the_candidate_by_its_narrower_prefix(compiled):
    # The other half of the pairing above. A candidate's match block is
    # derived from the target, so its modelPrefix is the full model id
    # (`claude-haiku-4-5`) while the shipped variant claims the family
    # (`claude-haiku`). Both match; the longer prefix is strictly more
    # specific and wins (barwise-854). What this pins is the failure
    # mode barwise-850 names: `--artifacts` must never quietly measure
    # the SHIPPED prompt while the operator believes they are gating the
    # candidate. It used to pin a refusal instead, which was the
    # resolver scoring only which fields were present -- the same
    # limitation the CLI test in promptArtifacts.test.ts documented and
    # did not endorse. A candidate whose prefix EQUALS the shipped one's
    # is still refused as ambiguous; that case is the llm package's
    # equal-specificity test.
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

    assert "Using artifact version dspy-bootstrap-minimal-1" in proc.stderr
    assert "Ambiguous prompt artifacts" not in proc.stderr
    # And it must never quietly measure the shipped variant instead.
    assert "Using artifact version haiku45-2" not in proc.stderr
