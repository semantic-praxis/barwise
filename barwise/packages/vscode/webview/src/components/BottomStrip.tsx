/** Bottom strip: model statistics and the backing file name. */
import type { PositionedGraph } from "@barwise/diagram";
import type { DiagramMeta } from "../../../src/diagram/protocol";

export interface BottomStripProps {
  readonly graph: PositionedGraph | null;
  readonly meta: DiagramMeta | null;
}

export function BottomStrip(props: BottomStripProps): JSX.Element {
  const { graph, meta } = props;
  let entities = 0;
  let values = 0;
  let facts = 0;
  let constraints = 0;
  if (graph) {
    for (const n of graph.nodes) {
      if (n.kind === "object_type") {
        if (n.objectTypeKind === "entity") entities++;
        else values++;
      } else if (n.kind === "fact_type") {
        facts++;
      } else {
        constraints++;
      }
    }
  }
  return (
    <div className="bottomstrip">
      <Stat value={entities} label="entity types" />
      <Stat value={values} label="value types" />
      <Stat value={facts} label="fact types" />
      {constraints > 0 && <Stat value={constraints} label="constraints" />}
      <div className="bottomstrip-spacer" />
      {meta?.hasUnsavedChanges && <span className="bottomstrip-dirty">Unsaved layout</span>}
      {meta?.fileName && <span className="bottomstrip-file">{meta.fileName}</span>}
    </div>
  );
}

function Stat(props: { value: number; label: string; }): JSX.Element {
  return (
    <span className="bottomstrip-stat">
      <strong>{props.value}</strong> {props.label}
    </span>
  );
}
