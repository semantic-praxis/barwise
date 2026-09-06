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
        shipped={"mean": 0.800},
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
        shipped={"mean": 0.700},
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
        shipped={"mean": 0.6},
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
        shipped={"mean": 0.7},
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


def test_a_saturated_comparison_refuses_to_call_the_margin_anything():
    # The first real compilation: means of 0.000 and 0.001 against a
    # resolvable of 0.002 that the flooring itself manufactured. Both
    # arms had exceeded the maximum penalty, so they compared equal
    # while being nothing of the sort.
    body = render_delta_report(
        candidate_version="dspy-1",
        shipped={"mean": 0.0},
        baseline={"mean": 0.0, "evaluations": 15, "floored": 10},
        candidate={"mean": 0.001, "evaluations": 15, "floored": 12},
        samples_per_candidate=5,
        resolvable=0.002,
        artifact_path=Path("out/x.prompt.yaml"),
    )

    assert "floored rather than measured" in body
    assert "means nothing" in body
    # And it must not also claim the margin resolved.
    assert "exceeds what this run can resolve" not in body


def test_saturation_outranks_a_margin_that_would_otherwise_resolve():
    # The dangerous case: flooring collapses the SD, so a wide-looking
    # margin can clear a threshold that no longer means anything.
    body = render_delta_report(
        candidate_version="dspy-1",
        shipped={"mean": 0.0},
        baseline={"mean": 0.0, "evaluations": 15, "floored": 15},
        candidate={"mean": 0.4, "evaluations": 15, "floored": 8},
        samples_per_candidate=5,
        resolvable=0.001,
        artifact_path=Path("out/x.prompt.yaml"),
    )

    assert "floored rather than measured" in body
    assert "exceeds what this run can resolve" not in body


def test_an_unsaturated_run_still_reports_normally():
    body = render_delta_report(
        candidate_version="dspy-1",
        shipped={"mean": 0.70},
        baseline={"mean": 0.70, "evaluations": 15, "floored": 0},
        candidate={"mean": 0.90, "evaluations": 15, "floored": 1},
        samples_per_candidate=5,
        resolvable=0.086,
        artifact_path=Path("out/x.prompt.yaml"),
    )

    assert "floored rather than measured" not in body
    assert "exceeds what this run can resolve" in body


def test_uneven_scored_counts_are_reported_as_rates_not_raw_counts():
    """The flaw the mipro run exposed in this very report.

    A run that fails to score contributes no rule tallies but still
    counts as an evaluation. So an arm with more failures produces
    fewer occurrences of everything and looks *better* on every rule
    while being worse per run. The first mipro report did exactly that:
    `binary-missing-inverse-reading` read 160 -> 145, an apparent
    improvement, when it was 10.67 -> 14.50 per scored run.
    """
    body = render_delta_report(
        candidate_version="dspy-1",
        shipped={"mean": 0.0},
        baseline={
            "mean": 0.0, "evaluations": 15, "scored": 15,
            "warningsByRule": {"structural/binary-missing-inverse-reading": 160},
        },
        candidate={
            "mean": 0.0, "evaluations": 15, "scored": 10,
            "warningsByRule": {"structural/binary-missing-inverse-reading": 145},
        },
        samples_per_candidate=5,
        resolvable=0.09,
        artifact_path=Path("out/x.prompt.yaml"),
    )

    assert "raw counts are not comparable" in body
    assert "5 produced nothing scorable" in body
    # The rates, and a delta that points the right way.
    assert "10.67" in body and "14.50" in body
    assert "+3.83" in body


def test_even_scored_counts_keep_the_plain_table():
    body = render_delta_report(
        candidate_version="dspy-1",
        shipped={"mean": 0.7},
        baseline={
            "mean": 0.7, "evaluations": 15, "scored": 15,
            "warningsByRule": {"completeness/fact-type-without-uniqueness": 18},
        },
        candidate={
            "mean": 0.9, "evaluations": 15, "scored": 15,
            "warningsByRule": {"completeness/fact-type-without-uniqueness": 4},
        },
        samples_per_candidate=5,
        resolvable=0.086,
        artifact_path=Path("out/x.prompt.yaml"),
    )

    assert "raw counts are not comparable" not in body
    assert "-14" in body


def test_a_summary_without_scored_still_renders():
    # Reports written before `scored` existed must not crash a re-read.
    body = render_delta_report(
        candidate_version="dspy-1",
        shipped={"mean": 0.7},
        baseline={"mean": 0.7, "evaluations": 15, "warningsByRule": {"a": 3}},
        candidate={"mean": 0.9, "evaluations": 15, "warningsByRule": {"a": 1}},
        samples_per_candidate=5,
        resolvable=0.086,
        artifact_path=Path("out/x.prompt.yaml"),
    )
    assert "raw counts are not comparable" not in body


def test_report_says_a_candidate_that_beats_its_seed_still_lost_to_production():
    # The 2026-08-29 bootstrap run, in miniature: the candidate improves
    # on the 90-word seed it started from and is far worse than what the
    # target model is sent today. Reporting only the seed margin made
    # that read as a near-tie, which is the whole of barwise-899.
    body = render_delta_report(
        candidate_version="dspy-1",
        shipped={"mean": 0.814},
        baseline={"mean": 0.380},
        candidate={"mean": 0.500},
        samples_per_candidate=5,
        resolvable=0.086,
        artifact_path=Path("out/x.prompt.yaml"),
    )

    assert "shipped mean: 0.814" in body
    assert "margin over shipped: -0.314" in body
    assert "loses to what we ship" in body
    # And it must not invite a keyed arm to confirm a loss.
    assert "do not spend a keyed arm" in body


def test_report_calls_a_win_over_the_seed_that_ties_production_a_tie():
    body = render_delta_report(
        candidate_version="dspy-1",
        shipped={"mean": 0.800},
        baseline={"mean": 0.500},
        candidate={"mean": 0.810},
        samples_per_candidate=5,
        resolvable=0.086,
        artifact_path=Path("out/x.prompt.yaml"),
    )

    assert "Against what we ship it is a tie" in body
    assert "Improving on the seed is not the bar" in body


def test_report_promotes_a_candidate_that_clears_production():
    body = render_delta_report(
        candidate_version="dspy-1",
        shipped={"mean": 0.700},
        baseline={"mean": 0.400},
        candidate={"mean": 0.900},
        samples_per_candidate=5,
        resolvable=0.086,
        artifact_path=Path("out/x.prompt.yaml"),
    )

    assert "It also beats what we ship (+0.200" in body
    assert "keyed `barwise prompt eval` arm" in body


def test_report_warns_its_arms_are_not_comparable_to_a_history_row():
    # Same harness for all three is what makes them comparable to each
    # other, and is exactly why none is comparable to a recorded row.
    body = render_delta_report(
        candidate_version="dspy-1",
        shipped={"mean": 0.8},
        baseline={"mean": 0.4},
        candidate={"mean": 0.5},
        samples_per_candidate=5,
        resolvable=0.086,
        artifact_path=Path("out/x.prompt.yaml"),
    )
    assert "NOT to a recorded `barwise prompt eval` history row" in body


def test_the_gating_command_names_the_candidate_not_the_shipped_prompts():
    # The instruction used to read `--artifacts packages/llm/prompts`,
    # which widens the set with the directory the SHIPPED builtins come
    # from: the gating run then resolves a shipped variant on
    # provider/model match and measures it while the reader believes
    # they are testing the candidate. barwise-850, reproduced in a doc.
    body = render_delta_report(
        candidate_version="dspy-mipro-minimal-1",
        shipped={"mean": 0.7},
        baseline={"mean": 0.4},
        candidate={"mean": 0.9},
        samples_per_candidate=5,
        resolvable=0.086,
        artifact_path=Path("out/extraction.dspy-mipro-minimal-1.prompt.yaml"),
    )

    assert "--artifacts out --artifact-version dspy-mipro-minimal-1" in body
    assert "--artifacts packages/llm/prompts" not in body


def test_report_shows_the_denominator_each_arm_scored_against():
    # barwise-853: a model inventing forty elements, half defective,
    # scored like one inventing four with two defects, and the report
    # had no column that could show it.
    body = render_delta_report(
        candidate_version="dspy-1",
        shipped={"mean": 0.7},
        baseline={"mean": 0.7, "meanElementCount": 12.0},
        candidate={"mean": 0.9, "meanElementCount": 13.0},
        samples_per_candidate=5,
        resolvable=0.086,
        artifact_path=Path("out/x.prompt.yaml"),
    )
    assert "mean element count" in body
    assert "12.0" in body and "13.0" in body
    assert "denominator" not in body


def test_report_flags_a_denominator_that_rose_with_the_score():
    body = render_delta_report(
        candidate_version="dspy-1",
        shipped={"mean": 0.7},
        baseline={"mean": 0.7, "meanElementCount": 12.0},
        candidate={"mean": 0.9, "meanElementCount": 30.0},
        samples_per_candidate=5,
        resolvable=0.086,
        artifact_path=Path("out/x.prompt.yaml"),
    )
    assert "denominator" in body
    assert "+150%" in body


def test_report_survives_summaries_written_before_element_counts():
    body = render_delta_report(
        candidate_version="dspy-1",
        shipped={"mean": 0.7},
        baseline={"mean": 0.7},
        candidate={"mean": 0.9},
        samples_per_candidate=5,
        resolvable=0.086,
        artifact_path=Path("out/x.prompt.yaml"),
    )
    assert "mean element count" not in body
