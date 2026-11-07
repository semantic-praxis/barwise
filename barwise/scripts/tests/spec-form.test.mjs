/**
 * check-spec-form (docs/specs/adr-batch10-enforcers.spec.md, WS2): the
 * Open decisions reader on single texts, then the gate end to end in a
 * sandbox repository whose first commit is the cutoff.
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  OPEN_DECISIONS_REQUIRED_SINCE,
  openDecisions,
  openDecisionsFindings,
} from "../lib/spec-reader.mjs";

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), "..");
const SPECS = "barwise/docs/specs";

const spec = (open) => `# S\n\nStatus: Draft\n\n## Plan\n\nThe plan.\n\n${open}`;

// --- the reader, on single texts ---

test("a section of cued entries conforms, whatever suffix the heading carries", () => {
  for (const heading of ["## Open decisions", "## Open decisions (for review)"]) {
    const text = spec(
      `${heading}\n\n1. **Which?** Recommend A.\n2. **When?** **Resolved (owner):** now.\n`,
    );
    assert.deepEqual(openDecisionsFindings(text), [], heading);
  }
});

test("each cue alone satisfies an entry, in any case", () => {
  for (const cue of ["recommend", "Resolved", "taken as", "DECIDED", "default"]) {
    assert.deepEqual(openDecisionsFindings(spec(`## Open decisions\n\n- Q? ${cue}.\n`)), [], cue);
  }
});

test("no heading is a finding, and a different heading is not the heading", () => {
  assert.match(openDecisionsFindings("# S\n\n## Plan\n\nx\n")[0], /no `## Open decisions` heading/);
  const renamed = spec("## Decisions (for review)\n\n1. Recommend A.\n");
  assert.match(openDecisionsFindings(renamed)[0], /no `## Open decisions` heading/);
  const deeper = spec("### Open decisions\n\n1. Recommend A.\n");
  assert.match(openDecisionsFindings(deeper)[0], /no `## Open decisions` heading/);
});

test("a heading inside a code fence is not the heading", () => {
  const text = spec("```md\n## Open decisions\n\n1. Recommend A.\n```\n");
  assert.equal(openDecisions(text), undefined);
});

test("an entry without a cue is named, others in the section pass", () => {
  const f = openDecisionsFindings(
    spec("## Open decisions\n\n1. **A?** Recommend yes.\n2. **B?** Options are x or y.\n"),
  );
  assert.equal(f.length, 1);
  assert.match(f[0], /B\?/);
});

test("a cue in a continuation line or nested bullet belongs to its entry", () => {
  const text = spec(
    "## Open decisions\n\n1. **A?** Options x or y.\n   The default is x.\n2. **B?**\n   - Resolved: z.\n",
  );
  assert.deepEqual(openDecisionsFindings(text), []);
});

test("a cue on the next entry does not rescue the one before it", () => {
  const f = openDecisionsFindings(spec("## Open decisions\n\n- Bare.\n- Recommend A.\n"));
  assert.equal(f.length, 1);
  assert.match(f[0], /Bare/);
});

test("None. alone is accepted; prose or an empty section is not", () => {
  assert.deepEqual(openDecisionsFindings(spec("## Open decisions\n\nNone.\n")), []);
  assert.match(openDecisionsFindings(spec("## Open decisions\n\n"))[0], /has no entry/);
  assert.match(
    openDecisionsFindings(spec("## Open decisions\n\nNone yet, decided later.\n"))[0],
    /does not say only `None.`/,
  );
});

test("the section ends at the next heading, so a later cue does not count", () => {
  const text = spec("## Open decisions\n\n- Bare.\n\n## Risks\n\n- Recommend A, a default.\n");
  assert.equal(openDecisionsFindings(text).length, 1);
});

test("the cutoff is a full commit id", () => {
  assert.match(OPEN_DECISIONS_REQUIRED_SINCE, /^[0-9a-f]{40}$/);
});

// --- the gate, end to end ---

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), "barwise-specform-"));
  const g = (...args) =>
    execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
      .trim();
  g("init", "-q", "-b", "main");
  g("config", "user.email", "t@example.com");
  g("config", "user.name", "t");
  mkdirSync(join(dir, "barwise", "scripts", "lib"), { recursive: true });
  const libs = ["args", "git-run", "review-tiers", "spec-cutoff", "spec-reader", "tracked"];
  cpSync(
    join(SCRIPTS, "check-spec-form.mjs"),
    join(dir, "barwise", "scripts", "check-spec-form.mjs"),
  );
  for (const l of libs) {
    cpSync(join(SCRIPTS, "lib", `${l}.mjs`), join(dir, "barwise", "scripts", "lib", `${l}.mjs`));
  }
  const write = (rel, text) => {
    mkdirSync(dirname(join(dir, SPECS, rel)), { recursive: true });
    writeFileSync(join(dir, SPECS, rel), text);
  };
  const commit = (msg) => {
    g("add", "-A");
    g("commit", "-q", "-m", msg);
    return g("rev-parse", "HEAD");
  };
  // The existing corpus: no Open decisions section at all, exempt.
  write("old.spec.md", "# Old\n\nStatus: Draft\n\n## Plan\n\nx\n");
  write("archive/arch.spec.md", "# Arch\n\nStatus: Draft\n");
  const cutoff = commit("cutoff");
  const run = (args = ["--cutoff", cutoff]) =>
    spawnSync(process.execPath, [join(dir, "barwise", "scripts", "check-spec-form.mjs"), ...args], {
      cwd: dir,
      encoding: "utf8",
    });
  return {
    dir,
    g,
    write,
    commit,
    cutoff,
    run,
    done: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test("the gate passes a new spec with conforming entries, and one that says None.", () => {
  const r = sandbox();
  try {
    r.write("new.spec.md", spec("## Open decisions\n\n1. Which? Recommend A.\n"));
    r.write("none.spec.md", spec("## Open decisions\n\nNone.\n"));
    r.commit("add specs");
    const out = r.run();
    assert.equal(out.status, 0, out.stdout + out.stderr);
    assert.match(out.stdout, /2 of 3 spec\(s\) new since the cutoff .*\. OK/);
  } finally {
    r.done();
  }
});

test("the gate fails a new spec with no Open decisions heading, naming it", () => {
  const r = sandbox();
  try {
    r.write("new.spec.md", spec("## Risks\n\nNone.\n"));
    r.commit("add a spec");
    const out = r.run();
    assert.equal(out.status, 1, out.stdout + out.stderr);
    assert.match(out.stderr, /new\.spec\.md: has no `## Open decisions` heading/);
    assert.doesNotMatch(out.stdout, /OK/);
  } finally {
    r.done();
  }
});

test("the gate fails a new spec with an entry that has no cue", () => {
  const r = sandbox();
  try {
    r.write("new.spec.md", spec("## Open decisions\n\n1. Which? Options are x or y.\n"));
    r.commit("add a spec");
    const out = r.run();
    assert.equal(out.status, 1, out.stdout + out.stderr);
    assert.match(out.stderr, /new\.spec\.md: an Open decisions entry names no recommendation/);
  } finally {
    r.done();
  }
});

test("a spec present by file name at the cutoff is exempt: edited, archived, moved", () => {
  const r = sandbox();
  try {
    // Edited in place without the section, then moved into archive/ and
    // another existing spec moved out of it: the file name is what counts.
    r.write("old.spec.md", "# Old\n\nStatus: Draft\n\n## Plan\n\nedited\n");
    r.g("mv", join(SPECS, "archive", "arch.spec.md"), join(SPECS, "arch.spec.md"));
    r.commit("edit and move existing specs");
    const out = r.run();
    assert.equal(out.status, 0, out.stdout + out.stderr);
  } finally {
    r.done();
  }
});

test("an archived new spec and a non-spec document are left alone", () => {
  const r = sandbox();
  try {
    r.write("archive/new-arch.spec.md", "# A\n\nno section\n");
    r.write("notes.md", "# Notes\n");
    r.commit("add archived spec and a note");
    const out = r.run();
    assert.equal(out.status, 0, out.stdout + out.stderr);
  } finally {
    r.done();
  }
});

test("a renamed spec reads as new", () => {
  const r = sandbox();
  try {
    r.g("mv", join(SPECS, "old.spec.md"), join(SPECS, "renamed.spec.md"));
    r.commit("rename");
    const out = r.run();
    assert.equal(out.status, 1, out.stdout + out.stderr);
    assert.match(out.stderr, /renamed\.spec\.md/);
  } finally {
    r.done();
  }
});

test("the gate judges the working tree: an unstaged edit that drops the section fails", () => {
  const r = sandbox();
  try {
    r.write("new.spec.md", spec("## Open decisions\n\n1. Which? Recommend A.\n"));
    r.commit("add a spec");
    assert.equal(r.run().status, 0);
    r.write("new.spec.md", spec("## Risks\n\nx\n"));
    const out = r.run();
    assert.equal(out.status, 1, out.stdout + out.stderr);
  } finally {
    r.done();
  }
});

test("the gate names an untracked spec as unchecked rather than claiming it", () => {
  const r = sandbox();
  try {
    r.write("draft.spec.md", spec("## Risks\n\nx\n"));
    const out = r.run();
    assert.equal(out.status, 0, out.stdout + out.stderr);
    assert.match(out.stdout, /unchecked \(untracked\): .*draft\.spec\.md/);
  } finally {
    r.done();
  }
});

test("the gate refuses when the cutoff is not in the clone, and never prints OK", () => {
  // Without --cutoff the gate looks for the real cutoff commit, which the
  // sandbox does not hold: the same reading as a clone fetched short of it.
  const r = sandbox();
  try {
    r.write("new.spec.md", spec("## Risks\n\nx\n"));
    r.commit("add a spec");
    const out = r.run([]);
    assert.equal(out.status, 2, out.stdout + out.stderr);
    assert.match(out.stderr, /cannot answer -- the cutoff [0-9a-f]+ is not in this clone/);
    assert.match(out.stderr, /git fetch origin main/);
    assert.doesNotMatch(out.stdout, /OK/);
  } finally {
    r.done();
  }
});

test("the gate refuses a --cutoff that names no single commit, about the revision", () => {
  const r = sandbox();
  try {
    for (const rev of ["f".repeat(40), "no-such-ref"]) {
      const out = r.run(["--cutoff", rev]);
      assert.equal(out.status, 2, out.stdout + out.stderr);
      assert.match(out.stderr, new RegExp(`--cutoff ${rev} names no single commit`));
      assert.doesNotMatch(out.stderr, /fetch/);
    }
  } finally {
    r.done();
  }
});

test("the gate refuses a shallow clone that stops short of the cutoff", () => {
  const r = sandbox();
  const shallow = mkdtempSync(join(tmpdir(), "barwise-specform-shallow-"));
  try {
    r.write("new.spec.md", spec("## Risks\n\nx\n"));
    r.commit("add a spec");
    rmSync(shallow, { recursive: true, force: true });
    execFileSync("git", ["clone", "-q", "--depth", "1", `file://${r.dir}`, shallow], {
      stdio: "ignore",
    });
    const out = spawnSync(
      process.execPath,
      [join(shallow, "barwise", "scripts", "check-spec-form.mjs"), "--cutoff", r.cutoff],
      { cwd: shallow, encoding: "utf8" },
    );
    assert.equal(out.status, 2, out.stdout + out.stderr);
    assert.match(out.stderr, /shallow/);
    assert.doesNotMatch(out.stdout, /OK/);
  } finally {
    r.done();
    rmSync(shallow, { recursive: true, force: true });
  }
});

test("the gate refuses when no spec is tracked", () => {
  const r = sandbox();
  try {
    r.g("rm", "-rq", SPECS);
    r.commit("remove every spec");
    const out = r.run();
    assert.equal(out.status, 2, out.stdout + out.stderr);
    assert.match(out.stderr, /no spec under barwise\/docs\/specs\/ is tracked/);
  } finally {
    r.done();
  }
});

test("the real cutoff resolves in this clone, and a spec present at it is exempt", () => {
  // Fails loudly in a shallow clone rather than skipping: a skipped check
  // of the constant reads the same as a passing one.
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: SCRIPTS,
    encoding: "utf8",
  }).trim();
  const id = execFileSync(
    "git",
    ["rev-parse", "--verify", `${OPEN_DECISIONS_REQUIRED_SINCE}^{commit}`],
    { cwd: root, encoding: "utf8" },
  ).trim();
  assert.equal(id, OPEN_DECISIONS_REQUIRED_SINCE);
  const tree = execFileSync("git", ["ls-tree", "-r", "--name-only", id], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  assert.match(tree, /barwise\/docs\/specs\/adr-batch9-enforcers\.spec\.md/);
  // The exemption itself, through the gate's own path: a spec at the
  // cutoff with no section does not fail.
  const r = sandbox();
  try {
    assert.equal(r.run().status, 0);
  } finally {
    r.done();
  }
});
