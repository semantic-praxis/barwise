import { isMap, isScalar, LineCounter, parseDocument, visit } from "yaml";

/**
 * Position in a text document (0-indexed, LSP-compatible).
 */
export interface SourcePosition {
  readonly line: number;
  readonly character: number;
}

/**
 * Maps ORM element IDs (UUIDs) to their source positions in a YAML
 * document. Used by DiagnosticsProvider to resolve validation
 * diagnostics to the correct line in the editor.
 *
 * Uses the `yaml` package's parseDocument API to preserve source
 * ranges on AST nodes, then walks the tree to find all map nodes
 * with an `id` field and records their start positions.
 */
export class YamlSourceMap {
  private readonly positions = new Map<string, SourcePosition>();
  /** Where the node at a document path starts; see `getPathPosition`. */
  private pathPosition: (path: readonly (string | number)[]) => SourcePosition | undefined = () =>
    undefined;

  constructor(yamlText: string) {
    this.build(yamlText);
  }

  /**
   * Look up the source position for a model element by its ID.
   * Returns undefined if the ID is not found in the source map.
   */
  getPosition(elementId: string): SourcePosition | undefined {
    return this.positions.get(elementId);
  }

  /**
   * The source position of the node at a document path, such as
   * `["model", "constraints", 0]`: for an element the file gives no id,
   * which `getPosition` cannot find.
   */
  getPathPosition(path: readonly (string | number)[]): SourcePosition | undefined {
    return this.pathPosition(path);
  }

  /**
   * Returns the number of mapped element IDs.
   */
  get size(): number {
    return this.positions.size;
  }

  private build(yamlText: string): void {
    const lineCounter = new LineCounter();

    let doc;
    try {
      doc = parseDocument(yamlText, { lineCounter });
    } catch {
      // If YAML is unparseable, the source map is simply empty.
      // DiagnosticsProvider will fall back to line 0.
      return;
    }

    if (!doc.contents) return;

    const parsed = doc;
    this.pathPosition = (path) => {
      const node = parsed.getIn(path, true) as { range?: [number, number, number]; } | undefined;
      if (!node?.range) return undefined;
      const pos = lineCounter.linePos(node.range[0]);
      return { line: pos.line - 1, character: pos.col - 1 };
    };

    const positions = this.positions;

    visit(doc, {
      Map(_key, node) {
        // Look for map nodes that contain an "id" key.
        // These correspond to ORM elements (ObjectType, FactType,
        // Role, SubtypeFact, Population, etc.).
        if (!isMap(node)) return;

        let elementId: string | undefined;

        for (const pair of node.items) {
          if (
            isScalar(pair.key)
            && pair.key.value === "id"
            && isScalar(pair.value)
          ) {
            elementId = String(pair.value.value);
            break;
          }
        }

        if (!elementId) return;

        // Use the map node's range start (the beginning of the
        // element block, e.g., "- id: ..." or "  id: ...").
        const range = node.range;
        if (!range) return;

        // lineCounter.linePos returns 1-indexed; LSP needs 0-indexed.
        const pos = lineCounter.linePos(range[0]);
        positions.set(elementId, {
          line: pos.line - 1,
          character: pos.col - 1,
        });
      },
    });
  }
}
