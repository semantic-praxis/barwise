/**
 * The write recorder (docs/specs/fault-matrix-axes.spec.md, WS2).
 *
 * Not imported by anything: `fault-matrix.mjs` base64-encodes this file into
 * `--import=data:...` and appends it to the gate's NODE_OPTIONS, so it loads
 * into the gate, every node process the gate starts, and every worker. An
 * inline module because a path with a space splits NODE_OPTIONS and a missing
 * file makes every node command exit 1 (scripts/hooks/exit-recorder.mjs, the
 * precedent). Hence it stands alone: node: builtins only.
 *
 * It records only where BARWISE_WRITE_LOG and BARWISE_WRITE_ROOT are set. Unlike
 * the exit recorder it does NOT strip itself from NODE_OPTIONS: it wants every
 * descendant. It never writes to stdout or stderr and never changes what a
 * call returns or throws; anything it fails at, it skips.
 *
 * WHY THE CALL AND NOT THE TREE. `git status --porcelain` and a recursive
 * watcher both miss a probe written and removed inside one gate (barwise-w43's
 * shape). A call that is logged when it is made cannot be undone afterwards.
 *
 * Four details, each a failure when missed:
 *   - The log is opened once, with O_APPEND, and a line is one synchronous
 *     write, so concurrent processes' lines stay whole. Logging through the
 *     public appendFileSync recorded the log 15,074 times in the prototype.
 *   - `busy` is the re-entrancy flag: `appendFileSync` calls the public
 *     `writeFileSync`, `cpSync` the public `copyFileSync`, `truncateSync` the
 *     public `openSync`. It is sound only because the log write and the guarded
 *     call are synchronous. The cost is that user code run synchronously inside
 *     a wrapped call (a `cpSync` filter) is not logged.
 *   - Scope is "the resolved path lies under the real path of the root", not
 *     "not the temp directory": a TMPDIR inside the root counts, and a root
 *     under the temp directory (ci:local's worktree) does not exempt it. The
 *     final path component is not followed, so removing a symlink is a write.
 *   - `fs.promises.open` returns a FileHandle whose write, writeFile,
 *     appendFile and truncate never pass through a wrapped function; the open
 *     is logged when its flags include a write mode, and the drift test in
 *     write-recorder.test.mjs maps each FileHandle write method to that open.
 *
 * Unseen, by design (owner, 2026-11-09): writes by native children (git,
 * dprint) and by a node child started with a scrubbed environment.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const MARK = Symbol.for("barwise.write-recorder");
const logPath = process.env.BARWISE_WRITE_LOG;
const rootPath = process.env.BARWISE_WRITE_ROOT;

if (logPath && rootPath && !fs[MARK]) {
  try {
    install();
  } catch {
    // Never the observed command's problem. A recorder that cannot start is
    // caught by the matrix's canary, which requires a logged write.
  }
}

function install() {
  // Captured before anything is patched, so the recorder's own calls are
  // never the wrapped ones.
  const { openSync, writeSync, realpathSync, constants } = fs;
  const root = realpathSync(rootPath);
  const fd = openSync(logPath, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT, 0o600);
  const WRITE_BITS = constants.O_WRONLY | constants.O_RDWR | constants.O_CREAT | constants.O_APPEND
    | constants.O_TRUNC;

  /** An absolute, parent-resolved path, or null when `target` is not a path. */
  function resolved(target) {
    let p;
    if (typeof target === "string") p = target;
    else if (Buffer.isBuffer(target)) p = target.toString();
    else if (target instanceof URL && target.protocol === "file:") p = fileURLToPath(target);
    else return null; // a descriptor or a FileHandle: its open was logged
    p = resolve(p);
    let head = dirname(p);
    const tail = [basename(p)];
    for (;;) {
      try {
        return join(realpathSync(head), ...tail);
      } catch {
        const up = dirname(head);
        if (up === head) return p; // unresolvable: in scope, so a doubt is loud
        tail.unshift(basename(head));
        head = up;
      }
    }
  }

  const inScope = (p) => p === root || p.startsWith(root + sep);

  let busy = false;

  function record(op, targets) {
    for (const t of targets) {
      const p = resolved(t);
      if (p !== null && inScope(p)) {
        writeSync(fd, `${JSON.stringify({ pid: process.pid, op, path: p })}\n`);
      }
    }
  }

  // A callback in the flags slot (open(path, cb)) is neither: that is a read.
  const isWriteFlags = (flags) =>
    typeof flags === "number"
      ? (flags & WRITE_BITS) !== 0
      : typeof flags === "string" && /[wa+]/.test(flags);

  /**
   * Which arguments name a path that changes. `rename` changes both ends; for
   * copyFile, cp, symlink and link only the destination is written.
   */
  function wrap(owner, name, pick) {
    const original = owner[name];
    if (typeof original !== "function") return;
    const wrapper = function(...args) {
      if (busy) return original.apply(this, args);
      busy = true;
      try {
        try {
          record(name, pick(args));
        } catch {
          // skip: see the header
        }
        return original.apply(this, args);
      } finally {
        busy = false;
      }
    };
    Object.defineProperty(wrapper, "name", { value: name });
    wrapper[MARK] = true;
    owner[name] = wrapper;
  }

  const first = (a) => [a[0]];
  const second = (a) => [a[1]];
  const both = (a) => [a[0], a[1]];
  const SURFACE = {
    writeFile: first,
    appendFile: first,
    mkdir: first,
    mkdtemp: first,
    mkdtempDisposable: first,
    rm: first,
    rmdir: first,
    unlink: first,
    truncate: first,
    chmod: first,
    lchmod: first,
    chown: first,
    lchown: first,
    utimes: first,
    lutimes: first,
    rename: both,
    copyFile: second,
    cp: second,
    symlink: second,
    link: second,
  };
  for (const [base, pick] of Object.entries(SURFACE)) {
    wrap(fs, base, pick);
    wrap(fs, `${base}Sync`, pick);
    wrap(fsp, base, pick);
  }
  const opens = (a) => (isWriteFlags(a[1]) ? [a[0]] : []);
  wrap(fs, "open", opens);
  wrap(fs, "openSync", opens);
  wrap(fsp, "open", opens);
  wrap(fs, "createWriteStream", first);

  fs[MARK] = true;
  syncBuiltinESMExports();
}
