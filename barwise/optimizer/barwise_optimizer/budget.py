"""A call ceiling that actually stops the run.

`--max-calls` was help-texted as a hard ceiling and consumed by exactly
one optimizer: GEPA takes `max_metric_calls`, and `bootstrap` and
`mipro` took nothing at all. So the flag the operator was required to
supply, and by which they judged what a run would cost, enforced nothing
for two of the three choices. Same class as the rest of this session's
findings -- a value demanded and then dropped at a boundary -- and the
worst possible instance of it, because the thing not being enforced was
money.

Counting happens at `on_lm_start`, which is the only place that sees a
real call. Counting in the metric would miss the compile phase, and
counting in the program would be defeated by DSPy deep-copying the
student program during compilation -- the copy would carry its own
counter and the shared total would stop being shared.
"""

from __future__ import annotations

from dspy.utils.callback import BaseCallback


class BudgetExceeded(BaseException):
    """The ceiling was reached. Raised mid-run, on purpose.

    Stopping in the middle of a compilation loses that compilation,
    which is the point: an operator who said 200 calls meant it, and a
    run that quietly spent 900 would be worse than one that failed.

    **`BaseException`, not `Exception`, and that is load-bearing.** DSPy
    wraps callbacks in `except Exception: logger.warning(...)`, and
    `BootstrapFewShot` wraps each bootstrap attempt in `except
    Exception` too -- so an ordinary exception here is logged and the
    run continues, which is the same non-enforcement this class exists
    to fix, wearing a different hat. Deriving from `BaseException` is
    the standard idiom for control flow that blanket handlers must not
    swallow; it is why `KeyboardInterrupt` and `SystemExit` are what
    they are.

    Found because the first version of this class raised `RuntimeError`
    and the test asserting it stops a run failed while the warning
    appeared in the captured log.
    """


class CallBudget(BaseCallback):
    """Counts LM calls and refuses the one that would exceed the ceiling."""

    def __init__(self, max_calls: int):
        self.max_calls = max_calls
        self.spent = 0

    def on_lm_start(self, call_id, instance, inputs):  # noqa: ARG002
        if self.spent >= self.max_calls:
            raise BudgetExceeded(
                f"Call budget exhausted: {self.spent} of {self.max_calls} calls "
                "spent. Raise --max-calls if the run genuinely needs more, but "
                "read the run report first -- a budget hit mid-compile usually "
                "means the sample count is doing more work than the search."
            )
        self.spent += 1

    @property
    def remaining(self) -> int:
        return max(0, self.max_calls - self.spent)

    def summary(self) -> dict:
        return {"maxCalls": self.max_calls, "spent": self.spent}
