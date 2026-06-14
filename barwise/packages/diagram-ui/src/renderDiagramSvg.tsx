/**
 * Headless static SVG rendering of a positioned ORM graph.
 *
 * Renders the same `OrmDiagram` component the interactive canvas uses,
 * to a static SVG string via `react-dom/server`. This is the single
 * renderer the CLI and MCP use, replacing the retired `SvgRenderer` in
 * `@barwise/diagram`.
 */
import type { PositionedGraph } from "@barwise/diagram";
import * as t from "@barwise/diagram/theme";
import { renderToStaticMarkup } from "react-dom/server";
import { OrmDiagram } from "./OrmDiagram.js";

export interface RenderDiagramSvgOptions {
  /** Node ids to render as dimmed ghost (preview) nodes. */
  readonly ghostNodeIds?: ReadonlySet<string>;
}

const PADDING = 20;
const NO_GHOSTS: ReadonlySet<string> = new Set();

/** Render a positioned graph to a complete, standalone SVG string. */
export function renderDiagramSvg(
  graph: PositionedGraph,
  options?: RenderDiagramSvgOptions,
): string {
  const width = graph.width + PADDING * 2;
  const height = graph.height + PADDING * 2;
  const viewBox = `${graph.originX - PADDING} ${graph.originY - PADDING} ${width} ${height}`;
  return renderToStaticMarkup(
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={width}
      height={height}
      viewBox={viewBox}
      style={{ fontFamily: t.FONT_FAMILY, background: "#fafafa" }}
    >
      <OrmDiagram
        graph={graph}
        ghostIds={options?.ghostNodeIds ?? NO_GHOSTS}
        selectedId={null}
        highlightIds={null}
        dragId={null}
        dragDx={0}
        dragDy={0}
      />
    </svg>,
  );
}
