/**
 * Direct unit tests for the file I/O helpers' non-ENOENT error paths.
 * Every command test drives the "file not found" branch; a directory
 * passed where a file is expected exercises the other one (EISDIR),
 * which `loadModel` and `readFile` both re-wrap with a different
 * message.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadModel, readFile } from "../../src/workspace/io.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "barwise-io-test-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("loadModel", () => {
  it("wraps a non-ENOENT read failure with the underlying message", () => {
    expect(() => loadModel(dir)).toThrow(/Cannot read file/);
  });
});

describe("readFile", () => {
  it("wraps a non-ENOENT read failure with the underlying message", () => {
    expect(() => readFile(dir)).toThrow(/Cannot read file/);
  });
});
