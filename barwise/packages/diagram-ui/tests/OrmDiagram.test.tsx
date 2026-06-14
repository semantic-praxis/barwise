/**
 * Tests for OrmDiagram's interactive-state rendering.
 *
 * renderDiagramSvg.test covers the static path; this covers the props the
 * static renderer always passes as null/0 -- selection, highlight dimming,
 * and live drag offset -- by rendering the pure component directly with
 * react-dom/server.
 */
import { generateDiagram } from "@barwise/diagram";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ModelBuilder } from "../../core/tests/helpers/ModelBuilder.js";
import { OrmDiagram } from "../src/OrmDiagram.js";

type DiagramModel = Parameters<typeof generateDiagram>[0];
const NONE: ReadonlySet<string> = new Set();

function twoEntityModel(): DiagramModel {
  return new ModelBuilder("M")
    .withEntityType("A", { referenceMode: "id" })
    .withEntityType("B", { referenceMode: "id" })
    .withBinaryFactType("A relates to B", {
      role1: { player: "A", name: "relates to" },
      role2: { player: "B", name: "is related to by" },
    })
    .build();
}

async function objectTypeNodeId(model: DiagramModel): Promise<{
  layout: Awaited<ReturnType<typeof generateDiagram>>["layout"];
  id: string;
}> {
  const { layout } = await generateDiagram(model);
  const id = layout.nodes.find((n) => n.kind === "object_type")!.id;
  return { layout, id };
}

describe("OrmDiagram interactive rendering", () => {
  it("draws a selection outline for the selected node", async () => {
    const { layout, id } = await objectTypeNodeId(twoEntityModel());
    const out = renderToStaticMarkup(
      <OrmDiagram
        graph={layout}
        ghostIds={NONE}
        selectedId={id}
        highlightIds={null}
        dragId={null}
        dragDx={0}
        dragDy={0}
      />,
    );
    // The selection rectangle uses COLOR_SELECTION.
    expect(out).toContain("#0a84ff");
  });

  it("dims nodes outside the highlight set", async () => {
    const { layout, id } = await objectTypeNodeId(twoEntityModel());
    const out = renderToStaticMarkup(
      <OrmDiagram
        graph={layout}
        ghostIds={NONE}
        selectedId={null}
        highlightIds={new Set([id])}
        dragId={null}
        dragDx={0}
        dragDy={0}
      />,
    );
    // Non-highlighted elements render at 0.15 opacity.
    expect(out).toContain("0.15");
  });

  it("applies a live translate to the dragged node", async () => {
    const { layout, id } = await objectTypeNodeId(twoEntityModel());
    const out = renderToStaticMarkup(
      <OrmDiagram
        graph={layout}
        ghostIds={NONE}
        selectedId={null}
        highlightIds={null}
        dragId={id}
        dragDx={10}
        dragDy={5}
      />,
    );
    expect(out).toContain("translate(10,5)");
  });
});
