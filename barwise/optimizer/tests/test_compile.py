"""The budget refusals, and the optimizer construction.

Nothing here spends a call. What is being tested is the set of things
the driver refuses to do, because each refusal is a library default that
would be wrong here rather than merely suboptimal.
"""

from __future__ import annotations

import dspy
import pytest
from dspy.utils.dummies import DummyLM

from barwise_optimizer.compile import BudgetError, RunConfig, build_optimizer, main


def config(**overrides) -> RunConfig:
    base = dict(
        target_model="anthropic/claude-haiku-4-5",
        optimizer="bootstrap",
        max_calls=100,
        samples_per_candidate=5,
    )
    base.update(overrides)
    return RunConfig(**base)


def test_a_valid_config_passes():
    config().validate()


def test_no_call_budget_is_refused():
    # Every evaluation is a paid call. An optimizer left to its defaults
    # spends until it is satisfied rather than until the operator is.
    with pytest.raises(BudgetError, match="call budget is required"):
        config(max_calls=0).validate()


def test_one_sample_per_candidate_is_refused():
    # With one sample nothing about the spread is knowable, so the run
    # cannot say whether its winner beat the noise -- which is the only
    # question that makes the result usable.
    with pytest.raises(BudgetError, match="at least 2"):
        config(samples_per_candidate=1).validate()


def test_an_unknown_optimizer_fails_before_any_call_is_spent():
    with pytest.raises(BudgetError, match="Unknown optimizer"):
        config(optimizer="magic").validate()


def test_demo_default_is_two_not_the_library_default():
    # DSPy's BootstrapFewShot defaults to 4-16. At the measured mean
    # payload that is 8,000-32,000 tokens of demos on a 4,540-token
    # prompt, paid on every call.
    assert config().max_demos == 2


@pytest.fixture
def configured_lm():
    """An LM must be configured before any optimizer is built.

    Not a test-only nicety: MIPROv2 reads `dspy.settings.lm` in its
    constructor. `DummyLM` satisfies it without a key or a call.
    """
    dspy.configure(lm=DummyLM([{"extraction": "{}"}]))


def test_building_an_optimizer_without_an_lm_says_so(monkeypatch):
    # The failure this guard replaces: bootstrap constructs fine and
    # fails much later, mipro raises immediately, so the same ordering
    # mistake reads as "mipro is broken".
    monkeypatch.setattr(dspy.settings, "lm", None, raising=False)
    with pytest.raises(BudgetError, match="No LM is configured"):
        build_optimizer(config(), metric=lambda *a, **k: 1.0)


def test_bootstrap_is_built_with_the_configured_demo_cap(configured_lm):
    optimizer = build_optimizer(config(max_demos=3), metric=lambda *a, **k: 1.0)
    assert isinstance(optimizer, dspy.BootstrapFewShot)
    assert optimizer.max_bootstrapped_demos == 3
    # Labeled demos would be the answer keys pasted into the prompt,
    # which measures memorisation rather than extraction.
    assert optimizer.max_labeled_demos == 0


def test_each_named_optimizer_constructs(configured_lm):
    # gepa carries a proposer because DSPy refuses to construct it
    # without one; the other two are optional there.
    for name in ("bootstrap", "mipro"):
        assert build_optimizer(config(optimizer=name), metric=lambda *a, **k: 1.0)
    assert build_optimizer(
        config(optimizer="gepa", proposer_model="anthropic/claude-sonnet-5"),
        metric=lambda *a, **k: 1.0,
    )


def test_gepa_without_a_proposer_is_refused_at_config_time(configured_lm):
    # DSPy raises for this too, but deep in construction and after the
    # run has been set up. A flag is cheaper than a run.
    with pytest.raises(BudgetError, match="gepa requires --proposer-model"):
        config(optimizer="gepa").validate()


def test_the_proposer_reaches_the_optimizer_that_needs_it(configured_lm):
    # It was recorded in provenance from the start. Leaving it unwired
    # would have meant a candidate naming a proposer that never proposed
    # anything -- a value computed and dropped at the boundary.
    optimizer = build_optimizer(
        config(optimizer="mipro", proposer_model="anthropic/claude-sonnet-5"),
        metric=lambda *a, **k: 1.0,
    )
    assert optimizer.prompt_model.model == "anthropic/claude-sonnet-5"


def test_the_cli_refuses_to_start_without_a_key(monkeypatch, capsys):
    # It would otherwise fail deep inside the first call, after building
    # a program and reading the suite.
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    with pytest.raises(SystemExit):
        main(
            [
                "--target-model", "anthropic/claude-haiku-4-5",
                "--max-calls", "50",
                "--samples-per-candidate", "5",
            ]
        )

    assert "No API key" in capsys.readouterr().err


def test_the_cli_requires_the_budget_flags(capsys):
    # argparse enforces it, which is the point: there is no default to
    # fall through to.
    with pytest.raises(SystemExit):
        main(["--target-model", "anthropic/claude-haiku-4-5"])
    assert "--max-calls" in capsys.readouterr().err
