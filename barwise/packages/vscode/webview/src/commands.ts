/**
 * Builds the context-aware command list for the Cmd/Ctrl+K palette.
 *
 * Every command maps to a verb already reachable elsewhere in the UI
 * (inspector control, Views menu, context bar, canvas buttons); the
 * palette is just a unified, keyboard-driven surface for them.
 */
import type { PositionedNode } from "@barwise/diagram";
import type { DiagramMeta } from "../../src/diagram/protocol";
import type { TabKey } from "./components/TopBar";

export interface Command {
  readonly id: string;
  readonly label: string;
  readonly hint?: string;
  readonly run: () => void;
}

/** Verbs the palette can invoke, supplied by the App. */
export interface CommandActions {
  readonly focusEntity: (nodeId: string, hopCount: number) => void;
  readonly clearFocus: () => void;
  readonly showNeighbors: (nodeId: string) => void;
  readonly addGhostToView: (nodeId: string) => void;
  readonly clearGhosts: () => void;
  readonly saveView: () => void;
  readonly loadView: (name: string) => void;
  readonly saveLayout: () => void;
  readonly fit: () => void;
  readonly zoomIn: () => void;
  readonly zoomOut: () => void;
  readonly setTab: (tab: TabKey) => void;
}

export interface CommandContext {
  readonly meta: DiagramMeta | null;
  readonly selectedNode: PositionedNode | null;
  readonly isSelectedGhost: boolean;
  readonly actions: CommandActions;
}

const TAB_COMMANDS: ReadonlyArray<{ tab: TabKey; label: string; }> = [
  { tab: "diagram", label: "Diagram" },
  { tab: "verbalize", label: "Verbalization" },
  { tab: "facts", label: "Fact Population" },
  { tab: "yaml", label: "YAML" },
  { tab: "ddl", label: "SQL DDL" },
];

export function buildCommands(ctx: CommandContext): Command[] {
  const { meta, selectedNode, isSelectedGhost, actions: a } = ctx;
  const cmds: Command[] = [];

  const selectedEntity = selectedNode?.kind === "object_type" ? selectedNode : null;
  const viewActive = meta?.view != null;

  if (selectedEntity) {
    for (const hop of [1, 2, 3]) {
      cmds.push({
        id: `focus-${hop}`,
        label: `Focus ${selectedEntity.name} (${hop} ${hop === 1 ? "hop" : "hops"})`,
        hint: "neighborhood",
        run: () => a.focusEntity(selectedEntity.id, hop),
      });
    }
    if (viewActive && !isSelectedGhost) {
      cmds.push({
        id: "show-neighbors",
        label: `Show neighbors of ${selectedEntity.name}`,
        hint: "ghost preview",
        run: () => a.showNeighbors(selectedEntity.id),
      });
    }
    if (viewActive && isSelectedGhost) {
      cmds.push({
        id: "add-to-view",
        label: `Add ${selectedEntity.name} to view`,
        hint: meta?.view?.viewName,
        run: () => a.addGhostToView(selectedEntity.id),
      });
    }
  }

  if (meta?.focus || meta?.view) {
    cmds.push({ id: "clear-focus", label: "Show full model", run: a.clearFocus });
  }
  if (meta?.view?.hasGhosts) {
    cmds.push({ id: "clear-ghosts", label: "Clear neighbor preview", run: a.clearGhosts });
  }

  cmds.push({ id: "save-view", label: "Save current view...", run: a.saveView });
  for (const name of meta?.availableViews ?? []) {
    if (name === meta?.view?.viewName) continue;
    cmds.push({
      id: `open-view-${name}`,
      label: `Open view: ${name}`,
      hint: "view",
      run: () => a.loadView(name),
    });
  }

  cmds.push({ id: "save-layout", label: "Save layout", hint: "diagrams:", run: a.saveLayout });
  cmds.push({ id: "fit", label: "Fit diagram to view", run: a.fit });
  cmds.push({ id: "zoom-in", label: "Zoom in", run: a.zoomIn });
  cmds.push({ id: "zoom-out", label: "Zoom out", run: a.zoomOut });

  for (const { tab, label } of TAB_COMMANDS) {
    cmds.push({ id: `tab-${tab}`, label: `Go to ${label}`, hint: "tab", run: () => a.setTab(tab) });
  }

  return cmds;
}
