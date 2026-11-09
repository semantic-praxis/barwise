/**
 * The write recorder (scripts/lib/write-recorder.mjs, WS2 of
 * docs/specs/fault-matrix-axes.spec.md): what it logs, what it must not,
 * and the drift test that fails when Node adds a write the recorder does
 * not wrap.
 *
 * Everything runs in child node processes started under the recorder, the
 * way the matrix starts a gate: this process is never recorded.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPTS = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fm = await import(pathToFileURL(join(SCRIPTS, "fault-matrix.mjs")).href);

/**
 * A scratch area holding a root (its name has a space, which an unquoted
 * path in NODE_OPTIONS would split on), a sibling outside it, and the log.
 */
function sandbox() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "barwise-recorder-")));
  const root = join(base, "the root");
  const outside = join(base, "outside");
  mkdirSync(root);
  mkdirSync(outside);
  const log = join(base, "writes.jsonl");
  writeFileSync(log, "");
  const rec = { log, root, option: fm.recorderOption() };
  return {
    base,
    root,
    outside,
    log,
    rec,
    cleanup: () => rmSync(base, { recursive: true, force: true }),
    entries: () => readFileSync(log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)),
    /** Run node under the recorder with this sandbox's root. */
    node(args, { env = {}, cwd = root } = {}) {
      // This file runs under `node --test`, which marks its children; an
      // inner `node --test` that inherits the mark runs nothing and exits 0.
      const { NODE_TEST_CONTEXT: _context, ...inherited } = process.env;
      return spawnSync(process.execPath, args, {
        cwd,
        encoding: "utf8",
        env: fm.recorderEnv({ ...inherited, ...env }, rec),
      });
    },
  };
}

const ok = (r) => assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);

// --- the surface, from a plain child, a worker and a `node --test` child ---

const CASES_SOURCE = `
import fs from "node:fs";
import fsp from "node:fs/promises";
import { join } from "node:path";

const uid = process.getuid();
const gid = process.getgid();
const stream = (p) => new Promise((done) => {
  const s = fs.createWriteStream(p);
  s.on("close", done);
  s.end("x");
});
const callback = (fn) => new Promise((done, fail) => fn((e) => (e ? fail(e) : done())));

// name -> [the op the recorder must log for it, what to run against the path]
export const CASES = {
  writeFileSync: ["writeFileSync", (p) => fs.writeFileSync(p, "x")],
  appendFileSync: ["appendFileSync", (p) => fs.appendFileSync(p, "x")],
  mkdirSync: ["mkdirSync", (p) => fs.mkdirSync(p)],
  rmSync: ["rmSync", (p) => { fs.mkdirSync(p); fs.rmSync(p, { recursive: true }); }],
  rmdirSync: ["rmdirSync", (p) => { fs.mkdirSync(p); fs.rmdirSync(p); }],
  unlinkSync: ["unlinkSync", (p) => { fs.writeFileSync(p, "x"); fs.unlinkSync(p); }],
  renameSync: ["renameSync", (p) => { fs.writeFileSync(p, "x"); fs.renameSync(p, p + "-to"); }],
  copyFileSync: ["copyFileSync", (p) => { fs.writeFileSync(p + "-src", "x"); fs.copyFileSync(p + "-src", p); }],
  cpSync: ["cpSync", (p) => { fs.writeFileSync(p + "-src", "x"); fs.cpSync(p + "-src", p); }],
  symlinkSync: ["symlinkSync", (p) => fs.symlinkSync("target", p)],
  linkSync: ["linkSync", (p) => { fs.writeFileSync(p + "-src", "x"); fs.linkSync(p + "-src", p); }],
  truncateSync: ["truncateSync", (p) => { fs.writeFileSync(p, "xx"); fs.truncateSync(p, 1); }],
  chmodSync: ["chmodSync", (p) => { fs.writeFileSync(p, "x"); fs.chmodSync(p, 0o600); }],
  chownSync: ["chownSync", (p) => { fs.writeFileSync(p, "x"); fs.chownSync(p, uid, gid); }],
  lchownSync: ["lchownSync", (p) => { fs.writeFileSync(p, "x"); fs.lchownSync(p, uid, gid); }],
  utimesSync: ["utimesSync", (p) => { fs.writeFileSync(p, "x"); fs.utimesSync(p, 1, 1); }],
  lutimesSync: ["lutimesSync", (p) => { fs.writeFileSync(p, "x"); fs.lutimesSync(p, 1, 1); }],
  mkdtempSync: ["mkdtempSync", (p) => fs.mkdtempSync(p + "-")],
  mkdtempDisposableSync: ["mkdtempDisposableSync", (p) => fs.mkdtempDisposableSync(p + "-")],
  openSyncW: ["openSync", (p) => fs.closeSync(fs.openSync(p, "w"))],
  openSyncAppend: ["openSync", (p) => fs.closeSync(fs.openSync(p, "a"))],
  openSyncNumeric: ["openSync", (p) => fs.closeSync(fs.openSync(p, fs.constants.O_WRONLY | fs.constants.O_CREAT))],
  createWriteStream: ["createWriteStream", (p) => stream(p)],
  WriteStreamClass: ["open", (p) => new Promise((done) => { const s = new fs.WriteStream(p); s.on("close", done); s.end("x"); })],
  utf8Stream: ["openSync", (p) => { const u = new fs.Utf8Stream({ dest: p, sync: true }); u.write("x"); u.end(); }],
  "callback.writeFile": ["writeFile", (p) => callback((cb) => fs.writeFile(p, "x", cb))],
  "callback.mkdir": ["mkdir", (p) => callback((cb) => fs.mkdir(p, cb))],
  "callback.open": ["open", (p) => new Promise((done, fail) => fs.open(p, "w", (e, fd) => (e ? fail(e) : fs.close(fd, done))))],
  "promises.writeFile": ["writeFile", (p) => fsp.writeFile(p, "x")],
  "promises.appendFile": ["appendFile", (p) => fsp.appendFile(p, "x")],
  "promises.mkdir": ["mkdir", (p) => fsp.mkdir(p)],
  "promises.mkdtemp": ["mkdtemp", (p) => fsp.mkdtemp(p + "-")],
  "promises.mkdtempDisposable": ["mkdtempDisposable", (p) => fsp.mkdtempDisposable(p + "-")],
  "promises.rm": ["rm", async (p) => { await fsp.mkdir(p); await fsp.rm(p, { recursive: true }); }],
  "promises.rmdir": ["rmdir", async (p) => { await fsp.mkdir(p); await fsp.rmdir(p); }],
  "promises.unlink": ["unlink", async (p) => { await fsp.writeFile(p, "x"); await fsp.unlink(p); }],
  "promises.rename": ["rename", async (p) => { await fsp.writeFile(p, "x"); await fsp.rename(p, p + "-to"); }],
  "promises.copyFile": ["copyFile", async (p) => { await fsp.writeFile(p + "-src", "x"); await fsp.copyFile(p + "-src", p); }],
  "promises.cp": ["cp", async (p) => { await fsp.writeFile(p + "-src", "x"); await fsp.cp(p + "-src", p); }],
  "promises.symlink": ["symlink", (p) => fsp.symlink("target", p)],
  "promises.link": ["link", async (p) => { await fsp.writeFile(p + "-src", "x"); await fsp.link(p + "-src", p); }],
  "promises.truncate": ["truncate", async (p) => { await fsp.writeFile(p, "xx"); await fsp.truncate(p, 1); }],
  "promises.chmod": ["chmod", async (p) => { await fsp.writeFile(p, "x"); await fsp.chmod(p, 0o600); }],
  "promises.chown": ["chown", async (p) => { await fsp.writeFile(p, "x"); await fsp.chown(p, uid, gid); }],
  "promises.lchown": ["lchown", async (p) => { await fsp.writeFile(p, "x"); await fsp.lchown(p, uid, gid); }],
  "promises.utimes": ["utimes", async (p) => { await fsp.writeFile(p, "x"); await fsp.utimes(p, 1, 1); }],
  "promises.lutimes": ["lutimes", async (p) => { await fsp.writeFile(p, "x"); await fsp.lutimes(p, 1, 1); }],
  // A FileHandle's write, writeFile, appendFile and truncate never pass
  // through a wrapped function: the open is the only place to see them.
  "promises.open w": ["open", async (p) => { const h = await fsp.open(p, "w"); await h.writeFile("x"); await h.close(); }],
  "promises.open r+": ["open", async (p) => { await fsp.writeFile(p, "x"); const h = await fsp.open(p, "r+"); await h.truncate(0); await h.close(); }],
};

export async function runAll(dir) {
  for (const [name, [, fn]] of Object.entries(CASES)) await fn(join(dir, name));
}
`;

const ENTRIES = {
  direct: `import { runAll } from "./cases.mjs"; await runAll(process.argv[2]);`,
  worker: `import { Worker } from "node:worker_threads";
    const w = new Worker(new URL("./worker-body.mjs", import.meta.url), { workerData: process.argv[2] });
    await new Promise((done, fail) => { w.on("exit", done); w.on("error", fail); });`,
  test: `import { test } from "node:test";
    import { runAll } from "./cases.mjs";
    test("surface", async () => { await runAll(process.env.CASES_DIR); });`,
};
const WORKER_BODY =
  `import { workerData } from "node:worker_threads"; import { runAll } from "./cases.mjs"; await runAll(workerData);`;

test("the recorder logs every member of the write surface, from a child, a worker and a node --test child", async () => {
  const sb = sandbox();
  try {
    const code = join(sb.base, "code");
    mkdirSync(code);
    writeFileSync(join(code, "cases.mjs"), CASES_SOURCE);
    writeFileSync(join(code, "worker-body.mjs"), WORKER_BODY);
    const { CASES } = await import(pathToFileURL(join(code, "cases.mjs")).href);
    const names = Object.keys(CASES);
    assert.ok(names.length > 40, "the table must cover the surface, not a sample");

    for (const [mode, source] of Object.entries(ENTRIES)) {
      const entry = join(code, `${mode}.mjs`);
      writeFileSync(entry, source);
      const dir = join(sb.root, mode);
      mkdirSync(dir);
      const r = mode === "test"
        ? sb.node(["--test", entry], { env: { CASES_DIR: dir } })
        : sb.node([entry, dir]);
      ok(r);
      const entries = sb.entries().filter((e) => e.path.startsWith(`${dir}/`));
      for (const name of names) {
        const [op] = CASES[name];
        assert.ok(
          entries.some((e) => e.op === op && e.path.startsWith(join(dir, name))),
          `${mode}: ${name} should log ${op} for ${join(dir, name)}; log for it: ${
            JSON.stringify(entries.filter((e) => e.path.startsWith(join(dir, name))))
          }`,
        );
      }
    }
  } finally {
    sb.cleanup();
  }
});

// --- scope ---------------------------------------------------------------

test("a write undone before the gate exits is still in the log", () => {
  // The case `git status --porcelain` cannot see (barwise-w43's shape).
  const sb = sandbox();
  try {
    ok(sb.node([
      "-e",
      `const fs = require("node:fs"); fs.writeFileSync("probe", "x"); fs.rmSync("probe");`,
    ]));
    assert.deepEqual(sb.entries().map((e) => [e.op, e.path]), [
      ["writeFileSync", join(sb.root, "probe")],
      ["rmSync", join(sb.root, "probe")],
    ]);
  } finally {
    sb.cleanup();
  }
});

test("a root under the temp directory does not exempt it, and a sibling temp write does not count", () => {
  // ci:local --commit runs in a worktree under the temp directory, so
  // "not the temp directory" would exempt the whole tree. The sandbox is
  // exactly that shape; `outside` is the sibling.
  const sb = sandbox();
  try {
    ok(sb.node([
      "-e",
      `const fs = require("node:fs");
       fs.writeFileSync(${JSON.stringify(join(sb.root, "in"))}, "x");
       fs.writeFileSync(${JSON.stringify(join(sb.outside, "out"))}, "x");
       fs.mkdtempSync(require("node:path").join(require("node:os").tmpdir(), "sibling-"));`,
    ]));
    assert.deepEqual(sb.entries().map((e) => e.path), [join(sb.root, "in")]);
  } finally {
    sb.cleanup();
  }
});

test("a TMPDIR inside the root is in scope: a gate's temp write there is a write into the tree", () => {
  const sb = sandbox();
  try {
    const tmp = join(sb.root, "tmp");
    mkdirSync(tmp);
    ok(sb.node(
      ["-e", `const fs = require("node:fs"); fs.mkdtempSync(require("node:os").tmpdir() + "/x-");`],
      { env: { TMPDIR: tmp } },
    ));
    const [e] = sb.entries();
    assert.equal(e.op, "mkdtempSync");
    assert.ok(e.path.startsWith(`${tmp}/x-`), e.path);
  } finally {
    sb.cleanup();
  }
});

test("a relative path resolves against the process's cwd, and a symlink in the tree is not followed to where it points", () => {
  const sb = sandbox();
  try {
    mkdirSync(join(sb.root, "sub"));
    symlinkSync(join(sb.outside, "target"), join(sb.root, "link"));
    ok(sb.node([
      "-e",
      `const fs = require("node:fs");
       fs.writeFileSync("rel", "x");
       fs.rmSync("../link");
       fs.writeFileSync("../../outside/other", "x");`,
    ], { cwd: join(sb.root, "sub") }));
    assert.deepEqual(sb.entries().map((e) => [e.op, e.path]), [
      ["writeFileSync", join(sb.root, "sub", "rel")],
      // removing the link is a write into the tree even though it points out
      ["rmSync", join(sb.root, "link")],
    ]);
  } finally {
    sb.cleanup();
  }
});

test("reads are not logged, including an open without a write mode and open(path, callback)", () => {
  const sb = sandbox();
  try {
    writeFileSync(join(sb.root, "existing"), "x");
    ok(sb.node([
      "-e",
      `const fs = require("node:fs");
       fs.readFileSync("existing"); fs.statSync("existing"); fs.readdirSync(".");
       fs.closeSync(fs.openSync("existing", "r"));
       fs.closeSync(fs.openSync("existing"));
       fs.open("existing", (e, fd) => fs.closeSync(fd));
       fs.createReadStream("existing").resume();
       fs.existsSync("nothing"); fs.accessSync("existing");`,
    ]));
    assert.deepEqual(sb.entries(), []);
  } finally {
    sb.cleanup();
  }
});

// --- the re-entrancy guard -------------------------------------------------

test("a public call that calls another public call is logged once", () => {
  // appendFileSync calls the public writeFileSync, cpSync the public
  // copyFileSync, truncateSync the public openSync. Without the guard each
  // logs twice, and a count of writes stops meaning a count of writes.
  // Remove `busy` from write-recorder.mjs and this fails.
  const sb = sandbox();
  try {
    ok(sb.node([
      "-e",
      `const fs = require("node:fs");
       fs.appendFileSync("a", "x"); fs.cpSync("a", "b"); fs.truncateSync("b", 0);`,
    ]));
    assert.deepEqual(
      sb.entries().map((e) => [e.op, e.path.slice(sb.root.length + 1)]),
      [["appendFileSync", "a"], ["cpSync", "b"], ["truncateSync", "b"]],
    );
  } finally {
    sb.cleanup();
  }
});

test("concurrent processes' log lines stay whole", () => {
  const sb = sandbox();
  try {
    const script = `const fs = require("node:fs");
      for (let i = 0; i < 300; i++) fs.writeFileSync("f" + process.pid + "-" + i, "x");`;
    const children = Array.from({ length: 4 }, () =>
      spawnSync(process.execPath, ["-e", script], {
        cwd: sb.root,
        encoding: "utf8",
        env: fm.recorderEnv(process.env, sb.rec),
      }));
    for (const r of children) ok(r);
    assert.equal(sb.entries().length, 1200, "every line must parse and none may be lost");
  } finally {
    sb.cleanup();
  }
});

// --- the accepted residual (owner, 2026-11-09) ---------------------------------

test("a node child writing into a gitignored path is seen; a shell redirect is not (the pinned residual)", () => {
  // `git status --porcelain` ignores dist, .turbo and node_modules, so for
  // those paths the recorder is the only signal, and it sees only node. The
  // second assertion pins what is NOT seen: the day a shell's write becomes
  // visible this fails and says the ADR and the report footer are out of date.
  const sb = sandbox();
  try {
    mkdirSync(join(sb.root, "dist"));
    ok(sb.node([
      "-e",
      `require("node:fs").writeFileSync("dist/by-node", "x");
       const r = require("node:child_process").spawnSync("sh", ["-c", "echo x > dist/by-sh"]);
       process.exit(r.status);`,
    ]));
    assert.deepEqual(sb.entries().map((e) => e.path), [join(sb.root, "dist", "by-node")]);
    assert.ok(
      readFileSync(join(sb.root, "dist", "by-sh"), "utf8").length > 0,
      "the shell did write",
    );
  } finally {
    sb.cleanup();
  }
});

test("a node child started with a scrubbed environment is not seen (the pinned residual)", () => {
  const sb = sandbox();
  try {
    ok(sb.node([
      "-e",
      `const r = require("node:child_process").spawnSync(process.execPath,
         ["-e", "require('node:fs').writeFileSync('scrubbed', 'x')"], { env: {} });
       process.exit(r.status);`,
    ]));
    assert.deepEqual(sb.entries(), []);
    assert.ok(readFileSync(join(sb.root, "scrubbed"), "utf8"));
  } finally {
    sb.cleanup();
  }
});

test("the recorder records nothing when the matrix did not ask for it", () => {
  const sb = sandbox();
  try {
    const r = spawnSync(process.execPath, [
      "--import",
      sb.rec.option.replace("--import=", ""),
      "-e",
      `require("node:fs").writeFileSync("x", "y")`,
    ], { cwd: sb.root, encoding: "utf8", env: { ...process.env, BARWISE_WRITE_LOG: "" } });
    ok(r);
    assert.deepEqual(sb.entries(), []);
  } finally {
    sb.cleanup();
  }
});

// --- the drift test ----------------------------------------------------------
//
// The recorder wraps a list of fs functions. Node adds functions
// (`mkdtempDisposableSync` and `Utf8Stream` are recent), and one that writes
// and is not on the list would be a hole the matrix cannot report. So every
// export of `fs` and `fs/promises` on the pinned Node is classified here, and
// an unclassified one fails with its name. It is the shadow of a property
// ("no write is invisible"), and it is a gate here because the list it holds
// is short, owned, and the only place a new method can be noticed.

const FS_WRAPPED = [
  "appendFile",
  "appendFileSync",
  "chmod",
  "chmodSync",
  "chown",
  "chownSync",
  "copyFile",
  "copyFileSync",
  "cp",
  "cpSync",
  "createWriteStream",
  "lchown",
  "lchownSync",
  "link",
  "linkSync",
  "lutimes",
  "lutimesSync",
  "mkdir",
  "mkdirSync",
  "mkdtemp",
  "mkdtempDisposableSync",
  "mkdtempSync",
  "open",
  "openSync",
  "rename",
  "renameSync",
  "rm",
  "rmSync",
  "rmdir",
  "rmdirSync",
  "symlink",
  "symlinkSync",
  "truncate",
  "truncateSync",
  "unlink",
  "unlinkSync",
  "utimes",
  "utimesSync",
  "writeFile",
  "writeFileSync",
];
const FSP_WRAPPED = [
  "appendFile",
  "chmod",
  "chown",
  "copyFile",
  "cp",
  "lchmod",
  "lchown",
  "link",
  "lutimes",
  "mkdir",
  "mkdtemp",
  "mkdtempDisposable",
  "open",
  "rename",
  "rm",
  "rmdir",
  "symlink",
  "truncate",
  "unlink",
  "utimes",
  "writeFile",
];
/** Act on a descriptor, which an open already named: covered by the logged open. */
const FS_DESCRIPTOR = [
  "fchmod",
  "fchmodSync",
  "fchown",
  "fchownSync",
  "fdatasync",
  "fdatasyncSync",
  "fsync",
  "fsyncSync",
  "ftruncate",
  "ftruncateSync",
  "futimes",
  "futimesSync",
  "write",
  "writeSync",
  "writev",
  "writevSync",
];
/** Classes that write by calling the wrapped `open`/`openSync` (checked above). */
const FS_VIA_OPEN = ["FileWriteStream", "Utf8Stream", "WriteStream"];
const FS_READ_ONLY = [
  "Dir",
  "Dirent",
  "FileReadStream",
  "ReadStream",
  "Stats",
  "_toUnixTimestamp",
  "access",
  "accessSync",
  "close",
  "closeSync",
  "createReadStream",
  "exists",
  "existsSync",
  "fstat",
  "fstatSync",
  "glob",
  "globSync",
  "lstat",
  "lstatSync",
  "openAsBlob",
  "opendir",
  "opendirSync",
  "read",
  "readFile",
  "readFileSync",
  "readSync",
  "readdir",
  "readdirSync",
  "readlink",
  "readlinkSync",
  "readv",
  "readvSync",
  "realpath",
  "realpathSync",
  "stat",
  "statSync",
  "statfs",
  "statfsSync",
  "unwatchFile",
  "watch",
  "watchFile",
];
const FSP_READ_ONLY = [
  "access",
  "glob",
  "lstat",
  "opendir",
  "readFile",
  "readdir",
  "readlink",
  "realpath",
  "stat",
  "statfs",
  "watch",
];
/** FileHandle methods that write; each is the open that made the handle. */
const HANDLE_WRITES = [
  "appendFile",
  "chmod",
  "chown",
  "createWriteStream",
  "datasync",
  "sync",
  "truncate",
  "utimes",
  "write",
  "writeFile",
  "writev",
];
const HANDLE_READ_ONLY = [
  "constructor",
  "createReadStream",
  "fd",
  "getAsyncId",
  "read",
  "readFile",
  "readLines",
  "readableWebStream",
  "readv",
  "stat",
];

/** The exports no list above accounts for: what the drift test fails on. */
export function unclassified(exported, ...lists) {
  const known = new Set(lists.flat());
  return exported.filter((n) => !known.has(n));
}

const PROBE = `
import fs from "node:fs";
import fsp from "node:fs/promises";
const MARK = Symbol.for("barwise.write-recorder");
const fns = (o) => Object.keys(o).filter((k) => typeof o[k] === "function").sort();
const h = await fsp.open(process.argv[1], "r");
const handle = Object.getOwnPropertyNames(Object.getPrototypeOf(h)).sort();
await h.close();
console.log(JSON.stringify({
  fs: fns(fs), fsp: fns(fsp),
  fsWrapped: fns(fs).filter((k) => fs[k][MARK]),
  fspWrapped: fns(fsp).filter((k) => fsp[k][MARK]),
  handle,
}));
`;

function probeSurface() {
  const sb = sandbox();
  try {
    const file = join(sb.base, "probe.mjs");
    writeFileSync(file, PROBE);
    const r = sb.node([file, file]);
    ok(r);
    return JSON.parse(r.stdout);
  } finally {
    sb.cleanup();
  }
}

test("drift: every export of fs and fs/promises on this Node is wrapped or classified, and the recorder wraps exactly the pinned list", () => {
  const s = probeSurface();
  assert.deepEqual(s.fsWrapped, FS_WRAPPED, "fs functions the recorder wraps");
  assert.deepEqual(s.fspWrapped, FSP_WRAPPED, "fs/promises functions the recorder wraps");
  assert.deepEqual(
    unclassified(s.fs, FS_WRAPPED, FS_DESCRIPTOR, FS_VIA_OPEN, FS_READ_ONLY),
    [],
    `Node ${process.version} exports an fs function the recorder neither wraps nor classifies. `
      + "A function that writes goes in write-recorder.mjs SURFACE and FS_WRAPPED here; "
      + "one that cannot write goes in FS_READ_ONLY.",
  );
  assert.deepEqual(
    unclassified(s.fsp, FSP_WRAPPED, FSP_READ_ONLY),
    [],
    `Node ${process.version} exports an fs/promises function the recorder neither wraps nor classifies.`,
  );
  assert.deepEqual(
    unclassified(s.handle, HANDLE_WRITES, HANDLE_READ_ONLY),
    [],
    `Node ${process.version} gives a FileHandle a method no list classifies. A write method is `
      + "covered by the logged open only if it is in HANDLE_WRITES, which this test maps to that open.",
  );
  // The pinned lists name only things that exist, so a typo cannot pass.
  for (const n of [...FS_WRAPPED, ...FS_DESCRIPTOR, ...FS_VIA_OPEN]) assert.ok(s.fs.includes(n), n);
  for (const n of FSP_WRAPPED) assert.ok(s.fsp.includes(n), n);
  for (const n of HANDLE_WRITES) assert.ok(s.handle.includes(n), n);
});

test("drift: a stub export added to the export list fails the classification", () => {
  const s = probeSurface();
  assert.deepEqual(
    unclassified(
      [...s.fs, "writeEverythingSync"],
      FS_WRAPPED,
      FS_DESCRIPTOR,
      FS_VIA_OPEN,
      FS_READ_ONLY,
    ),
    ["writeEverythingSync"],
  );
  assert.deepEqual(
    unclassified([...s.handle, "writeAll"], HANDLE_WRITES, HANDLE_READ_ONLY),
    ["writeAll"],
  );
});
