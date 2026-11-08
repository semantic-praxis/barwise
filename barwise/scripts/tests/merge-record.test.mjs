/**
 * check:merge-record (merge-delegation decisions 1, 3, 4 and 5;
 * docs/specs/adr-batch10-enforcers.spec.md, WS6). Every case is a
 * temporary repository whose history the case builds, with the gate and its
 * libraries copied in; the API half runs the real script with a stub
 * `fetch` preloaded (`node --import`), so the case drives the same code CI
 * does and no network is touched.
 *
 * `--since` stands in for the cutoff: a sandbox has no PR #956, so the
 * first merge a case builds is its cutoff, and a merge made before it is
 * history the gate must not read.
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { judgeComments } from "../lib/merge-record.mjs";

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = "o/r";
const API = "https://api.test";
const TOKEN = "tok-123";

const ENV_OFF = [
  "GITHUB_EVENT_NAME",
  "GITHUB_TOKEN",
  "GITHUB_REPOSITORY",
  "GITHUB_API_URL",
  "GITHUB_STEP_SUMMARY",
  "GITHUB_ACTIONS",
  "BASE_SHA",
];

/** A `fetch` that answers from a routes file and logs each request. */
const STUB = `
import { appendFileSync, readFileSync } from "node:fs";
globalThis.fetch = async (url, init = {}) => {
  const routes = JSON.parse(readFileSync(process.env.STUB_ROUTES, "utf8"));
  const u = new URL(url);
  appendFileSync(process.env.STUB_LOG, JSON.stringify({
    method: init.method ?? "GET", key: u.pathname + u.search, auth: init.headers?.Authorization,
  }) + "\\n");
  const r = routes[u.pathname + u.search];
  if (r?.throws) throw new Error(r.throws);
  const { status = r ? 200 : 404, body = {}, headers = {} } = r ?? {};
  return new Response(JSON.stringify(body), { status, headers });
};
`;

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), "barwise-mergerecord-"));
  const g = (...args) =>
    execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
      .trim();
  g("init", "-q", "-b", "main");
  g("config", "user.email", "t@example.com");
  g("config", "user.name", "t");
  mkdirSync(join(dir, "barwise", "scripts", "lib"), { recursive: true });
  cpSync(
    join(SCRIPTS, "check-merge-record.mjs"),
    join(dir, "barwise", "scripts", "check-merge-record.mjs"),
  );
  for (const l of ["args", "baseline-merge", "git-run", "merge-record", "tracked"]) {
    cpSync(join(SCRIPTS, "lib", `${l}.mjs`), join(dir, "barwise", "scripts", "lib", `${l}.mjs`));
  }
  const baselinePath = join(dir, "barwise", "merge-record-baseline.json");
  const setBaseline = (merges) =>
    writeFileSync(baselinePath, JSON.stringify({ $comment: "t", merges }, null, 2) + "\n");
  setBaseline({});
  writeFileSync(join(dir, "stub.mjs"), STUB);

  const write = (rel, text) => {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), text);
  };
  const dated = (iso) => ({ GIT_COMMITTER_DATE: iso, GIT_AUTHOR_DATE: iso });
  const run = (args, iso) =>
    execFileSync("git", args, {
      cwd: dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...dated(iso) },
    }).trim();

  write("README.md", "root\n");
  g("add", "-A");
  run(["commit", "-q", "-m", "root"], "2026-11-01T00:00:00Z");

  let n = 0;
  /**
   * A feature branch merged with --no-ff. `trailers` lines may use `{head}`
   * for the feature's tip. `file` is what the branch changes, so a case can
   * make the merge tracker-only, docs-only or code.
   */
  const merge = ({
    trailers = ["Reviewed-head: {head}", "Review: merge"],
    file = "barwise/packages/core/src/a.ts",
    second = 49 + n,
  } = {}) => {
    n += 1;
    g("checkout", "-q", "-b", `f${n}`, "main");
    write(file, `change ${n}\n`);
    g("add", "-A");
    run(["commit", "-q", "-m", `feature ${n}`], "2026-11-07T00:00:00Z");
    const head = g("rev-parse", "HEAD");
    g("checkout", "-q", "main");
    const message = `Merge PR #${n}\n\n${
      trailers.map((t) => t.replaceAll("{head}", head)).join("\n")
    }\n`;
    const iso = `2026-11-07T00:54:${String(second).padStart(2, "0")}Z`;
    run(
      ["merge", "--no-ff", "-q", "-m", trailers.length ? message : `Merge PR #${n}\n`, `f${n}`],
      iso,
    );
    return { sha: g("rev-parse", "HEAD"), head, n, iso };
  };
  /** A single-parent commit on main: a squash, rebase or direct push. */
  const squash = (trailers = []) => {
    n += 1;
    write("squashed.txt", `squash ${n}\n`);
    g("add", "-A");
    run(
      ["commit", "-q", "-m", `Squash PR #${n}\n\n${trailers.join("\n")}\n`],
      "2026-11-07T00:55:00Z",
    );
    return { sha: g("rev-parse", "HEAD"), n };
  };

  const clean = () => {
    const env = { ...process.env };
    for (const k of ENV_OFF) delete env[k];
    return env;
  };
  const exec = (args, env, root = dir) =>
    spawnSync(
      process.execPath,
      [
        ...(env.STUB_ROUTES ? ["--import", pathToFileURL(join(dir, "stub.mjs")).href] : []),
        join(
          root,
          "barwise",
          "scripts",
          "check-merge-record.mjs",
        ),
        ...args,
      ],
      { cwd: root, encoding: "utf8", env },
    );
  /** The git half alone: no GitHub event. `since` defaults to the first merge made. */
  const local = (since, extra = []) => exec(["--tip", "main", "--since", since, ...extra], clean());

  // ---- the API half ----
  const routesPath = join(dir, "routes.json");
  const logPath = join(dir, "calls.log");
  const routes = {};
  const stubRoutes = {
    pulls(m, numbers = [m.n]) {
      routes[`/repos/${REPO}/commits/${m.sha}/pulls`] = {
        body: numbers.map((number) => ({ number })),
      };
    },
    comments(number, list, page = "per_page=100", extra = {}) {
      routes[`/repos/${REPO}/issues/${number}/comments?${page}`] = { body: list, ...extra };
    },
    raw(key, route) {
      routes[key] = route;
    },
  };
  /** The API half: a push event with a token, against the stubbed routes. */
  const push = (since, extra = {}, args = []) => {
    writeFileSync(routesPath, JSON.stringify(routes));
    writeFileSync(logPath, "");
    return exec(["--since", since, ...args], {
      ...clean(),
      GITHUB_EVENT_NAME: "push",
      GITHUB_TOKEN: TOKEN,
      GITHUB_REPOSITORY: REPO,
      GITHUB_API_URL: API,
      STUB_ROUTES: routesPath,
      STUB_LOG: logPath,
      ...extra,
    });
  };
  const calls = () =>
    readFileSync(logPath, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));

  return {
    dir,
    g,
    write,
    merge,
    squash,
    local,
    push,
    calls,
    setBaseline,
    baselinePath,
    stub: stubRoutes,
    exec,
    clean,
  };
}

function withSandbox(fn) {
  const s = sandbox();
  try {
    return fn(s);
  } finally {
    rmSync(s.dir, { recursive: true, force: true });
  }
}

/** A sandbox whose cutoff merge conforms, so every case starts from a green history. */
function withCutoff(fn) {
  return withSandbox((s) => {
    const cutoff = s.merge();
    return fn(s, cutoff.sha);
  });
}

const verdict = (head, v = "**merge**") => `Review verdict on head ${head}: ${v}.`;
let nextId = 1000;
const comment = (body, at, over = {}) => ({
  id: nextId++,
  created_at: at,
  updated_at: at,
  author_association: "OWNER",
  body,
  ...over,
});
const stamp = (second) => `2026-11-07T00:54:${String(second).padStart(2, "0")}Z`;

// --------------------------------------------------------------- git half

test("a merge with the right trailers passes, and a local run says it is the git half only", () =>
  withCutoff((s, since) => {
    s.merge();
    const out = s.local(since);
    assert.equal(out.status, 0, out.stdout + out.stderr);
    assert.match(out.stdout, /OK -- 2 merge\(s\)/);
    assert.match(out.stdout, /API half not run/);
  }));

test("Reviewed-head naming the first parent, not the merged head -> 1 [adr:merge-delegation#review-before-merge]", () =>
  withCutoff((s, since) => {
    const first = s.g("rev-parse", "main");
    s.merge({ trailers: [`Reviewed-head: ${first}`, "Review: merge"] });
    const out = s.local(since);
    assert.equal(out.status, 1, out.stdout + out.stderr);
    assert.match(out.stderr, /reviewed-head-mismatch/);
    assert.doesNotMatch(out.stdout, /OK/);
  }));

test("Reviewed-head that is not 40 hex -> 1", () =>
  withCutoff((s, since) => {
    s.merge({ trailers: ["Reviewed-head: abc1234", "Review: merge"] });
    const out = s.local(since);
    assert.equal(out.status, 1, out.stdout + out.stderr);
    assert.match(out.stderr, /reviewed-head-form/);
  }));

test("a Review trailer other than exactly merge -> 1", () =>
  withCutoff((s, since) => {
    s.merge({ trailers: ["Reviewed-head: {head}", "Review: merge after"] });
    const out = s.local(since);
    assert.equal(out.status, 1, out.stdout + out.stderr);
    assert.match(out.stderr, /review-not-merge/);
  }));

test("either review trailer without the other -> 1", () => {
  withCutoff((s, since) => {
    s.merge({ trailers: ["Reviewed-head: {head}"] });
    const out = s.local(since);
    assert.equal(out.status, 1, out.stdout + out.stderr);
    assert.match(out.stderr, /trailer-pair/);
  });
  withCutoff((s, since) => {
    s.merge({ trailers: ["Review: merge"] });
    const out = s.local(since);
    assert.equal(out.status, 1, out.stdout + out.stderr);
    assert.match(out.stderr, /trailer-pair/);
  });
});

test("a merge with no trailer at all is a finding, and the report prints the command that files it [adr:merge-delegation#review-before-merge]", () =>
  withCutoff((s, since) => {
    const bad = s.merge({ trailers: [] });
    const out = s.local(since);
    assert.equal(out.status, 1, out.stdout + out.stderr);
    assert.match(out.stderr, /no-record/);
    assert.match(out.stderr, new RegExp(bad.sha.slice(0, 8)));
    assert.match(
      out.stderr,
      /node barwise\/scripts\/beads-crud\.mjs create --title '[^']*' --type bug --labels merge-record/,
    );
  }));

test("a squash or direct push on the first-parent history is a finding unless Owner-directed [adr:merge-delegation#owner-overrides]", () => {
  withCutoff((s, since) => {
    s.squash(["Reviewed-head: " + "a".repeat(40), "Review: merge"]);
    const out = s.local(since);
    assert.equal(out.status, 1, out.stdout + out.stderr);
    assert.match(out.stderr, /not-a-merge/);
  });
  withCutoff((s, since) => {
    s.squash(["Owner-directed: merge it, I have read the diff"]);
    const out = s.local(since);
    assert.equal(out.status, 0, out.stdout + out.stderr);
  });
});

test("Owner-directed alone stands in for the review trailers; beside them it still holds them to the rule [adr:merge-delegation#owner-overrides]", () => {
  withCutoff((s, since) => {
    s.merge({ trailers: ["Owner-directed: merge it, I have read the diff"] });
    assert.equal(s.local(since).status, 0);
  });
  withCutoff((s, since) => {
    s.merge({ trailers: ["Reviewed-head: {head}", "Review: merge", "Owner-directed: merge it"] });
    assert.equal(s.local(since).status, 0);
  });
  withCutoff((s, since) => {
    s.merge({
      trailers: ["Reviewed-head: " + "c".repeat(40), "Review: merge", "Owner-directed: merge it"],
    });
    const out = s.local(since);
    assert.equal(out.status, 1, out.stdout + out.stderr);
    assert.match(out.stderr, /reviewed-head-mismatch/);
  });
});

test("Owner-directed with no text and no review trailers -> 1 [adr:merge-delegation#owner-overrides]", () =>
  withCutoff((s, since) => {
    s.merge({ trailers: ["Owner-directed:"] });
    const out = s.local(since);
    assert.equal(out.status, 1, out.stdout + out.stderr);
    assert.match(out.stderr, /owner-directed-empty/);
  }));

test("a tracker-only, a docs-only and a code merge are judged alike: no trailers is a finding for each, trailers pass for each [adr:merge-delegation#no-size-exemption]", () => {
  for (
    const file of [".beads/issues.jsonl", "barwise/docs/notes.md", "barwise/packages/core/src/a.ts"]
  ) {
    withCutoff((s, since) => {
      s.merge({ trailers: [], file });
      const bad = s.local(since);
      assert.equal(bad.status, 1, `${file}: ${bad.stdout}${bad.stderr}`);
      assert.match(bad.stderr, /no-record/);
    });
    withCutoff((s, since) => {
      s.merge({ file });
      const ok = s.local(since);
      assert.equal(ok.status, 0, `${file}: ${ok.stdout}${ok.stderr}`);
    });
  }
});

test("a merge before the cutoff is not read", () =>
  withSandbox((s) => {
    s.merge({ trailers: [] });
    const cutoff = s.merge();
    const out = s.local(cutoff.sha);
    assert.equal(out.status, 0, out.stdout + out.stderr);
    assert.match(out.stdout, /OK -- 1 merge\(s\)/);
  }));

test("the real cutoff is not in a repository without it -> 2, never a pass", () =>
  withCutoff((s) => {
    const out = s.exec(["--tip", "main"], s.clean());
    assert.equal(out.status, 2, out.stdout + out.stderr);
    assert.match(out.stderr, /cannot answer/);
    assert.doesNotMatch(out.stdout, /OK/);
  }));

test("a cutoff that is not on the first-parent line of the tip -> 2", () =>
  withCutoff((s, since) => {
    const side = s.merge();
    // The second parent of the newest merge is on a side branch, an ancestor
    // of the tip but not on its first-parent line.
    const out = s.local(s.g("rev-parse", `${side.sha}^2`));
    assert.equal(out.status, 2, out.stdout + out.stderr);
    assert.notEqual(since, undefined);
  }));

test("a shallow clone -> 2", () =>
  withCutoff((s, since) => {
    const clone = `${s.dir}-shallow`;
    try {
      execFileSync("git", ["clone", "-q", "--depth", "1", `file://${s.dir}`, clone], {
        stdio: "ignore",
      });
      cpSync(join(s.dir, "barwise"), join(clone, "barwise"), { recursive: true });
      const out = s.exec(["--tip", "main", "--since", since], s.clean(), clone);
      assert.equal(out.status, 2, out.stdout + out.stderr);
      assert.match(out.stderr, /shallow/);
    } finally {
      rmSync(clone, { recursive: true, force: true });
    }
  }));

test("a tip git cannot resolve -> 2", () =>
  withCutoff((s, since) => {
    const out = s.exec(["--tip", "no-such-ref", "--since", since], s.clean());
    assert.equal(out.status, 2, out.stdout + out.stderr);
  }));

// --------------------------------------------------------------- baseline

test("a baseline row for a bad merge accepts it, on a placeholder it does not", () =>
  withCutoff((s, since) => {
    const bad = s.merge({ trailers: [] });
    s.setBaseline({
      [bad.sha]: {
        subject: "x",
        rules: ["no-record"],
        status: "accepted-by-owner",
        note: "the owner merged it by hand",
      },
    });
    const ok = s.local(since);
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    assert.match(ok.stdout, /1 baseline row/);
    s.setBaseline({
      [bad.sha]: { subject: "x", rules: ["no-record"], status: "TODO: classify", note: "" },
    });
    assert.equal(s.local(since).status, 1);
  }));

test("a baseline row naming a commit outside the range is stale -> 1", () =>
  withCutoff((s, since) => {
    s.merge();
    s.setBaseline({ ["d".repeat(40)]: { status: "accepted-by-owner", note: "gone" } });
    const out = s.local(since);
    assert.equal(out.status, 1, out.stdout + out.stderr);
    assert.match(out.stderr, /not a merge in the range/);
  }));

test("a missing or malformed baseline -> 2", () =>
  withCutoff((s, since) => {
    rmSync(s.baselinePath);
    assert.equal(s.local(since).status, 2);
    writeFileSync(s.baselinePath, "{ not json");
    assert.equal(s.local(since).status, 2);
    writeFileSync(s.baselinePath, JSON.stringify({ merges: [] }));
    assert.equal(s.local(since).status, 2);
  }));

test("--write adds a placeholder row for a finding and never touches a recorded verdict", () =>
  withCutoff((s, since) => {
    const old = s.merge({ trailers: [] });
    s.setBaseline({
      [old.sha]: {
        subject: "stale subject",
        rules: ["no-record"],
        status: "accepted-by-owner",
        note: "kept",
      },
      // An acceptance of an API-only finding: the git half cannot explain it
      // and must not drop it.
      ["e".repeat(40)]: {
        subject: "api",
        rules: ["no-verdict-comment"],
        status: "tracked:barwise-x",
        note: "api",
      },
    });
    const fresh = s.merge({ trailers: [] });
    const w = s.local(since, ["--write"]);
    assert.equal(w.status, 0, w.stdout + w.stderr);
    assert.match(w.stdout, /verdict\(s\) kept/);
    const rows = JSON.parse(readFileSync(s.baselinePath, "utf8")).merges;
    assert.equal(rows[old.sha].status, "accepted-by-owner");
    assert.equal(rows[old.sha].note, "kept");
    assert.equal(rows["e".repeat(40)].status, "tracked:barwise-x");
    assert.equal(rows[fresh.sha].status, "TODO: classify");
    assert.deepEqual(rows[fresh.sha].rules, ["no-record"]);
    // The placeholder is not an acceptance: still red until a person classifies it.
    assert.equal(s.local(since).status, 1);
  }));

// ---------------------------------------------------------------- API half

/** A cutoff merge plus one reviewed merge, with that merge's PR registered. */
function withReviewed(fn, mergeOptions) {
  return withCutoff((s, since) => {
    const m = s.merge(mergeOptions);
    s.stub.pulls(m, [m.n]);
    // The cutoff merge is read too (it is inside the window).
    return fn(s, since, m);
  });
}

/** Register the cutoff merge's pull request with a good verdict, so a case isolates the merge it adds. */
function coverCutoff(s, since) {
  const c = { sha: since, n: 1, head: s.g("rev-parse", `${since}^2`) };
  s.stub.pulls(c, [1]);
  s.stub.comments(1, [comment(verdict(c.head), stamp(48))]);
}

test("a merge with a verdict comment naming its head, dated before it -> 0, and each comment read is listed [adr:merge-delegation#review-before-merge]", () =>
  withReviewed((s, since, m) => {
    coverCutoff(s, since);
    const c = comment(verdict(m.head), stamp(48));
    s.stub.comments(m.n, [c]);
    const out = s.push(since);
    assert.equal(out.status, 0, out.stdout + out.stderr);
    assert.match(
      out.stdout,
      new RegExp(`\\| ${c.id} \\| ${c.created_at} \\| ${c.updated_at} \\| [0-9a-f]{12} \\|`),
    );
    // Read-only, authenticated.
    assert.ok(s.calls().length > 0);
    assert.ok(s.calls().every((x) => x.method === "GET" && x.auth === `Bearer ${TOKEN}`));
  }));

test("right trailers but no verdict comment -> 1 [adr:merge-delegation#review-before-merge]", () =>
  withReviewed((s, since, m) => {
    coverCutoff(s, since);
    s.stub.comments(m.n, []);
    const out = s.push(since);
    assert.equal(out.status, 1, out.stdout + out.stderr);
    assert.match(out.stderr, /no-verdict-comment/);
  }));

test("a verdict comment naming another head is no verdict for this one -> 1", () =>
  withReviewed((s, since, m) => {
    coverCutoff(s, since);
    s.stub.comments(m.n, [comment(verdict("f".repeat(40)), stamp(48))]);
    const out = s.push(since);
    assert.equal(out.status, 1, out.stdout + out.stderr);
    assert.match(out.stderr, /no-verdict-comment/);
  }));

test("a verdict comment dated after the merge -> 1 [adr:merge-delegation#review-before-merge]", () =>
  withReviewed((s, since, m) => {
    coverCutoff(s, since);
    s.stub.comments(m.n, [comment(verdict(m.head), stamp(55))]);
    const out = s.push(since);
    assert.equal(out.status, 1, out.stdout + out.stderr);
    assert.match(out.stderr, /verdict-after-merge/);
  }));

test("a comment in the same second as the merge counts as before it", () =>
  withReviewed((s, since, m) => {
    coverCutoff(s, since);
    s.stub.comments(m.n, [comment(verdict(m.head), m.iso)]);
    assert.equal(s.push(since).status, 0);
  }));

test("an abbreviated head and an unbolded verdict are both spellings of the corpus", () =>
  withReviewed((s, since, m) => {
    coverCutoff(s, since);
    s.stub.comments(m.n, [
      comment(`**Review verdict on head ${m.head.slice(0, 8)}**: **merge**.\n\nbody`, stamp(48)),
    ]);
    assert.equal(s.push(since).status, 0);
    s.stub.comments(m.n, [comment(`Review verdict on head ${m.head}: merge.`, stamp(48))]);
    assert.equal(s.push(since).status, 0);
  }));

test("the latest verdict before the merge decides: do not merge after merge -> 1, merge after do not merge -> 0", () =>
  withReviewed((s, since, m) => {
    coverCutoff(s, since);
    s.stub.comments(m.n, [
      comment(verdict(m.head), stamp(40)),
      comment(verdict(m.head, "**do not merge**"), stamp(44)),
    ]);
    const out = s.push(since);
    assert.equal(out.status, 1, out.stdout + out.stderr);
    assert.match(out.stderr, /verdict-not-merge/);
    s.stub.comments(m.n, [
      comment(verdict(m.head, "**do not merge**"), stamp(40)),
      comment(verdict(m.head), stamp(44)),
    ]);
    assert.equal(s.push(since).status, 0);
  }));

test("a comment edited after the merge is reported, not a finding", () =>
  withReviewed((s, since, m) => {
    coverCutoff(s, since);
    s.stub.comments(m.n, [comment(verdict(m.head), stamp(48), { updated_at: stamp(58) })]);
    const out = s.push(since);
    assert.equal(out.status, 0, out.stdout + out.stderr);
    assert.match(out.stdout, /edited, edited after the merge/);
  }));

test("a 403 -> 2 naming the read, with no finding printed [adr:merge-delegation#review-before-merge]", () =>
  withReviewed((s, since, m) => {
    coverCutoff(s, since);
    s.stub.raw(`/repos/${REPO}/issues/${m.n}/comments?per_page=100`, {
      status: 403,
      body: { message: "no" },
    });
    const out = s.push(since);
    assert.equal(out.status, 2, out.stdout + out.stderr);
    assert.match(out.stderr, /comments of #\d+: HTTP 403/);
    assert.doesNotMatch(out.stderr, /FAIL|no-verdict-comment/);
    assert.doesNotMatch(out.stdout, /OK/);
  }));

test("a 429, a 500, an exhausted rate limit and a network failure each -> 2", () =>
  withReviewed((s, since, m) => {
    coverCutoff(s, since);
    const key = `/repos/${REPO}/issues/${m.n}/comments?per_page=100`;
    for (
      const [route, pattern] of [
        [{ status: 429 }, /HTTP 429/],
        [{ status: 500 }, /HTTP 500/],
        [{ body: [], headers: { "x-ratelimit-remaining": "0" } }, /rate limit/],
        [{ throws: "ECONNRESET" }, /network failure/],
      ]
    ) {
      s.stub.raw(key, route);
      const out = s.push(since);
      assert.equal(out.status, 2, `${JSON.stringify(route)}: ${out.stdout}${out.stderr}`);
      assert.match(out.stderr, pattern);
    }
  }));

test("a missing token or repository on a push -> 2", () =>
  withReviewed((s, since) => {
    coverCutoff(s, since);
    assert.equal(s.push(since, { GITHUB_TOKEN: "" }).status, 2);
    assert.equal(s.push(since, { GITHUB_REPOSITORY: "" }).status, 2);
  }));

test("a commit in two pull requests is an ambiguous head -> 2", () =>
  withReviewed((s, since, m) => {
    coverCutoff(s, since);
    s.stub.pulls(m, [m.n, 99]);
    const out = s.push(since);
    assert.equal(out.status, 2, out.stdout + out.stderr);
    assert.match(out.stderr, /ambiguous/);
  }));

test("a merge no pull request is listed for refuses -> 2, since the index can lag a push", () =>
  withReviewed((s, since, m) => {
    coverCutoff(s, since);
    s.stub.pulls(m, []);
    const out = s.push(since);
    assert.equal(out.status, 2, out.stdout + out.stderr);
    assert.match(out.stderr, /no pull request/);
  }));

test("of two pull requests holding a merge, the one GitHub merged it from is read", () =>
  withReviewed((s, since, m) => {
    coverCutoff(s, since);
    s.stub.raw(`/repos/${REPO}/commits/${m.sha}/pulls`, {
      body: [{ number: 99 }, { number: m.n, merge_commit_sha: m.sha }],
    });
    s.stub.comments(m.n, [comment(verdict(m.head), stamp(48))]);
    const out = s.push(since);
    assert.equal(out.status, 0, out.stdout + out.stderr);
  }));

test("a verdict from a commenter without write access does not count -> 1", () => {
  const head = "a".repeat(40);
  const merge = { sha: "b".repeat(40), parents: ["c".repeat(40), head], committed: 2_000_000_000 };
  const at = new Date(1_999_999_990_000).toISOString();
  const by = (association) =>
    judgeComments(merge, 7, [comment(verdict(head), at, { author_association: association })])
      .found.map((f) => f.rule);
  assert.deepEqual(by("OWNER"), []);
  assert.deepEqual(by("NONE"), ["no-verdict-comment"]);
  assert.deepEqual(by("CONTRIBUTOR"), ["no-verdict-comment"]);
});

test("comments on a second page are read; pagination that never ends -> 2", () =>
  withReviewed((s, since, m) => {
    coverCutoff(s, since);
    const base = `/repos/${REPO}/issues/${m.n}/comments`;
    s.stub.comments(m.n, [comment("chatter", stamp(40))], "per_page=100", {
      headers: { link: `<${API}${base}?page=2&per_page=100>; rel="next"` },
    });
    s.stub.comments(m.n, [comment(verdict(m.head), stamp(48))], "page=2&per_page=100");
    assert.equal(s.push(since).status, 0);
    s.stub.comments(m.n, [], "page=2&per_page=100", {
      headers: { link: `<${API}${base}?page=2&per_page=100>; rel="next"` },
    });
    const out = s.push(since);
    assert.equal(out.status, 2, out.stdout + out.stderr);
    assert.match(out.stderr, /still paginating/);
  }));

test("a Link: next that leaves the API origin -> 2, so the token is not sent elsewhere", () =>
  withReviewed((s, since, m) => {
    coverCutoff(s, since);
    s.stub.comments(m.n, [], "per_page=100", {
      headers: { link: `<https://evil.test/x?page=2>; rel="next"` },
    });
    const out = s.push(since);
    assert.equal(out.status, 2, out.stdout + out.stderr);
    assert.ok(s.calls().every((c) => !c.key.includes("evil")));
  }));

test("an Owner-directed merge with no verdict comment passes the API half and is not read; the same merge without the trailer fails [adr:merge-delegation#owner-overrides]", () => {
  withCutoff((s, since) => {
    coverCutoff(s, since);
    const m = s.merge({ trailers: ["Owner-directed: merge it"] });
    // No routes for it: reading it would be a 404, and a 404 is a refusal.
    const out = s.push(since);
    assert.equal(out.status, 0, out.stdout + out.stderr);
    assert.ok(s.calls().every((c) => !c.key.includes(m.sha)));
  });
  withCutoff((s, since) => {
    coverCutoff(s, since);
    const m = s.merge();
    s.stub.pulls(m, [m.n]);
    s.stub.comments(m.n, []);
    assert.equal(s.push(since).status, 1);
  });
});

test("two do-not-merge verdicts and a merge with no Owner-answer -> 1; an Owner-answer between the second and the merge -> 0 [adr:merge-delegation#ask-owner]", () =>
  withReviewed((s, since, m) => {
    coverCutoff(s, since);
    const no = (head, at) => comment(verdict(head, "**do not merge**"), stamp(at));
    s.stub.comments(m.n, [
      no("1".repeat(40), 30),
      no("2".repeat(40), 36),
      comment(verdict(m.head), stamp(48)),
    ]);
    const out = s.push(since);
    assert.equal(out.status, 1, out.stdout + out.stderr);
    assert.match(out.stderr, /two-nonmerge-verdicts/);
    s.stub.comments(m.n, [
      no("1".repeat(40), 30),
      no("2".repeat(40), 36),
      comment('Owner-answer: "merge once the docs are fixed"', stamp(40)),
      comment(verdict(m.head), stamp(48)),
    ]);
    assert.equal(s.push(since).status, 0);
    // One refusal is the ordinary loop and needs no answer.
    s.stub.comments(m.n, [no("1".repeat(40), 30), comment(verdict(m.head), stamp(48))]);
    assert.equal(s.push(since).status, 0);
    // An answer posted after the merge decides nothing about it.
    s.stub.comments(m.n, [
      no("1".repeat(40), 30),
      no("2".repeat(40), 36),
      comment(verdict(m.head), stamp(48)),
      comment("Owner-answer: late", stamp(57)),
    ]);
    assert.equal(s.push(since).status, 1);
  }));

test("outside a push the API half does not run, even with a token", () =>
  withReviewed((s, since) => {
    const out = s.push(since, { GITHUB_EVENT_NAME: "pull_request" }, ["--tip", "main"]);
    assert.equal(out.status, 0, out.stdout + out.stderr);
    assert.match(out.stdout, /API half not run \(GITHUB_EVENT_NAME is pull_request/);
    assert.equal(s.calls().length, 0);
  }));

test("only the last 30 merges are read, and an accepted merge is not read at all", () =>
  withSandbox((s) => {
    const first = s.merge();
    const all = [first];
    for (let i = 0; i < 31; i++) all.push(s.merge({ second: 1 + (i % 58) }));
    for (const m of all) {
      s.stub.pulls(m, [m.n]);
      s.stub.comments(m.n, [comment(verdict(m.head), stamp(0))]);
    }
    const out = s.push(first.sha);
    assert.equal(out.status, 0, out.stdout + out.stderr);
    const read = s.calls().filter((c) => c.key.includes("/commits/")).length;
    assert.equal(read, 30, "32 merges, a window of 30");
    assert.ok(
      s.calls().every((c) => !c.key.includes(first.sha)),
      "the oldest merge is outside the window",
    );

    // Accepting the newest drops it from the reads: its lookup is ambiguous
    // and would otherwise refuse forever over a merge the owner answered for.
    const newest = all.at(-1);
    s.stub.pulls(newest, [newest.n, 99]);
    assert.equal(s.push(first.sha).status, 2);
    s.setBaseline({
      [newest.sha]: { subject: "x", rules: ["no-record"], status: "accepted-by-owner", note: "n" },
    });
    assert.equal(s.push(first.sha).status, 0);
  }));

test("the comments read are appended to the job summary file", () =>
  withReviewed((s, since, m) => {
    coverCutoff(s, since);
    s.stub.comments(m.n, [comment(verdict(m.head), stamp(48))]);
    const summary = join(s.dir, "summary.md");
    assert.equal(s.push(since, { GITHUB_STEP_SUMMARY: summary }).status, 0);
    assert.ok(existsSync(summary));
    assert.match(readFileSync(summary, "utf8"), /comments read/);
  }));
