/**
 * Unit tests for the pure source-resolution policy used by the barwise
 * Language Model Tools. No VS Code runtime: the policy is a function of
 * the editor/diagram context the glue gathers.
 */
import { describe, expect, it } from "vitest";
import { resolveOpenModel } from "../../src/mcp/resolveModelSource.js";

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
