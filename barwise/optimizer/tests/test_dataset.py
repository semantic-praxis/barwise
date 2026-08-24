"""The split discipline, which is the only reason this module exists.

The dev cases are held out so a tuned prompt can be caught overfitting.
An optimizer handed the whole suite would compile against them and
report a number that means nothing, silently -- so the interesting
assertions here are about what a compile set must *not* contain.
"""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml

from barwise_optimizer.dataset import (
    SuiteError,
    compile_set,
    load_examples,
    load_suite,
    report_set,
)


def test_compile_set_is_train_and_holds_no_dev_case():
    suite = load_suite()
    dev_ids = set(suite.splits["dev"])
    train_ids = {e.case_id for e in compile_set()}

    assert train_ids
    assert dev_ids
    assert train_ids.isdisjoint(dev_ids)


def test_report_set_is_exactly_the_held_out_split():
    suite = load_suite()
    assert {e.case_id for e in report_set()} == set(suite.splits["dev"])


def test_examples_carry_the_transcript_and_the_case_id():
    # The metric scores per case against that case's own rubric, so an
    # example without its id cannot be scored at all.
    example = compile_set()[0]
    assert example.case_id
    assert len(example.transcript) > 100
    assert "transcript" in example.inputs()


def test_a_manifest_without_splits_is_refused(tmp_path: Path):
    # Not defaulted to "everything". A suite with no declared split
    # cannot support the train/dev discipline, and quietly compiling
    # against all of it is the failure this refusal prevents.
    manifest = tmp_path / "suite.yaml"
    manifest.write_text(
        yaml.safe_dump({"version": "9.9.9", "cases": ["a.eval.yaml"]}), encoding="utf-8"
    )

    with pytest.raises(SuiteError, match="declares no `splits`"):
        load_suite(manifest)


def test_unknown_split_names_the_available_ones():
    with pytest.raises(SuiteError, match="train"):
        load_examples("holdout")


def test_suite_version_is_read_for_provenance():
    # Recorded on every candidate: a score is only comparable within a
    # suite version, and 1.3.0 is not comparable to 1.2.0.
    assert load_suite().version
