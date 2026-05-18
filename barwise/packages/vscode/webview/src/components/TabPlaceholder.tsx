/**
 * Placeholder for the alternate tabs. These become thin views over
 * `@barwise/core` (verbalizer, serializer, DDL exporter, populations)
 * in Phase 3.
 */
import type { TabKey } from "./TopBar";

const LABELS: Record<Exclude<TabKey, "diagram">, string> = {
  verbalize: "Verbalization",
  facts: "Fact Population",
  yaml: "YAML",
  ddl: "SQL DDL",
};

export function TabPlaceholder(props: { tab: TabKey; }): JSX.Element {
  const label = props.tab === "diagram" ? "Diagram" : LABELS[props.tab];
  return (
    <div className="empty-state">
      <div className="empty-state-title">{label}</div>
      <div className="empty-state-sub">
        This view arrives in Phase 3, wired to @barwise/core.
      </div>
    </div>
  );
}
