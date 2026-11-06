/**
 * scripts/install-uv.sh (python-uv-widened WS4; python-from-the-lockfile
 * decision 5). The installer runs for real, by bash, on a PATH of
 * stand-ins and links to the tools it uses: never /usr/bin, where a real
 * uv or curl would answer for the stand-in. No test touches the network.
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPTS = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const INSTALLER = join(SCRIPTS, "install-uv.sh");
const VERSION = /^VERSION="([^"]+)"$/m.exec(readFileSync(INSTALLER, "utf8"))[1];
const TARGET = "x86_64-unknown-linux-gnu";

/** The environment without git's location variables, as credential-handling's. */
function cleanEnv(extra = {}) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")),
  );
  return { ...env, ...extra };
}

function tempDir(t, prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A directory of links to exactly the tools named, found on the current PATH. */
function toolDir(t, tools) {
  const dir = tempDir(t, "barwise-tools-");
  for (const tool of tools) {
    const found = spawnSync("sh", ["-c", `command -v ${tool}`], { encoding: "utf8" }).stdout.trim();
    if (!found.startsWith("/")) throw new Error(`this test needs ${tool} on PATH`);
    symlinkSync(found, join(dir, tool));
  }
  return dir;
}

function exe(path, body) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
}

/** A uv stand-in that answers `--version` as the real one does. */
const uvAt = (version) => `[ "$1" = --version ] && echo "uv ${version} (${TARGET})"`;

/**
 * Stand-ins for the platform and the download: uname reports Linux x86_64,
 * so the target and digest are fixed whatever runs the test; curl records
 * that it ran and writes `served` (a path to copy, or junk when null).
 */
function standIns(t, { served = null, sha256sum = null } = {}) {
  const bin = tempDir(t, "barwise-uv-inst-");
  exe(join(bin, "uname"), `case "$1" in -s) echo Linux ;; -m) echo x86_64 ;; esac`);
  const write = served ? `cp "${served}" "$1"` : `echo junk > "$1"`;
  exe(
    join(bin, "curl"),
    `while [ $# -gt 0 ]; do if [ "$1" = -o ]; then shift; ${write}; fi; shift; done\necho ran > "${bin}/curl-ran"`,
  );
  if (sha256sum) exe(join(bin, "sha256sum"), sha256sum);
  return bin;
}

function install(t, bin, target, tools) {
  return spawnSync("/bin/bash", [INSTALLER, target], {
    encoding: "utf8",
    env: cleanEnv({ PATH: `${bin}:${toolDir(t, tools)}` }),
  });
}

const TOOLS = ["mkdir", "mktemp", "sha256sum", "cut", "install", "rm", "cp"];

test("the installer checks the digest before it unpacks anything [adr:python-from-the-lockfile#uv-bootstrap]", (t) => {
  const bin = standIns(t);
  exe(join(bin, "tar"), `echo ran > "${bin}/tar-ran"`);
  const target = tempDir(t, "barwise-uv-to-");
  const r = install(t, bin, target, TOOLS);
  assert.ok(existsSync(join(bin, "curl-ran")), `the installer reached the download:\n${r.stderr}`);
  assert.equal(r.status, 2, `${r.stdout}${r.stderr}`);
  assert.match(r.stderr, /CHECKSUM MISMATCH for uv-x86_64-unknown-linux-gnu\.tar\.gz/);
  assert.ok(
    !existsSync(join(bin, "tar-ran")),
    "nothing was unpacked before the digest was checked",
  );
  assert.ok(!existsSync(join(target, "uv")), "nothing was installed");
});

test("a uv in BIN_DIR already at the pin is left alone, and nothing is downloaded", (t) => {
  const bin = standIns(t);
  const target = tempDir(t, "barwise-uv-to-");
  exe(join(target, "uv"), uvAt(VERSION));
  const r = install(t, bin, target, TOOLS);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, new RegExp(`${VERSION.replace(/\./g, "\\.")} already present`));
  assert.ok(!existsSync(join(bin, "curl-ran")), "downloaded with the pin already in place");
});

test("a uv in BIN_DIR on another version is replaced: the download runs [adr:python-from-the-lockfile#uv-bootstrap]", (t) => {
  // Presence is read from BIN_DIR, never PATH: a uv at the pin earlier on
  // PATH must not stop the cached older one in BIN_DIR being replaced.
  const bin = standIns(t);
  exe(join(bin, "uv"), uvAt(VERSION));
  const target = tempDir(t, "barwise-uv-to-");
  exe(join(target, "uv"), uvAt("0.11.32"));
  const r = install(t, bin, target, TOOLS);
  assert.match(r.stderr, /uv 0\.11\.32 .*pin is 0\.12\.7; installing the pin/);
  assert.ok(existsSync(join(bin, "curl-ran")), `the older uv was kept:\n${r.stderr}`);
  assert.equal(r.status, 2, "the junk download still fails its digest");
});

/**
 * A release-shaped tarball holding uv-<target>/uv (answering `version`)
 * and uv-<target>/uvx. No crafted tarball can match the pinned digest, so
 * these tests stand in sha256sum too: what they test is what happens
 * after verification, which the test above holds separately.
 */
function release(t, version) {
  const dir = tempDir(t, "barwise-uv-rel-");
  exe(join(dir, `uv-${TARGET}`, "uv"), uvAt(version));
  exe(join(dir, `uv-${TARGET}`, "uvx"), "exit 0");
  const tarball = join(dir, "release.tar.gz");
  execFileSync("tar", ["-czf", tarball, "-C", dir, `uv-${TARGET}`]);
  return tarball;
}

test("installing puts only uv in BIN_DIR, removes a stale uvx, and reads the pin back", (t) => {
  const bin = standIns(t, { served: release(t, VERSION), sha256sum: "cat >/dev/null; exit 0" });
  const target = tempDir(t, "barwise-uv-to-");
  exe(join(target, "uv"), uvAt("0.11.32"));
  exe(join(target, "uvx"), "exit 0");
  const r = install(t, bin, target, [...TOOLS.filter((x) => x !== "sha256sum"), "tar", "gzip"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, new RegExp(`installed uv ${VERSION.replace(/\./g, "\\.")} `));
  assert.match(
    execFileSync(join(target, "uv"), ["--version"], { encoding: "utf8" }),
    /uv 0\.12\.7/,
  );
  assert.ok(!existsSync(join(target, "uvx")), "uvx is banned (decision 2) and must be removed");
});

test("an installed uv that does not report the pin is a refusal, not a success", (t) => {
  const bin = standIns(t, { served: release(t, "0.12.6"), sha256sum: "cat >/dev/null; exit 0" });
  const target = tempDir(t, "barwise-uv-to-");
  const r = install(t, bin, target, [...TOOLS.filter((x) => x !== "sha256sum"), "tar", "gzip"]);
  assert.equal(r.status, 2, `${r.stdout}${r.stderr}`);
  assert.match(r.stderr, /reports uv 0\.12\.6 .*after installing 0\.12\.7/);
  assert.doesNotMatch(r.stdout, /installed/);
});
