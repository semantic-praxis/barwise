/**
 * Output-bounding helper for MCP tool results.
 *
 * Tool output under INLINE_BYTE_LIMIT is returned inline unchanged.
 * Larger output is written to a spill file and the tool returns a short
 * preview plus the file path, so a single call cannot flood an AI
 * agent's context window with a megabyte of SVG or a 100KB OpenAPI spec.
 */

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { isFilePath } from "./resolve.js";

/** Default inline byte limit; overridable via BARWISE_MCP_INLINE_LIMIT. */
export const INLINE_BYTE_LIMIT = 8192;

/** Preview lines inlined when output spills to a file. */
const DEFAULT_PREVIEW_LINES = 40;

/** Hard cap on the inlined preview, in case lines are very long. */
const PREVIEW_BYTE_CAP = 2048;

export interface BoundedTextOptions {
  /** Short kind label, used in the spill filename and preview header. */
  kind: string;
  /**
   * Originating model reference (file path or inline YAML). Used to
   * locate the spill directory next to the model file.
   */
  source?: string;
  /** Explicit destination for the full content. Overrides the cache dir. */
  outputPath?: string;
  /** Preview lines inlined when spilling. Default 40. */
  previewLines?: number;
  /** Spill file extension, without the dot. Default "txt". */
  extension?: string;
  /** Override the inline byte limit (mainly for tests). */
  limit?: number;
}

export interface TextResult {
  content: Array<{ type: "text"; text: string; }>;
}

/**
 * Return `text` as an MCP text result, spilling to a file when it
 * exceeds the inline byte limit.
 */
export function boundedTextResult(
  text: string,
  opts: BoundedTextOptions,
): TextResult {
  const limit = opts.limit ?? resolveInlineLimit();
  const bytes = Buffer.byteLength(text, "utf8");

  if (bytes <= limit) {
    return textResult(text);
  }

  const spillPath = writeSpillFile(text, opts);
  const lines = text.split("\n");
  const previewLines = opts.previewLines ?? DEFAULT_PREVIEW_LINES;
  const shown = Math.min(previewLines, lines.length);

  let preview = lines.slice(0, previewLines).join("\n");
  if (Buffer.byteLength(preview, "utf8") > PREVIEW_BYTE_CAP) {
    preview = `${preview.slice(0, PREVIEW_BYTE_CAP)} [...]`;
  }

  const remaining = lines.length - shown;
  const header = [
    `[barwise] Output is ${formatBytes(bytes)} (${lines.length} lines) `
    + "-- too large to return inline.",
    `Full content written to: ${spillPath}`,
    `Showing the first ${shown} line(s). Open the file above with your `
    + "Read tool only if you need the rest.",
    "",
    "----- preview -----",
  ].join("\n");
  const footer = remaining > 0
    ? `----- end of preview (${remaining} more line(s) in the file) -----`
    : "----- end of preview -----";

  return textResult(`${header}\n${preview}\n${footer}`);
}

function resolveInlineLimit(): number {
  const env = process.env.BARWISE_MCP_INLINE_LIMIT;
  if (env !== undefined) {
    const n = Number.parseInt(env, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return INLINE_BYTE_LIMIT;
}

function writeSpillFile(text: string, opts: BoundedTextOptions): string {
  let target: string;
  if (opts.outputPath) {
    target = resolve(opts.outputPath);
  } else {
    const ext = opts.extension ?? "txt";
    const hash = createHash("sha1").update(text).digest("hex").slice(0, 8);
    target = join(spillDir(opts.source), `${opts.kind}-${hash}.${ext}`);
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text, "utf8");
  return target;
}

/**
 * Resolve the spill cache directory. When the source is a file path,
 * the cache sits next to it; otherwise it falls back to the cwd.
 */
function spillDir(source?: string): string {
  let base = process.cwd();
  if (source) {
    const trimmed = source.trim();
    if (isFilePath(trimmed)) {
      base = dirname(resolve(trimmed));
    }
  }
  return join(base, ".barwise", "mcp-cache");
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function textResult(text: string): TextResult {
  return { content: [{ type: "text" as const, text }] };
}
