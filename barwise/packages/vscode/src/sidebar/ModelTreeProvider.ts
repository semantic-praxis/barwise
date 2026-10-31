import {
  type ConstraintInView,
  type EntityType,
  type ExternalConstraint,
  type FactType,
  isDisjunctiveMandatory,
  isEntityType,
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
  isValueType,
  type OrmModel,
  OrmYamlSerializer,
  preferredIdentifiers,
  roleIdsOf,
  type SubtypeFact,
  subtypeFactIdsOf,
  subtypeFactRef,
  subtypeFlagsFromConstraints,
  type ValueType,
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

export function buildTree(model: OrmModel): ModelTreeItem[] {
  const categories: ModelTreeItem[] = [];
  // The uniquenesses that identify an entity, by core's one rule, so the
  // badge marks what every other reader calls the preferred identifier.
  const preferred = new Set(preferredIdentifiers(model).byConstraint.keys());

  // Entity types
  const entities = model.objectTypes.filter(isEntityType);
  if (entities.length > 0) {
    categories.push({
      kind: "category",
      label: "Entity Types",
      iconId: "symbol-class",
      children: entities.map((ot) => entityItem(ot)).sort((a, b) => a.label.localeCompare(b.label)),
    });
  }

  // Value types
  const values = model.objectTypes.filter(isValueType);
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
      children: model.factTypes.map((ft) => factTypeItem(ft, model, preferred)).sort((a, b) =>
        a.label.localeCompare(b.label)
      ),
    });
  }

  // Constraints across fact types none of whose roles resolve, so no fact
  // type lists them; without this a constraint left dangling by a renamed
  // or deleted role would vanish from the tree just when it needs fixing.
  // Each is described by the role ids it names, which the file states; a
  // 2.0 file usually omits a constraint's own id, and the loader derives
  // one that appears nowhere in it (barwise-7jq).
  const unattached = model.constraintsTouchingNone();
  if (unattached.length > 0) {
    categories.push({
      kind: "category",
      label: "Unattached Constraints",
      iconId: "warning",
      children: unattached.map((c) => ({
        ...externalConstraintItem(c),
        description: [...new Set([...roleIdsOf(c), ...subtypeFactIdsOf(c)])].join(", "),
      })),
    });
  }

  // Subtype facts, each with what the constraints over subtypes say of it.
  if (model.subtypeFacts.length > 0) {
    const partitions = subtypeFlagsFromConstraints(model.constraints);
    categories.push({
      kind: "category",
      label: "Subtype Relationships",
      iconId: "type-hierarchy",
      children: model.subtypeFacts.map((sf) => subtypeItem(sf, model, partitions)).sort((a, b) =>
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

function entityItem(ot: EntityType): ModelTreeItem {
  return {
    kind: "entity_type",
    label: ot.name,
    description: ` (.${ot.referenceMode})`,
    id: ot.id,
  };
}

function valueItem(ot: ValueType): ModelTreeItem {
  const dt = ot.dataType ? ot.dataType.name : undefined;
  return {
    kind: "value_type",
    label: ot.name,
    description: dt,
    id: ot.id,
  };
}

function factTypeItem(
  ft: FactType,
  model: OrmModel,
  preferred: ReadonlySet<string>,
): ModelTreeItem {
  const reading = ft.readings[0]?.template ?? ft.name;

  // Every constraint that applies to the fact type: its own, and each
  // across fact types that names one of its roles, so a composite key
  // shows under both fact types it spans rather than under whichever one
  // a 2.0 file nests it in (orm-format-3, Open decision 9).
  const constraintChildren: ModelTreeItem[] = model.constraintsTouchingAny([ft.id]).map((c) =>
    constraintItem(c, preferred)
  );

  return {
    kind: "fact_type",
    label: ft.name,
    description: reading !== ft.name ? reading : undefined,
    id: ft.id,
    children: constraintChildren.length > 0 ? constraintChildren : undefined,
  };
}

/**
 * A constraint's row, from the pair a view returns: an internal constraint
 * names its roles through the fact type it lives in, which the pair always
 * carries for one; a constraint across fact types has none and needs none.
 */
function constraintItem(
  inView: ConstraintInView,
  preferred: ReadonlySet<string>,
): ModelTreeItem {
  // Split on the pair once, as the enforcement predicate does: narrowing
  // the constraint does not narrow a destructured fact type.
  if (inView[1] === undefined) return externalConstraintItem(inView[0]);
  const [c, ft] = inView;
  if (isInternalUniqueness(c)) {
    const roleNames = c.roleIds
      .map((rid) => ft.roles.find((r) => r.id === rid)?.name)
      .filter(Boolean);
    const badge = c.id !== undefined && preferred.has(c.id) ? " (preferred)" : "";
    return {
      kind: "constraint",
      label: `Uniqueness: ${roleNames.join(", ")}${badge}`,
    };
  }
  if (isMandatoryRole(c)) {
    const role = ft.roles.find((r) => r.id === c.roleId);
    return {
      kind: "constraint",
      label: `Mandatory: ${role?.name ?? c.roleId}`,
    };
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
  if (isValueConstraint(c)) {
    const vals = c.values.slice(0, 3).join(", ");
    const more = c.values.length > 3 ? "..." : "";
    return { kind: "constraint", label: `Values: {${vals}${more}}` };
  }
  return { kind: "constraint", label: `Constraint: ${(c as { type: string; }).type}` };
}

/** A constraint across fact types' row: its kind, with no roles to name. */
function externalConstraintItem(c: ExternalConstraint): ModelTreeItem {
  if (isExternalUniqueness(c)) return { kind: "constraint", label: "External Uniqueness" };
  if (isExclusion(c)) return { kind: "constraint", label: "Exclusion" };
  if (isExclusiveOr(c)) return { kind: "constraint", label: "Exclusive-Or" };
  if (isSubset(c)) return { kind: "constraint", label: "Subset" };
  if (isEquality(c)) return { kind: "constraint", label: "Equality" };
  if (isDisjunctiveMandatory(c)) return { kind: "constraint", label: "Disjunctive Mandatory" };
  return { kind: "constraint", label: `Constraint: ${c.type}` };
}

function subtypeItem(
  sf: SubtypeFact,
  model: OrmModel,
  partitions: ReturnType<typeof subtypeFlagsFromConstraints>,
): ModelTreeItem {
  const sub = model.getObjectType(sf.subtypeId);
  const sup = model.getObjectType(sf.supertypeId);
  const subName = sub?.name ?? sf.subtypeId;
  const supName = sup?.name ?? sf.supertypeId;
  const flags: string[] = [];
  if (sf.providesIdentification) flags.push("identifies");
  // What the constraints over this supertype's subtypes say of this one.
  const partition = partitions.get(subtypeFactRef(sf));
  if (partition?.exclusive) flags.push("exclusive");
  if (partition?.exhaustive) flags.push("exhaustive");
  return {
    kind: "subtype_fact",
    label: `${subName} is a ${supName}`,
    description: flags.length > 0 ? flags.join(", ") : undefined,
    id: sf.id,
  };
}
