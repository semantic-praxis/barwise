// Lineage: manifest, impact, staleness.
export { generateDdlLineage, generateModelLineage } from "./generate.js";
export { type AffectedArtifact, analyzeImpact, type ImpactReport } from "./impact.js";
export {
  hashModel,
  manifestPath,
  parseManifest,
  serializeManifest,
  updateManifest,
} from "./manifest.js";
export { type ArtifactResolution, resolveArtifactInManifest } from "./resolveArtifact.js";
export { checkStaleness, type StaleArtifact, type StalenessReport } from "./staleness.js";
export type { LineageEntry, LineageManifest, ManifestExport, SourceReference } from "./types.js";
