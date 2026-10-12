/**
 * Unit tests for the pure source-resolution policy used by the barwise
 * Language Model Tools. No VS Code runtime: the policy is a function of
 * the editor/diagram context the glue gathers.
 */
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  openModelSource,
  resolveOpenModel,
  resolveWriteDir,
} from "../../src/mcp/resolveModelSource.js";

describe("resolveOpenModel", () => {
  it("prefers a chat-referenced model above everything else", () => {
    const resolved = resolveOpenModel({
      referencedOrmFiles: ["/attached.orm.yaml"],
      activeOrmFile: "/a.orm.yaml",
      diagramModelPath: "/b.orm.yaml",
      visibleOrmFiles: ["/c.orm.yaml"],
    });
    expect(resolved).toBe("/attached.orm.yaml");
  });

  it("prefers the focused .orm.yaml editor", () => {
    const resolved = resolveOpenModel({
      activeOrmFile: "/a.orm.yaml",
      diagramModelPath: "/b.orm.yaml",
      visibleOrmFiles: ["/c.orm.yaml"],
    });
    expect(resolved).toBe("/a.orm.yaml");
  });

  it("falls back to the open diagram's model when no editor is focused", () => {
    // The reported bug: Show Diagram makes the webview the active panel,
    // so there is no active text editor to fall back to.
    const resolved = resolveOpenModel({
      diagramModelPath: "/clinic-appointments.orm.yaml",
      visibleOrmFiles: [],
    });
    expect(resolved).toBe("/clinic-appointments.orm.yaml");
  });

  it("falls back to a visible editor when nothing else applies", () => {
    const resolved = resolveOpenModel({ visibleOrmFiles: ["/v.orm.yaml"] });
    expect(resolved).toBe("/v.orm.yaml");
  });

  it("ranks the diagram model above visible editors", () => {
    const resolved = resolveOpenModel({
      diagramModelPath: "/d.orm.yaml",
      visibleOrmFiles: ["/v.orm.yaml"],
    });
    expect(resolved).toBe("/d.orm.yaml");
  });

  it("returns undefined when no model is open", () => {
    expect(resolveOpenModel({})).toBeUndefined();
    expect(resolveOpenModel({ visibleOrmFiles: [] })).toBeUndefined();
  });
});

describe("openModelSource", () => {
  it("returns the live buffer as { path, content } when the model is open as text", () => {
    const result = openModelSource(
      "/a.orm.yaml",
      (p) => (p === "/a.orm.yaml" ? "name: live edits" : undefined),
    );
    // The unsaved editor buffer is what the tool acts on, not the disk copy.
    expect(result).toEqual({ path: "/a.orm.yaml", content: "name: live edits" });
  });

  it("returns just { path } when the model is not open as text (e.g. diagram-only)", () => {
    const result = openModelSource("/d.orm.yaml", () => undefined);
    expect(result).toEqual({ path: "/d.orm.yaml" });
  });

  it("returns undefined when there is no resolved path", () => {
    expect(openModelSource(undefined, () => "ignored")).toBeUndefined();
  });
});

describe("resolveWriteDir", () => {
  // The extension host's cwd is not the workspace: a relative outDir
  // resolved against it writes the project somewhere nobody chose.
  it("resolves a relative directory against the workspace folder", () => {
    expect(resolveWriteDir("models/auction-project", "/work/repo"))
      .toBe(join("/work/repo", "models/auction-project"));
  });

  it("keeps an absolute directory as given", () => {
    expect(resolveWriteDir("/elsewhere/project", "/work/repo")).toBe("/elsewhere/project");
  });

  it("refuses a relative directory when no workspace folder is open", () => {
    expect(() => resolveWriteDir("project", undefined)).toThrow(/no workspace folder/);
  });
});
