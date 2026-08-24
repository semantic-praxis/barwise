"""The extraction program DSPy optimizes.

One signature, one module, and a deliberate decision about what the
output field is.

**The output is a JSON string, not a typed Pydantic model.** DSPy would
happily take a Pydantic class and enforce it, but the schema this lane
must honour is `barwise prompt schema` -- eleven kilobytes, nested, and
owned by TypeScript. Mirroring it as Pydantic classes would be a second
copy that drifts, which is the one thing the seam exists to prevent.
So the schema is fetched at run time and rendered into the instructions,
the field stays a string, and `barwise prompt score` is the authority on
whether the string was any good. That is also the honest division of
labour: the scorer already parses and validates far more strictly than a
type annotation would.

What the optimizers actually rewrite is `Signature.instructions`, and
that is precisely the text the exporter writes into a `.prompt.yaml`.
The rest of what DSPy renders -- its field protocol, its `[[ ## ... ## ]]`
markers -- is scaffolding that production never sees, which is why the
compiled program's own score is a search signal and never the accepted
number.
"""

from __future__ import annotations

import json

import dspy

from .barwise_cli import extraction_schema

#: The seed instruction text. Deliberately short: MIPROv2 and GEPA
#: propose replacements for it, and starting from the shipped 4,540-token
#: prompt would bias the search toward paraphrases of what already exists.
#: The shipped prompt is the *baseline to beat*, not the starting point.
SEED_INSTRUCTIONS = """\
You are an expert data modeler working in Object-Role Modeling (ORM 2).

Read the transcript of a business working session and extract a
conceptual model: the object types (entities identified by a reference
mode, and self-identifying value types), the fact types relating them
with natural-language readings, any subtypes, the constraints the
transcript states or implies, and example populations where the
transcript gives concrete instances.

Report genuine ambiguities rather than guessing. Emit a single JSON
object matching the schema exactly.\
"""


def build_signature(instructions: str = SEED_INSTRUCTIONS) -> type[dspy.Signature]:
    """The extraction signature. Schema on the output field, not in the
    instructions.

    Where the schema goes is load-bearing, and putting it in the
    instructions was wrong in two ways at once. Production sends the
    schema as the extraction tool's `input_schema` and the prompt as
    `system`; an artifact whose *instructions* carried 11.5 KB of schema
    would duplicate it in every request and would not be comparable to
    the shipped artifacts it is meant to beat. And the instruction text
    is exactly what MIPROv2 and GEPA rewrite -- handing them a schema to
    paraphrase spends the search on the one part that must stay exact.

    On the output field the schema still reaches the rendered prompt
    (the adapter renders field descriptions), the optimizers leave it
    alone, and `instructions` stays the prose the exporter writes.

    Fetched, never embedded: a literal here would be right the day it
    was written and silently wrong afterwards, describing a shape the
    parser no longer accepts.
    """
    schema = json.dumps(extraction_schema(), indent=2)

    class ExtractOrmModel(dspy.Signature):
        transcript: str = dspy.InputField(
            desc="Transcript of a business working session."
        )
        extraction: str = dspy.OutputField(
            desc=(
                "A single JSON object conforming to this schema, and nothing "
                f"else:\n{schema}"
            )
        )

    return ExtractOrmModel.with_instructions(instructions)


class ExtractionProgram(dspy.Module):
    """A single predict step. No chain-of-thought, on purpose.

    `dspy.ChainOfThought` would add a reasoning field that production
    does not have and cannot use: the shipped path asks for one
    structured payload and reads it. Optimizing a program whose shape
    the runtime cannot reproduce would make the exported instructions
    unrepresentative of what was measured.
    """

    def __init__(self, instructions: str = SEED_INSTRUCTIONS):
        super().__init__()
        self.signature = build_signature(instructions)
        self.predict = dspy.Predict(self.signature)

    def forward(self, transcript: str, **_ignored) -> dspy.Prediction:
        return self.predict(transcript=transcript)

    @property
    def instructions(self) -> str:
        """The optimizable text, as the exporter needs it.

        Read off the live predictor rather than the constructor
        argument: an optimizer replaces the signature on the predictor,
        and reading the seed back would export the prompt we started
        with while reporting the score of the one we found.
        """
        return self.predict.signature.instructions
