/**
 * Server entry: headless SVG rendering for Node consumers (CLI, MCP).
 *
 * Kept on a separate `@barwise/diagram-ui/server` subpath so the webview
 * barrel never pulls `react-dom/server` into the browser bundle.
 */
export { renderDiagramSvg, type RenderDiagramSvgOptions } from "./renderDiagramSvg.js";
