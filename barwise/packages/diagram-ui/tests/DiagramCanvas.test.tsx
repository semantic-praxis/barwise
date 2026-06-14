// @vitest-environment jsdom
/**
 * Interaction tests for DiagramCanvas (the pan / zoom / drag wrapper).
 *
 * Runs in jsdom: it drives mouse events through the canvas and asserts
 * the callbacks the host (DiagramPanel / DiagramSession) relies on.
 * Layout-dependent behaviour (fit, zoom math) is not asserted -- jsdom
 * reports zero element dimensions -- only that the imperative handle is
 * wired.
 */
import { generateDiagram } from "@barwise/diagram";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelBuilder } from "../../core/tests/helpers/ModelBuilder.js";
import { DiagramCanvas, type DiagramCanvasHandle } from "../src/DiagramCanvas.js";

afterEach(cleanup);

type DiagramModel = Parameters<typeof generateDiagram>[0];

function model(): DiagramModel {
  return new ModelBuilder("M")
    .withEntityType("A", { referenceMode: "id" })
    .withEntityType("B", { referenceMode: "id" })
    .withBinaryFactType("A relates to B", {
      role1: { player: "A", name: "relates to" },
      role2: { player: "B", name: "is related to by" },
    })
    .build();
}

async function renderCanvas(handlers: {
  onSelect?: (id: string | null, kind: string | null) => void;
  onNodeMoved?: (id: string, x: number, y: number) => void;
  onToggleOrientation?: (id: string) => void;
}) {
  const { layout } = await generateDiagram(model());
  const ref = createRef<DiagramCanvasHandle>();
  const { container } = render(
    <DiagramCanvas
      ref={ref}
      graph={layout}
      ghostIds={new Set()}
      selectedId={null}
      highlightIds={null}
      resetNonce={0}
      onSelect={handlers.onSelect ?? (() => {})}
      onNodeMoved={handlers.onNodeMoved ?? (() => {})}
      onToggleOrientation={handlers.onToggleOrientation ?? (() => {})}
      onSaveLayout={() => {}}
    />,
  );
  return { container, ref };
}

describe("DiagramCanvas interactions", () => {
  it("selects a node on click (mousedown then mouseup with no drag)", async () => {
    const onSelect = vi.fn();
    const { container } = await renderCanvas({ onSelect });

    const node = container.querySelector('g[data-kind="object_type"]')!;
    const id = node.getAttribute("data-id");

    fireEvent.mouseDown(node, { button: 0, clientX: 50, clientY: 50 });
    fireEvent.mouseUp(window);

    expect(onSelect).toHaveBeenCalledWith(id, "object_type");
  });

  it("clears the selection on a background click", async () => {
    const onSelect = vi.fn();
    const { container } = await renderCanvas({ onSelect });

    const svg = container.querySelector("svg")!;
    fireEvent.mouseDown(svg, { button: 0, clientX: 5, clientY: 5 });

    expect(onSelect).toHaveBeenCalledWith(null, null);
  });

  it("reports a node move on drag (mousedown, move past threshold, mouseup)", async () => {
    const onNodeMoved = vi.fn();
    const { container } = await renderCanvas({ onNodeMoved });

    const node = container.querySelector('g[data-kind="object_type"]')!;
    const id = node.getAttribute("data-id");

    fireEvent.mouseDown(node, { button: 0, clientX: 50, clientY: 50 });
    fireEvent.mouseMove(window, { clientX: 90, clientY: 80 });
    fireEvent.mouseUp(window);

    expect(onNodeMoved).toHaveBeenCalledWith(id, expect.any(Number), expect.any(Number));
  });

  it("toggles fact type orientation on double-click", async () => {
    const onToggleOrientation = vi.fn();
    const { container } = await renderCanvas({ onToggleOrientation });

    const factNode = container.querySelector('g[data-kind="fact_type"]')!;
    const id = factNode.getAttribute("data-id");

    fireEvent.doubleClick(factNode);

    expect(onToggleOrientation).toHaveBeenCalledWith(id);
  });

  it("exposes an imperative fit / zoom handle", async () => {
    const { ref } = await renderCanvas({});

    expect(typeof ref.current?.fit).toBe("function");
    expect(typeof ref.current?.zoomIn).toBe("function");
    expect(typeof ref.current?.zoomOut).toBe("function");
  });
});
