#!/usr/bin/env node
// Schema-bump gate -- schema-versioning#shared-minor
// (docs/specs/adr-batch9-enforcers.spec.md, WS7).
//
// Decision 3 says the first additive change after a released version bumps
// `CURRENT_ORM_VERSION` and later ones share that bump. This gate holds the
// first half: if `orm-model.schema.json` differs from the one the latest
// released version shipped and `CURRENT_ORM_VERSION` still equals what that
// release wrote, the change went in without its bump. "Released" is a `v*`
// tag (owner, 2026-11-06); the moving `edge` pre-release is not one.
//
// The comparison ignores `description`, `title` and `$comment` when their
// value is a string: prose edits are not format changes. A property that is
// itself named `description` or `title` has an object value and is kept. It
// does not judge additive versus structural; the bump it asks for is
// whatever the spec's review chose.
//
// Reads the working tree for "now" (so a probe that edits
// `schemaVersion.ts` reaches it) and `git show <tag>:<path>` for "then".
//
// Exit 0 no finding, 1 the schema changed under an unchanged version, 2
// could not answer: a shallow clone (its tags and history are partial), no
// `v*` tag reachable from HEAD, or a file that would not read at the tag or
// here. A path that moved between the tag and now is a refusal, not a pass.
//
// Usage: node barwise/scripts/check-schema-bump.mjs

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { REPO_ROOT } from "./lib/tracked.mjs";

export const SCHEMA_PATH = "barwise/packages/core/schemas/orm-model.schema.json";
export const VERSION_PATH = "barwise/packages/core/src/serialization/schemaVersion.ts";

const ANNOTATIONS = new Set(["description", "title", "$comment"]);

/** The schema without its prose annotations, keys sorted so order is not a difference. */
export function normalizeSchema(node) {
  if (Array.isArray(node)) return node.map(normalizeSchema);
  if (node === null || typeof node !== "object") return node;
  const out = {};
  for (const key of Object.keys(node).sort()) {
    if (ANNOTATIONS.has(key) && typeof node[key] === "string") continue;
    out[key] = normalizeSchema(node[key]);
  }
  return out;
}

/** `CURRENT_ORM_VERSION`'s string literal, or undefined when the file declares none. */
export function currentVersionOf(text) {
  return /\bCURRENT_ORM_VERSION\s*(?::\s*[\w"'.]+\s*)?=\s*["']([^"']+)["']/.exec(text)?.[1];
}

/**
 * The finding, or undefined. Takes the four facts so the tests state them
 * without a repository.
 */
export function bumpFinding({ tag, tagSchema, tagVersion, schema, version }) {
  if (version !== tagVersion) return undefined;
  if (JSON.stringify(normalizeSchema(tagSchema)) === JSON.stringify(normalizeSchema(schema))) {
    return undefined;
  }
  return `${SCHEMA_PATH} differs from ${tag}'s (ignoring description, title and $comment), `
    + `but CURRENT_ORM_VERSION is still "${version}", the version ${tag} wrote.\n`
    + "  The first additive change after a release bumps the minor (schema-versioning decision 3).\n"
    + `  Fix: bump CURRENT_ORM_VERSION and its step in ${VERSION_PATH}, or revert the schema change.`;
}

function refuse(message) {
  process.stderr.write(`check-schema-bump: cannot answer: ${message}\n`);
  process.exit(2);
}

function main() {
  const git = (args) => {
    try {
      return execFileSync("git", args, {
        cwd: REPO_ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 64 * 1024 * 1024,
      });
    } catch (error) {
      const first = error instanceof Error ? error.message.split("\n")[0] : String(error);
      return refuse(`git ${args.join(" ")} failed (${first})`);
    }
  };

  if (git(["rev-parse", "--is-shallow-repository"]).trim() !== "false") {
    refuse(
      "this is a shallow clone, so the latest v* tag reachable from HEAD cannot be trusted.\n"
        + "  Fix: git fetch --unshallow --tags",
    );
  }

  let tag;
  try {
    tag = execFileSync("git", ["describe", "--tags", "--abbrev=0", "--match", "v*", "HEAD"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    tag = "";
  }
  if (tag === "") {
    refuse(
      "no v* tag is reachable from HEAD, so there is no release to compare with. Fix: git fetch --tags",
    );
  }

  const show = (path) => git(["show", `${tag}:${path}`]);
  const read = (path) => {
    try {
      return readFileSync(resolve(REPO_ROOT, path), "utf8");
    } catch (error) {
      return refuse(`could not read ${path} (${error.code ?? error.message})`);
    }
  };
  const parse = (text, where) => {
    try {
      return JSON.parse(text);
    } catch {
      return refuse(`${where} is not JSON`);
    }
  };

  const tagVersion = currentVersionOf(show(VERSION_PATH));
  const version = currentVersionOf(read(VERSION_PATH));
  if (tagVersion === undefined) refuse(`${tag}:${VERSION_PATH} declares no CURRENT_ORM_VERSION`);
  if (version === undefined) refuse(`${VERSION_PATH} declares no CURRENT_ORM_VERSION`);

  const finding = bumpFinding({
    tag,
    tagSchema: parse(show(SCHEMA_PATH), `${tag}:${SCHEMA_PATH}`),
    tagVersion,
    schema: parse(read(SCHEMA_PATH), SCHEMA_PATH),
    version,
  });
  if (finding !== undefined) {
    process.stderr.write(`check-schema-bump: ${finding}\n`);
    process.exit(1);
  }
  console.log(
    `check-schema-bump: ${SCHEMA_PATH} against ${tag} (wrote ${tagVersion}; now ${version}). OK`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
