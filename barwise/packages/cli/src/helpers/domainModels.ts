/**
 * Resolve a CLI `<file>` argument (a single `.orm.yaml` model or a
 * `.orm-project.yaml` manifest) plus an optional `--domain` selector into
 * the model(s) a command should operate on.
 *
 * This is the one shared project branch the read/analyze commands reuse, so
 * each does not re-implement project detection (the pattern `diagram` first
 * open-coded). See docs/specs/orm-project-surface-wiring.spec.md.
 */

import type { OrmModel } from "@barwise/core";
import { isProjectFile, loadModel } from "./io.js";
import { loadProject } from "./projectLoader.js";

/** One model to operate on, labelled with its domain context when from a project. */
export interface ResolvedDomain {
  /** The domain context name, or undefined for a single-model file. */
  readonly context?: string;
  readonly model: OrmModel;
}

export interface ResolvedDomains {
  readonly resolved: readonly ResolvedDomain[];
  /** Non-fatal assembly warnings (e.g. a domain file that failed to load). */
  readonly problems: readonly string[];
}

/**
 * Resolve the model(s) for a command:
 *
 * - a single-model file              -> one unlabelled entry;
 * - a project with `--domain X`      -> just domain X (throws if unknown);
 * - a project with no `--domain`     -> one entry per loaded domain, labelled.
 *
 * @throws if a single model fails to load, or a named domain is unknown or
 *   could not be loaded.
 */
export function resolveDomainModels(file: string, domain?: string): ResolvedDomains {
  if (!isProjectFile(file)) {
    return { resolved: [{ model: loadModel(file) }], problems: [] };
  }

  const { project, problems } = loadProject(file);

  if (domain !== undefined) {
    const dm = project.getDomain(domain);
    if (!dm) {
      const available = project.domains.map((d) => d.context).join(", ");
      throw new Error(
        `project has no domain "${domain}". Available: ${available || "(none)"}.`,
      );
    }
    if (!dm.model) {
      throw new Error(`domain "${domain}" could not be loaded; see warnings above.`);
    }
    return { resolved: [{ context: domain, model: dm.model }], problems };
  }

  const resolved: ResolvedDomain[] = [];
  for (const dm of project.domains) {
    if (dm.model) resolved.push({ context: dm.context, model: dm.model });
  }
  return { resolved, problems };
}
