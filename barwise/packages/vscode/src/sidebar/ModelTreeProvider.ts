import {
  type Constraint,
  type FactType,
  isDisjunctiveMandatory,
  isEquality,
  isExclusion,
  isExclusiveOr,
  isExternalUniqueness,
  isFrequency,
  isInternalUniqueness,
  isMandatoryRole,
  isRing,
  isScopedView,
  isSubset,
  isValueConstraint,
  type ObjectType,
  type OrmModel,
  OrmYamlSerializer,
  type SubtypeFact,
} from "@barwise/core";
import * as vscode from "vscode";

const serializer = new OrmYamlSerializer();

/** Discriminated item types for tree nodes. */
type TreeItemKind =
  | "category"
  | "entity_type"
  | "value_type"
  | "fact_type"
  | "subtype_fact"
  | "constraint"
  | "diagram_layout";

interface ModelTreeItem {
  kind: TreeItemKind;
  label: string;
  description?: string;
  id?: string;
  children?: ModelTreeItem[];
  iconId?: string;
}

/**
 * VS Code TreeDataProvider that parses the active .orm.yaml file and
 * presents the model structure in the sidebar.
 */
export class ModelTreeProvider implements vscode.TreeDataProvider<ModelTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<
    ModelTreeItem | undefined
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private model: OrmModel | undefined;
  private items: ModelTreeItem[] = [];

  refresh(document?: vscode.TextDocument): void {
    if (document && document.fileName.endsWith(".orm.yaml")) {
      try {
        this.model = serializer.deserialize(document.getText());
        this.items = buildTree(this.model);
      } catch {
        this.model = undefined;
        this.items = [];
      }
    } else if (!document) {
      this.model = undefined;
      this.items = [];
    }
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: ModelTreeItem): vscode.TreeItem {
    const collapsible = element.children && element.children.length > 0
      ? vscode.TreeItemCollapsibleState.Expanded
      : element.kind === "category"
      ? vscode.TreeItemCollapsibleState.Collapsed
      : vscode.TreeItemCollapsibleState.None;

    const item = new vscode.TreeItem(element.label, collapsible);
    item.description = element.description;
    // Diagrams category gets a distinct contextValue for its context menu.
    item.contextValue = element.kind === "category" && element.label === "Diagrams"
      ? "diagrams_category"
      : element.kind;

    if (element.iconId) {
      item.iconPath = new vscode.ThemeIcon(element.iconId);
    } else {
      switch (element.kind) {
        case "category":
          item.iconPath = new vscode.ThemeIcon("symbol-folder");
          break;
        case "entity_type":
          item.iconPath = new vscode.ThemeIcon("symbol-class");
          break;
        case "value_type":
          item.iconPath = new vscode.ThemeIcon("symbol-field");
          break;
        case "fact_type":
          item.iconPath = new vscode.ThemeIcon("symbol-event");
          break;
        case "subtype_fact":
          item.iconPath = new vscode.ThemeIcon("type-hierarchy");
          break;
        case "constraint":
          item.iconPath = new vscode.ThemeIcon("shield");
          break;
        case "diagram_layout":
          item.iconPath = new vscode.ThemeIcon("layout");
          break;
      }
    }

    // Clicking an element with an ID highlights it in the diagram.
    if (element.id && element.kind !== "category") {
      item.command = {
        command: "barwise.highlightInDiagram",
        title: "Highlight in Diagram",
        arguments: [element.id, element.kind],
      };
      item.tooltip = element.label;
    }

    // Clicking a diagram layout loads that view.
    if (element.kind === "diagram_layout") {
      item.command = {
        command: "barwise.loadView",
        title: "Load View",
        arguments: [element.label],
      };
    }

    return item;
  }

  getChildren(element?: ModelTreeItem): ModelTreeItem[] {
    if (!element) {
      return this.items;
    }
    return element.children ?? [];
  }
}

// ---- Tree builder ----

function buildTree(model: OrmModel): ModelTreeItem[] {
  const categories: ModelTreeItem[] = [];

  // Entity types
  const entities = model.objectTypes.filter((ot) => ot.kind === "entity");
  if (entities.length > 0) {
    categories.push({
      kind: "category",
      label: "Entity Types",
      iconId: "symbol-class",
      children: entities.map((ot) => entityItem(ot)).sort((a, b) => a.label.localeCompare(b.label)),
    });
  }

  // Value types
  const values = model.objectTypes.filter((ot) => ot.kind === "value");
  if (values.length > 0) {
    categories.push({
      kind: "category",
      label: "Value Types",
      iconId: "symbol-field",
      children: values.map((ot) => valueItem(ot)).sort((a, b) => a.label.localeCompare(b.label)),
    });
  }

  // Fact types
  if (model.factTypes.length > 0) {
    categories.push({
      kind: "category",
      label: "Fact Types",
      iconId: "symbol-event",
      children: model.factTypes.map((ft) => factTypeItem(ft, model)).sort((a, b) =>
        a.label.localeCompare(b.label)
      ),
    });
  }

  // Subtype facts
  if (model.subtypeFacts.length > 0) {
    categories.push({
      kind: "category",
      label: "Subtype Relationships",
      iconId: "type-hierarchy",
      children: model.subtypeFacts.map((sf) => subtypeItem(sf, model)).sort((a, b) =>
        a.label.localeCompare(b.label)
      ),
    });
  }

  // Diagram layouts
  if (model.diagramLayouts.length > 0) {
    categories.push({
      kind: "category",
      label: "Diagrams",
      iconId: "layout",
      children: model.diagramLayouts.map((dl) => {
        const desc = isScopedView(dl)
          ? `${dl.elements.length} elements`
          : `${Object.keys(dl.positions).length} positions`;
        return {
          kind: "diagram_layout" as const,
          label: dl.name,
          description: desc,
        };
      }),
    });
  }

  return categories;
}

function entityItem(ot: ObjectType): ModelTreeItem {
  const refMode = ot.referenceMode ? ` (.${ot.referenceMode})` : "";
  return {
    kind: "entity_type",
    label: ot.name,
    description: refMode || undefined,
    id: ot.id,
  };
}

function valueItem(ot: ObjectType): ModelTreeItem {
  const dt = ot.dataType ? ot.dataType.name : undefined;
  return {
    kind: "value_type",
    label: ot.name,
    description: dt,
    id: ot.id,
  };
}

function factTypeItem(ft: FactType, model: OrmModel): ModelTreeItem {
  const reading = ft.readings[0]?.template ?? ft.name;

  // Collect constraints as children.
  const constraintChildren: ModelTreeItem[] = ft.constraints.map((c) =>
    constraintItem(c, ft, model)
  );

  return {
    kind: "fact_type",
    label: ft.name,
    description: reading !== ft.name ? reading : undefined,
    id: ft.id,
    children: constraintChildren.length > 0 ? constraintChildren : undefined,
  };
}

function constraintItem(
  c: Constraint,
  ft: FactType,
  _model: OrmModel,
): ModelTreeItem {
  if (isInternalUniqueness(c)) {
    const roleNames = c.roleIds
      .map((rid) => ft.roles.find((r) => r.id === rid)?.name)
      .filter(Boolean);
    const preferred = c.isPreferred ? " (preferred)" : "";
    return {
      kind: "constraint",
      label: `Uniqueness: ${roleNames.join(", ")}${preferred}`,
    };
  }
  if (isMandatoryRole(c)) {
    const role = ft.roles.find((r) => r.id === c.roleId);
    return {
      kind: "constraint",
      label: `Mandatory: ${role?.name ?? c.roleId}`,
    };
  }
  if (isExternalUniqueness(c)) {
    return { kind: "constraint", label: "External Uniqueness" };
  }
  if (isExclusion(c)) {
    return { kind: "constraint", label: "Exclusion" };
  }
  if (isExclusiveOr(c)) {
    return { kind: "constraint", label: "Exclusive-Or" };
  }
  if (isSubset(c)) {
    return { kind: "constraint", label: "Subset" };
  }
  if (isEquality(c)) {
    return { kind: "constraint", label: "Equality" };
  }
  if (isFrequency(c)) {
    return {
      kind: "constraint",
      label: `Frequency: ${c.min}-${c.max}`,
    };
  }
  if (isRing(c)) {
    return { kind: "constraint", label: `Ring: ${c.ringType}` };
  }
  if (isDisjunctiveMandatory(c)) {
    return { kind: "constraint", label: "Disjunctive Mandatory" };
  }
  if (isValueConstraint(c)) {
    const vals = c.values.slice(0, 3).join(", ");
    const more = c.values.length > 3 ? "..." : "";
    return { kind: "constraint", label: `Values: {${vals}${more}}` };
  }
  return { kind: "constraint", label: `Constraint: ${(c as { type: string; }).type}` };
}

function subtypeItem(sf: SubtypeFact, model: OrmModel): ModelTreeItem {
  const sub = model.getObjectType(sf.subtypeId);
  const sup = model.getObjectType(sf.supertypeId);
  const subName = sub?.name ?? sf.subtypeId;
  const supName = sup?.name ?? sf.supertypeId;
  const flags: string[] = [];
  if (sf.providesIdentification) flags.push("identifies");
  if (sf.isExclusive) flags.push("exclusive");
  if (sf.isExhaustive) flags.push("exhaustive");
  return {
    kind: "subtype_fact",
    label: `${subName} is a ${supName}`,
    description: flags.length > 0 ? flags.join(", ") : undefined,
    id: sf.id,
  };
}
