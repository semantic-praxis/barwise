/**
 * A `node --test` reporter that writes one JSON line per finished test or
 * suite, for `check:adr-tests` (docs/specs/executable-adrs.spec.md, WS2):
 *
 *   { "name": "...", "type": "test" | "suite", "status": "passed" | "failed"
 *     | "skipped" | "todo", "file": "..." }
 *
 * It runs beside the reporter a person reads, never instead of it, each
 * with its own `--test-reporter-destination`.
 *
 * `type` is kept because node emits `test:pass` for a `describe` too: a tag
 * on a suite would otherwise read as a passed test with no test run. The
 * check counts only `test` lines as evidence, and reads `suite` lines only
 * to report a stale tag.
 *
 * `skip` and `todo` are truthy, not `true`: a test skipped with a reason
 * (`t.skip("gitleaks is not installed")`, `{ todo: "soon" }`) carries the
 * reason string, and such a test did not run (barwise-ym8.7jz, item 1).
 */
export default async function* testTagReporter(source) {
  for await (const event of source) {
    if (event.type !== "test:pass" && event.type !== "test:fail") continue;
    const d = event.data;
    const status = d.skip
      ? "skipped"
      : d.todo
      ? "todo"
      : event.type === "test:pass"
      ? "passed"
      : "failed";
    yield `${
      JSON.stringify({
        name: d.name,
        type: d.details?.type === "suite" ? "suite" : "test",
        status,
        file: d.file ?? null,
      })
    }\n`;
  }
}
