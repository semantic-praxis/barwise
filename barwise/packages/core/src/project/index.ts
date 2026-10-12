/**
 * Multi-domain project tooling: scaffold an empty project and split a
 * monolithic model into bounded contexts.
 */

export { scaffoldProject } from "./scaffoldProject.js";
export { parseSplitConfig, scaffoldSplitConfig } from "./splitConfig.js";
export {
  ModelSplitError,
  type SplitConfig,
  type SplitDomainFile,
  type SplitFile,
  splitFiles,
  type SplitMappingFile,
  splitModel,
  type SplitResult,
} from "./splitModel.js";
