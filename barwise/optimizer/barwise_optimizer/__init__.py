"""The DSPy optimization lane for the barwise extraction prompt.

Dev-time only. Never imported by the npm workspace, never on the
runtime path, never run in CI. See docs/specs/dspy-optimizer.spec.md.
"""

from .barwise_cli import BarwiseCliError, CaseScore, extraction_schema, score_extraction
from .dataset import compile_set, load_suite, report_set
from .metric import MetricLog, make_metric, resolvable_difference, sample_sd
from .program import SEED_INSTRUCTIONS, ExtractionProgram, build_signature

__all__ = [
    "BarwiseCliError",
    "CaseScore",
    "extraction_schema",
    "score_extraction",
    "compile_set",
    "report_set",
    "load_suite",
    "MetricLog",
    "make_metric",
    "resolvable_difference",
    "sample_sd",
    "ExtractionProgram",
    "SEED_INSTRUCTIONS",
    "build_signature",
]
