import type { Position } from "@barwise/diagram";

export function pathData(points: readonly Position[]): string {
  return points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`)
    .join(" ");
}
