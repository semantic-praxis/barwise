/**
 * Left pane: self-contained model tree over the serialized model
 * summary (modernization Phase 2). Deliberately overlaps the native
 * `barwise.modelTree` sidebar in exchange for a cohesive in-panel UX.
 * Selecting an item drives the same selection/highlight path as
 * clicking the diagram; items absent from the current (filtered) graph
 * still select, so the inspector can describe them from the summary.
 */
import type { ModelSummary } from "@barwise/diagram";
import { useMemo, useState } from "react";

export interface ModelTreeProps {
  readonly summary: ModelSummary | null;
  readonly selectedId: string | null;
  /** Ids present in the currently rendered graph (dim absent items). */
  readonly visibleIds: ReadonlySet<string>;
  readonly onSelect: (id: string) => void;
}

interface SectionDef {
  readonly key: string;
  readonly title: string;
  readonly items: ReadonlyArray<{ id: string; label: string; badge?: string; }>;
}

export function ModelTree(props: ModelTreeProps): JSX.Element {
  const { summary, selectedId, visibleIds, onSelect } = props;
  const [filter, setFilter] = useState("");
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

  const sections = useMemo((): SectionDef[] => {
    if (!summary) return [];
    return [
      {
        key: "object-types",
        title: "Object Types",
        items: summary.objectTypes.map((ot) => ({
          id: ot.id,
          label: ot.name,
          badge: ot.kind === "entity" ? "E" : "V",
        })),
      },
      {
        key: "fact-types",
        title: "Fact Types",
        items: summary.factTypes.map((ft) => ({
          id: ft.id,
          label: ft.name,
          ...(ft.constraints.length > 0 && { badge: String(ft.constraints.length) }),
        })),
      },
      {
        key: "subtypes",
        title: "Subtypes",
        items: summary.subtypes.map((sf) => ({
          id: sf.id,
          label: `${sf.subtypeName} is a ${sf.supertypeName}`,
        })),
      },
    ];
  }, [summary]);

  if (!summary) {
    return <div className="tree-empty">Loading model…</div>;
  }

  const needle = filter.trim().toLowerCase();
  const toggle = (key: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="tree">
      <input
        type="text"
        className="tree-filter"
        placeholder="Filter model…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      {sections.map((section) => {
        const items = needle
          ? section.items.filter((i) => i.label.toLowerCase().includes(needle))
          : section.items;
        if (section.items.length === 0) return null;
        const isCollapsed = collapsed.has(section.key) && !needle;
        return (
          <div key={section.key} className="tree-section">
            <button
              type="button"
              className="tree-section-header"
              onClick={() => toggle(section.key)}
            >
              <span className={"tree-chevron" + (isCollapsed ? " collapsed" : "")}>
                ▾
              </span>
              {section.title}
              <span className="tree-count">{items.length}</span>
            </button>
            {!isCollapsed && items.map((item) => (
              <button
                type="button"
                key={item.id}
                className={"tree-item"
                  + (item.id === selectedId ? " selected" : "")
                  + (visibleIds.has(item.id) ? "" : " absent")}
                title={visibleIds.has(item.id)
                  ? item.label
                  : `${item.label} (not in the current view)`}
                onClick={() => onSelect(item.id)}
              >
                {item.badge && <span className="tree-badge">{item.badge}</span>}
                <span className="tree-label">{item.label}</span>
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}
