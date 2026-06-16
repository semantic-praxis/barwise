/**
 * reasoning-trail://{path} resource: the sensemaking trail for a model.
 *
 * Returns a `<model>.trail.json` sidecar (written at import with --trail)
 * when present; otherwise computes an anchors-only trail from the model,
 * so the resource is always useful.
 */

import { OrmYamlSerializer, queryModel } from "@barwise/core";
import type { ReasoningTrail } from "@barwise/llm";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { existsSync, readFileSync } from "node:fs";

const serializer = new OrmYamlSerializer();

/** Derive the trail sidecar path next to a `.orm.yaml` model file. */
export function trailSidecarPath(modelPath: string): string {
  return modelPath.endsWith(".orm.yaml")
    ? modelPath.replace(/\.orm\.yaml$/, ".trail.json")
    : `${modelPath}.trail.json`;
}

/**
 * Load the reasoning trail JSON for a model path: the persisted sidecar
 * if present, otherwise an anchors-only trail computed from the model.
 */
export function loadReasoningTrail(modelPath: string): string {
  const sidecar = trailSidecarPath(modelPath);
  if (existsSync(sidecar)) {
    return readFileSync(sidecar, "utf-8");
  }

  const model = serializer.deserialize(readFileSync(modelPath, "utf-8"));
  const anchorsResult = queryModel(model, { kind: "anchors" });
  const trail: ReasoningTrail = {
    modelName: model.name,
    anchors: anchorsResult.kind === "anchors" ? anchorsResult.anchors : [],
    ambiguities: [],
    discardedFramings: [],
    assumptions: [],
  };
  return JSON.stringify(trail, null, 2);
}

export function registerReasoningTrailResource(server: McpServer): void {
  server.registerResource(
    "reasoning-trail",
    new ResourceTemplate("reasoning-trail://{+path}", { list: undefined }),
    {
      title: "Reasoning Trail",
      description: "Returns the sensemaking reasoning trail for a model: anchors, "
        + "ambiguities, discarded framings, and low-confidence assumptions. Reads a "
        + "<model>.trail.json sidecar (written at import with --trail) when present; "
        + "otherwise returns an anchors-only trail computed from the model.",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const path = typeof variables.path === "string"
        ? variables.path
        : String(variables.path);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: loadReasoningTrail(path),
          },
        ],
      };
    },
  );
}
