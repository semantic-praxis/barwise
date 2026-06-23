/**
 * Tests for source resolution: the string heuristic, the explicit file-object
 * form ({ path }, { content }, { path, content }), project detection, and the
 * spill-path accessor.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  isProjectSource,
  resolveModels,
  resolveSource,
  sourcePath,
} from "../../src/workspace/resolve.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtures = resolve(__dirname, "../fixtures");

const simplePath = `${fixtures}/simple.orm.yaml`;
const invalidPath = `${fixtures}/invalid.orm.yaml`;
const projectPath = `${fixtures}/project/project.orm-project.yaml`;
const simpleYaml = readFileSync(simplePath, "utf-8");

describe("resolveSource", () => {
  it("resolves a string file path (back-compat)", () => {
    expect(resolveSource(simplePath).name).toBe("Simple Test");
  });

  it("resolves an inline YAML string (back-compat)", () => {
    expect(resolveSource(simpleYaml).name).toBe("Simple Test");
  });

  it("resolves a { path } object by reading the file", () => {
    expect(resolveSource({ path: simplePath }).name).toBe("Simple Test");
  });

  it("resolves a { content } object as inline YAML", () => {
    expect(resolveSource({ content: simpleYaml }).name).toBe("Simple Test");
  });

  it("parses content and ignores the path's file in the combined form", () => {
    // path points at a model that would throw if read; content is valid.
    // Success proves the file at `path` is never read when content is given.
    const model = resolveSource({ path: invalidPath, content: simpleYaml });
    expect(model.name).toBe("Simple Test");
  });

  it("throws on an object with neither path nor content", () => {
    expect(() => resolveSource({})).toThrow(/path.*content/i);
  });
});

describe("sourcePath", () => {
  it("returns the path for a string path", () => {
    expect(sourcePath(simplePath)).toBe(simplePath);
  });

  it("returns undefined for inline YAML", () => {
    expect(sourcePath(simpleYaml)).toBeUndefined();
  });

  it("returns the path for { path } and { path, content }", () => {
    expect(sourcePath({ path: simplePath })).toBe(simplePath);
    expect(sourcePath({ path: simplePath, content: simpleYaml })).toBe(simplePath);
  });

  it("returns undefined for { content }", () => {
    expect(sourcePath({ content: simpleYaml })).toBeUndefined();
  });
});

describe("isProjectSource", () => {
  it("is true for a manifest path (string or object)", () => {
    expect(isProjectSource(projectPath)).toBe(true);
    expect(isProjectSource({ path: projectPath })).toBe(true);
  });

  it("is false for a model path and inline content", () => {
    expect(isProjectSource(simplePath)).toBe(false);
    expect(isProjectSource({ content: simpleYaml })).toBe(false);
  });
});

describe("resolveModels", () => {
  it("resolves a single model to one unlabelled entry (object form)", () => {
    const { resolved } = resolveModels({ content: simpleYaml });
    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.context).toBeUndefined();
  });

  it("resolves a project manifest path to per-domain entries", () => {
    const { resolved } = resolveModels(projectPath);
    expect(resolved.map((r) => r.context).sort()).toEqual(["billing", "crm"]);
  });

  it("throws a clear error for a manifest given as inline content", () => {
    const manifestYaml = readFileSync(projectPath, "utf-8");
    expect(() => resolveModels({ content: manifestYaml })).toThrow(
      /manifest.*must be given as a path/i,
    );
  });
});
