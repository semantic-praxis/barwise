"""The program, driven end to end with no API key and no network.

`DummyLM` answers in the chat adapter's own field format, so the whole
path -- signature rendering, the call, parsing, the metric -- runs
offline. That is what makes this lane maintainable: a contributor can
change it and know whether it works, which is the thing `barwise-841`
was written about on the TypeScript side.
"""

from __future__ import annotations

import json
from pathlib import Path

import dspy
import pytest
from dspy.utils.dummies import DummyLM

from barwise_optimizer.metric import MetricLog, make_metric
from barwise_optimizer.program import SEED_INSTRUCTIONS, ExtractionProgram


def repo_root() -> Path:
    here = Path(__file__).resolve()
    for parent in here.parents:
        if (parent / "packages" / "cli").is_dir():
            return parent
    raise AssertionError("monorepo not found")


FIXTURES = repo_root() / "packages" / "promptlab" / "tests" / "fixtures" / "responses"


class Example:
    def __init__(self, case_id):
        self.case_id = case_id


def test_program_runs_offline_and_its_answer_scores():
    payload = (FIXTURES / "order-management.json").read_text(encoding="utf-8")
    dspy.configure(lm=DummyLM([{"extraction": payload}]))

    program = ExtractionProgram()
    prediction = program(transcript="Facilitator: how do orders work?")

    log = MetricLog()
    score = make_metric(log)(Example("order-management"), prediction)

    assert score == pytest.approx(1.0)
    assert log.mean == pytest.approx(1.0)


def test_the_live_schema_reaches_the_rendered_prompt():
    # Fetched from the CLI, not embedded. If someone pastes a literal
    # in, this still passes -- so the assertion is paired with
    # test_metric's check that the CLI is what answers.
    dspy.configure(lm=DummyLM([{"extraction": "{}"}]))
    program = ExtractionProgram()
    program(transcript="hi")

    system = dspy.settings.lm.history[-1]["messages"][0]["content"]
    assert "object_types" in system
    assert "fact_types" in system
    assert "Object-Role Modeling" in system


def test_the_schema_stays_out_of_the_optimizable_instructions():
    # Where the schema lives is load-bearing. Production sends it as the
    # tool's input_schema and the prompt as system, so instructions
    # carrying 11.5 KB of schema would duplicate it in every request and
    # would not be comparable to the shipped artifacts. It is also the
    # text MIPROv2 and GEPA rewrite -- handing them a schema to
    # paraphrase spends the search on the one part that must stay exact.
    #
    # Found by smoke-running the full compile path offline: the first
    # exported candidate was 20 KB.
    program = ExtractionProgram()
    assert "object_types" not in program.instructions
    assert len(program.instructions) < 2000


def test_instructions_are_read_off_the_live_predictor():
    # The failure this prevents: an optimizer replaces the signature on
    # the predictor, and reading the constructor argument back would
    # export the prompt we started with while reporting the score of the
    # one we found.
    program = ExtractionProgram()
    assert SEED_INSTRUCTIONS.split("\n")[0] in program.instructions

    program.predict.signature = program.predict.signature.with_instructions(
        "REPLACED BY THE OPTIMIZER"
    )
    assert program.instructions == "REPLACED BY THE OPTIMIZER"


def test_the_program_has_no_reasoning_field():
    # Production asks for one structured payload and reads it. A
    # ChainOfThought program would optimize a shape the runtime cannot
    # reproduce, making the exported instructions unrepresentative of
    # what was measured.
    program = ExtractionProgram()
    assert set(program.predict.signature.output_fields) == {"extraction"}


def test_a_refusal_scores_zero_rather_than_crashing_the_run():
    dspy.configure(lm=DummyLM([{"extraction": "I cannot help with that."}]))
    program = ExtractionProgram()
    prediction = program(transcript="anything")

    log = MetricLog()
    assert make_metric(log)(Example("order-management"), prediction) == 0.0
    assert log.unparseable == 1


def test_a_structurally_valid_but_empty_model_scores_low_without_failing():
    # The distinction the runner draws and this must not blur: the model
    # answered, the answer was poor. That is a measurement, not a
    # failure.
    empty = json.dumps(
        {
            "object_types": [],
            "fact_types": [],
            "subtypes": [],
            "inferred_constraints": [],
            "populations": [],
            "ambiguities": [],
        }
    )
    dspy.configure(lm=DummyLM([{"extraction": empty}]))
    program = ExtractionProgram()

    log = MetricLog()
    score = make_metric(log)(Example("order-management"), program(transcript="x"))

    assert score < 0.5
    assert log.unparseable == 0
    assert log.failed == 0
