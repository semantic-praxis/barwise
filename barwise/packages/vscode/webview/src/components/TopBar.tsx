/** Top bar: model name, view tabs, the Views menu, and the palette. */
import { ViewsMenu } from "./ViewsMenu";

export type TabKey = "diagram" | "verbalize" | "facts" | "yaml" | "ddl";

const TABS: ReadonlyArray<{ key: TabKey; label: string; }> = [
  { key: "diagram", label: "Diagram" },
  { key: "verbalize", label: "Verbalization" },
  { key: "facts", label: "Fact Population" },
  { key: "yaml", label: "YAML" },
  { key: "ddl", label: "SQL DDL" },
];

const IS_MAC = typeof navigator !== "undefined" && /Mac/i.test(navigator.userAgent);
const PALETTE_HINT = IS_MAC ? "⌘K" : "Ctrl+K";

export interface TopBarProps {
  readonly modelName: string;
  readonly activeTab: TabKey;
  readonly onTabChange: (tab: TabKey) => void;
  readonly availableViews: readonly string[];
  readonly activeView: string | null;
  readonly onLoadView: (name: string) => void;
  readonly onSaveView: () => void;
  readonly onShowFull: () => void;
  readonly onOpenPalette: () => void;
}

export function TopBar(props: TopBarProps): JSX.Element {
  const {
    modelName,
    activeTab,
    onTabChange,
    availableViews,
    activeView,
    onLoadView,
    onSaveView,
    onShowFull,
    onOpenPalette,
  } = props;
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
            type="button"
            key={t.key}
            className={"topbar-tab" + (t.key === activeTab ? " active" : "")}
            onClick={() => onTabChange(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="topbar-actions">
        <ViewsMenu
          views={availableViews}
          activeView={activeView}
          onLoadView={onLoadView}
          onSaveView={onSaveView}
          onShowFull={onShowFull}
        />
        <button
          type="button"
          className="topbar-palette"
          title="Command palette"
          onClick={onOpenPalette}
        >
          Commands
          <span className="topbar-kbd">{PALETTE_HINT}</span>
        </button>
      </div>
    </div>
  );
}
