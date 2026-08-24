"""The call ceiling, proved to stop a run rather than merely be required.

`--max-calls` was help-texted as a hard ceiling and consumed by exactly
one optimizer: GEPA took `max_metric_calls`, and bootstrap and mipro
took nothing. The flag the operator was required to supply, and by which
they judged what a run would cost, enforced nothing for two of the three
choices -- and the thing not being enforced was money.

Found while preparing the first real compilation, which was to be a
bootstrap run.
"""

from __future__ import annotations

import dspy
import pytest
from dspy.utils.dummies import DummyLM

from barwise_optimizer.budget import BudgetExceeded, CallBudget
from barwise_optimizer.program import ExtractionProgram


@pytest.fixture(autouse=True)
def clean_callbacks():
    yield
    dspy.settings.configure(callbacks=[])


def test_the_ceiling_stops_the_run_rather_than_being_advisory():
    budget = CallBudget(max_calls=3)
    dspy.configure(lm=DummyLM([{"extraction": "{}"}] * 50), callbacks=[budget])
    program = ExtractionProgram()

    for _ in range(3):
        program(transcript="a transcript")

    assert budget.spent == 3
    with pytest.raises(BudgetExceeded, match="Call budget exhausted"):
        program(transcript="one too many")


def test_it_counts_real_calls_not_metric_invocations():
    # Counting in the metric would miss the compile phase entirely, and
    # bootstrap spends most of its calls there.
    budget = CallBudget(max_calls=10)
    dspy.configure(lm=DummyLM([{"extraction": "{}"}] * 50), callbacks=[budget])
    program = ExtractionProgram()

    program(transcript="x")
    program(transcript="y")

    assert budget.spent == 2
    assert budget.remaining == 8


def test_a_deep_copied_program_still_spends_the_same_budget():
    # The reason the budget is a callback rather than a field on the
    # program: DSPy deep-copies the student during compilation, so a
    # counter living on the program would stop being shared exactly when
    # it started mattering.
    import copy

    budget = CallBudget(max_calls=4)
    dspy.configure(lm=DummyLM([{"extraction": "{}"}] * 50), callbacks=[budget])
    program = ExtractionProgram()
    twin = copy.deepcopy(program)

    program(transcript="x")
    twin(transcript="y")

    assert budget.spent == 2


def test_the_summary_is_what_the_run_report_records():
    budget = CallBudget(max_calls=7)
    assert budget.summary() == {"maxCalls": 7, "spent": 0}


def test_a_run_does_not_leave_its_budget_behind(tmp_path):
    # dspy.settings is global. A run that appended its budget and never
    # removed it would leave a second run counting against the first
    # one's ceiling, tripping partway through for reasons nothing in
    # that run explains. Found by a fixture that calls run() four times.
    from pathlib import Path

    from dspy.utils.dummies import DummyLM

    from barwise_optimizer.compile import RunConfig, run

    dspy.configure(lm=DummyLM([{"extraction": "{}"}] * 500), callbacks=[])
    before = list(dspy.settings.callbacks or [])

    run(
        RunConfig(
            target_model="anthropic/claude-haiku-4-5",
            optimizer="bootstrap",
            max_calls=200,
            samples_per_candidate=2,
        ),
        Path(tmp_path),
    )

    assert list(dspy.settings.callbacks or []) == before
