import type { DiagramLayout } from "../../model/DiagramLayout.js";

export interface OrmYamlDiagramLayout {
  name: string;
  elements?: string[];
  positions?: Record<string, { x: number; y: number; }>;
  orientations?: Record<string, "horizontal" | "vertical">;
}

export function serializeDiagramLayout(dl: DiagramLayout): OrmYamlDiagramLayout {
  const result: OrmYamlDiagramLayout = { name: dl.name };
  if (dl.elements && dl.elements.length > 0) {
    result.elements = [...dl.elements];
  }
  if (Object.keys(dl.positions).length > 0) {
    const positions: Record<string, { x: number; y: number; }> = {};
    for (const [name, pos] of Object.entries(dl.positions)) {
      positions[name] = {
        x: Math.round(pos.x),
        y: Math.round(pos.y),
      };
    }
    result.positions = positions;
  }
  if (Object.keys(dl.orientations).length > 0) {
    result.orientations = { ...dl.orientations };
  }
  return result;
}

export function deserializeDiagramLayout(dlDoc: OrmYamlDiagramLayout): DiagramLayout {
  return {
    name: dlDoc.name,
    elements: dlDoc.elements,
    positions: dlDoc.positions ?? {},
    orientations: dlDoc.orientations ?? {},
  };
}
