/**
 * Right inspector pane: contextual detail for the selected diagram
 * element, read from the positioned graph.
 */
import type {
  PositionedFactTypeNode,
  PositionedGraph,
  PositionedNode,
  PositionedObjectTypeNode,
} from "@barwise/diagram";

export interface InspectorProps {
  readonly node: PositionedNode | null;
  readonly graph: PositionedGraph | null;
}

export function Inspector(props: InspectorProps): JSX.Element {
  const { node, graph } = props;
  if (!node) {
    return (
      <div className="inspector-body inspector-empty">
        Select an element in the diagram to see its details.
      </div>
    );
  }
  if (node.kind === "object_type") {
    return <ObjectTypeDetail node={node} graph={graph} />;
  }
  if (node.kind === "fact_type") {
    return <FactTypeDetail node={node} />;
  }
  return (
    <div className="inspector-body">
      <Header kind="constraint" name="External constraint" />
      <Field label="Kind">{node.constraintKind.replace(/_/g, " ")}</Field>
      <Field label="Covered roles">{node.roleIds.length}</Field>
    </div>
  );
}

function ObjectTypeDetail(props: {
  node: PositionedObjectTypeNode;
  graph: PositionedGraph | null;
}): JSX.Element {
  const { node, graph } = props;
  const playsIn = graph
    ? graph.edges
      .filter((e) => e.sourceNodeId === node.id || e.targetNodeId === node.id)
      .map((e) => (e.sourceNodeId === node.id ? e.targetNodeId : e.sourceNodeId))
    : [];
  const factNames = new Map<string, string>();
  if (graph) {
    for (const id of playsIn) {
      const ft = graph.nodes.find(
        (n): n is PositionedFactTypeNode => n.id === id && n.kind === "fact_type",
      );
      if (ft) factNames.set(id, ft.name);
    }
  }
  return (
    <div className="inspector-body">
      <Header kind={node.objectTypeKind} name={node.name} />
      {node.referenceMode && <Field label="Reference mode">{node.referenceMode}</Field>}
      {node.aliases && node.aliases.length > 0 && (
        <Field label="Aliases">{node.aliases.join(", ")}</Field>
      )}
      {node.annotations && node.annotations.length > 0 && (
        <Field label="Annotations">
          {node.annotations.map((a, i) => <div key={i}>{a}</div>)}
        </Field>
      )}
      {factNames.size > 0 && (
        <Field label={`Plays roles in (${factNames.size})`}>
          {[...factNames.values()].map((n, i) => <div key={i}>{n}</div>)}
        </Field>
      )}
    </div>
  );
}

function FactTypeDetail(props: { node: PositionedFactTypeNode; }): JSX.Element {
  const { node } = props;
  const arity = node.roles.length;
  const arityLabel = arity === 1
    ? "unary"
    : arity === 2
    ? "binary"
    : arity === 3
    ? "ternary"
    : `${arity}-ary`;
  return (
    <div className="inspector-body">
      <Header kind="fact" name={node.name} />
      <Field label="Arity">{arityLabel}</Field>
      <Field label="Orientation">{node.orientation}</Field>
      {node.isObjectified && (
        <Field label="Objectified as">{node.objectifiedEntityName ?? node.name}</Field>
      )}
      {node.ringConstraint && <Field label="Ring constraint">{node.ringConstraint.label}</Field>}
      <Field label={`Roles (${arity})`}>
        {node.roles.map((r, i) => (
          <div key={r.roleId} className="inspector-role">
            <span className="inspector-role-idx">{i + 1}</span>
            <span className="inspector-role-name">{r.roleName || "(unnamed)"}</span>
            <span className="inspector-role-player">{r.playerName}</span>
            {r.isMandatory && <span className="inspector-tag">mand</span>}
            {r.hasUniqueness && <span className="inspector-tag">uniq</span>}
          </div>
        ))}
      </Field>
      {node.hasSpanningUniqueness && <Field label="Uniqueness">spanning all roles</Field>}
    </div>
  );
}

function Header(props: { kind: string; name: string; }): JSX.Element {
  return (
    <div className="inspector-header">
      <span className="inspector-name">{props.name}</span>
      <span className="inspector-kind">{props.kind}</span>
    </div>
  );
}

function Field(props: { label: string; children: React.ReactNode; }): JSX.Element {
  return (
    <div className="inspector-field">
      <div className="inspector-field-label">{props.label}</div>
      <div className="inspector-field-value">{props.children}</div>
    </div>
  );
}
