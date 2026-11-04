// The smallest suite vitest will transform and run: it imports nothing from
// the workspace, so it needs no build (scripts/tests/vitest-tmp.test.mjs).
// It also proves the run saw the temp directory the test chose; otherwise
// an empty directory afterwards would show only that vitest wrote elsewhere.
import { tmpdir } from "node:os";
import { expect, test } from "vitest";

test("runs, under the temp directory it was given", () => {
  expect(tmpdir()).toBe(process.env.BARWISE_EXPECTED_TMPDIR);
});
