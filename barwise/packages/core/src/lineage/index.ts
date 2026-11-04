// Lineage: manifest, impact, staleness.
export {
  claimExports,
  claimsExport,
  exportModels,
  exportsForModel,
  type ModelScope,
} from "./attribution.js";
export { generateDdlLineage, generateModelLineage } from "./generate.js";
export { type AffectedArtifact, analyzeImpact, type ImpactReport } from "./impact.js";
export {
  hashModel,
  manifestPath,
  parseManifest,
  renameInManifest,
  serializeManifest,
  updateManifest,
  upgradeManifest,
} from "./manifest.js";
export { type ArtifactResolution, resolveArtifactInManifest } from "./resolveArtifact.js";
export { checkStaleness, type StaleArtifact, type StalenessReport } from "./staleness.js";
export {
  LINEAGE_MANIFEST_VERSION,
  type LineageEntry,
  type LineageManifest,
  type ManifestExport,
  type SourceReference,
} from "./types.js";
