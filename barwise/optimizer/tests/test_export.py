"""The exporter: the demo budget, the clobber refusal, and the report.

The budget assertions are the ones that earn their keep. DSPy's
bootstrap default is 4-16 demos, and the recorded payloads run 1,103 to
3,851 tokens each against a 4,540-token system prompt -- so accepting
the default would triple to octuple the prompt on every call, silently
and forever.
"""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml

from barwise_optimizer.export import (
    DEMO_TOKEN_BUDGET,
    ExportError,
    Provenance,
    budget_demos,
    demos_from_program,
    match_for_target,
    render_delta_report,
    write_candidate,
)


def demo(excerpt_chars: int, extraction_chars: int) -> dict:
    return {
        "transcriptExcerpt": "t" * excerpt_chars,
        "extraction": "e" * extraction_chars,
    }


def test_an_oversized_demo_set_is_truncated_rather_than_emitted():
    # The measured case: eight mean-sized payloads is ~16,000 tokens of
    # demos on a 4,540-token prompt.
    kept = budget_demos([demo(400, 8000) for _ in range(8)])

    spent = sum(len(d["transcriptExcerpt"]) + len(d["extraction"]) for d in kept) // 4
    assert spent <= DEMO_TOKEN_BUDGET
    assert len(kept) < 8


def test_a_truncated_demo_says_so():
    # A shortened demo is still useful; one that hides being partial is
    # a payload the reader will trust as complete.
    kept = budget_demos([demo(200, 20000)])
    assert kept
    assert kept[0]["extraction"].endswith("[truncated]")


def test_small_demos_survive_intact():
    demos = [demo(100, 800), demo(100, 800)]
    kept = budget_demos(demos)
    assert len(kept) == 2
    assert not kept[0]["extraction"].endswith("[truncated]")


def test_smallest_first_so_one_giant_payload_cannot_crowd_out_the_rest():
    kept = budget_demos([demo(100, 5000), demo(100, 400), demo(100, 400)])
    assert len(kept) >= 2


def test_a_demo_missing_half_its_pair_is_dropped():
    # renderDemos on the TypeScript side requires both fields; half a
    # demo would load and render as nonsense.
    assert budget_demos([{"transcriptExcerpt": "only this"}]) == []
    assert budget_demos([{"extraction": "{}"}]) == []


MATCH = {"provider": "anthropic", "modelPrefix": "claude-haiku-4-5"}


def test_candidate_refuses_to_overwrite_a_shipped_artifact(tmp_path: Path):
    # A compile run must not change production. Adoption is a human act.
    path = tmp_path / "extraction.shipped.prompt.yaml"
    path.write_text("surface: extraction\n", encoding="utf-8")

    with pytest.raises(ExportError, match="already exists"):
        write_candidate(
            path,
            version="dspy-1",
            instructions="x",
            match=MATCH,
            provenance=Provenance(optimizer="dspy/bootstrap"),
        )


def test_a_candidate_without_a_match_block_is_refused(tmp_path: Path):
    # resolveArtifact filters to artifacts declaring a match, so one
    # without it loads fine and is then silently skipped -- the operator
    # reads "Using the default prompt artifact." while believing they
    # gated the candidate they paid to compile. Found by round-tripping
    # an export through the production loader.
    with pytest.raises(ExportError, match="match block"):
        write_candidate(
            tmp_path / "c.prompt.yaml",
            version="v",
            instructions="x",
            match={},
            provenance=Provenance(optimizer="dspy/bootstrap"),
        )


def test_match_is_derived_from_the_dspy_target_model():
    assert match_for_target("anthropic/claude-haiku-4-5") == {
        "provider": "anthropic",
        "modelPrefix": "claude-haiku-4-5",
    }


def test_a_target_without_a_provider_is_refused():
    # DSPy names models provider/model. A bare name would produce a
    # match block with no provider, which is exactly the silent-skip
    # case above.
    with pytest.raises(ExportError, match="provider/model"):
        match_for_target("claude-haiku-4-5")


def test_candidate_carries_provenance_that_names_what_produced_it(tmp_path: Path):
    path = write_candidate(
        tmp_path / "candidate.prompt.yaml",
        version="dspy-bootstrap-1",
        instructions="Extract an ORM model.",
        demos=[demo(80, 400)],
        match={"provider": "anthropic", "modelPrefix": "claude-haiku"},
        provenance=Provenance(
            optimizer="dspy/bootstrap (3.3.1)",
            proposer_model="claude-sonnet-5",
            scored_against="claude-haiku-4-5",
            suite_version="1.3.0",
            score=0.871,
            on="2026-08-23",
        ),
    )

    doc = yaml.safe_load(path.read_text(encoding="utf-8"))
    assert doc["surface"] == "extraction"
    assert doc["version"] == "dspy-bootstrap-1"
    assert doc["match"] == {"provider": "anthropic", "modelPrefix": "claude-haiku"}
    assert doc["instructions"] == "Extract an ORM model."
    assert doc["provenance"]["suiteVersion"] == "1.3.0"
    assert doc["provenance"]["scoredAgainst"] == "claude-haiku-4-5"
    assert doc["provenance"]["score"] == pytest.approx(0.871)
    assert len(doc["demos"]) == 1


def test_a_candidate_with_no_demos_omits_the_key(tmp_path: Path):
    path = write_candidate(
        tmp_path / "c.prompt.yaml",
        version="v",
        instructions="x",
        match=MATCH,
        provenance=Provenance(optimizer="dspy/mipro"),
    )
    assert "demos" not in yaml.safe_load(path.read_text(encoding="utf-8"))


def test_report_says_plainly_when_a_margin_is_inside_the_noise_band():
    # The failure this exists for: reading a 0.03 win as a win. The
    # report leads with resolvability because the mean cannot answer it
    # and it is the step most likely to be skipped.
    body = render_delta_report(
        candidate_version="dspy-1",
        baseline={"mean": 0.800, "errorsByRule": {}, "warningsByRule": {}},
        candidate={"mean": 0.830, "errorsByRule": {}, "warningsByRule": {}},
        samples_per_candidate=5,
        resolvable=0.086,
        artifact_path=Path("out/x.prompt.yaml"),
    )

    assert "inside the noise band" in body
    assert "not evidence" in body


def test_report_calls_a_resolved_margin_resolved():
    body = render_delta_report(
        candidate_version="dspy-1",
        baseline={"mean": 0.700},
        candidate={"mean": 0.900},
        samples_per_candidate=5,
        resolvable=0.086,
        artifact_path=Path("out/x.prompt.yaml"),
    )
    assert "exceeds what this run can resolve" in body


def test_report_names_the_rules_that_moved():
    # What survives when the margin does not: counts, not means.
    body = render_delta_report(
        candidate_version="dspy-1",
        baseline={"mean": 0.6, "warningsByRule": {"completeness/fact-type-without-uniqueness": 18}},
        candidate={"mean": 0.63, "warningsByRule": {"completeness/fact-type-without-uniqueness": 4}},
        samples_per_candidate=5,
        resolvable=0.086,
        artifact_path=Path("out/x.prompt.yaml"),
    )

    assert "completeness/fact-type-without-uniqueness" in body
    assert "-14" in body


def test_report_tells_the_reader_its_own_number_is_not_the_accepted_one():
    body = render_delta_report(
        candidate_version="dspy-1",
        baseline={"mean": 0.7},
        candidate={"mean": 0.9},
        samples_per_candidate=5,
        resolvable=0.086,
        artifact_path=Path("out/x.prompt.yaml"),
    )
    assert "search signal, never the accepted number" in body
    assert "barwise prompt eval" in body


def test_demos_are_read_off_a_compiled_program():
    class Predictor:
        demos = [
            {"transcript": "t", "extraction": "{}"},
            {"transcript": "t2"},  # half a demo, skipped
        ]

    class Program:
        predict = Predictor()

    assert demos_from_program(Program()) == [
        {"transcriptExcerpt": "t", "extraction": "{}"}
    ]


def test_demos_from_an_uncompiled_program_are_empty():
    class Program:
        pass

    assert demos_from_program(Program()) == []
