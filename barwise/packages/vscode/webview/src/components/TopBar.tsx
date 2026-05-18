/** Top bar: model name and the view tabs. */

export type TabKey = "diagram" | "verbalize" | "facts" | "yaml" | "ddl";

const TABS: ReadonlyArray<{ key: TabKey; label: string; }> = [
  { key: "diagram", label: "Diagram" },
  { key: "verbalize", label: "Verbalization" },
  { key: "facts", label: "Fact Population" },
  { key: "yaml", label: "YAML" },
  { key: "ddl", label: "SQL DDL" },
];

export interface TopBarProps {
  readonly modelName: string;
  readonly activeTab: TabKey;
  readonly onTabChange: (tab: TabKey) => void;
}

export function TopBar(props: TopBarProps): JSX.Element {
  const { modelName, activeTab, onTabChange } = props;
  return (
    <div className="topbar">
      <div className="topbar-brand">
        <span className="topbar-title">Barwise</span>
        <span className="topbar-sep">/</span>
        <span className="topbar-model">{modelName}</span>
        <span className="topbar-badge">ORM 2</span>
      </div>
      <div className="topbar-tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={"topbar-tab" + (t.key === activeTab ? " active" : "")}
            onClick={() => onTabChange(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="topbar-spacer" />
    </div>
  );
}
