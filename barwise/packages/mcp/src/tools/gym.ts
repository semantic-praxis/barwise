/**
 * gym_list / gym_check tools: the modeling gym over MCP
 * (modeling-gym spec, workstream 3).
 *
 * `gym_list` returns the packaged exercise catalog; `gym_check`
 * evaluates a candidate model against an exercise's rubric and, when
 * checks fail, includes the miss-card deck file content
 * (learning-design C6) so the calling agent can save or relay it. The
 * server performs no writes -- file emission stays at the CLI edge.
 */
import {
  buildMissCards,
  evaluateCandidate,
  findExercise,
  listExercises,
  renderMissCardFile,
} from "@barwise/learn";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { resolveSource, type SourceInput } from "../workspace/resolve.js";
import { boundedTextResult } from "../workspace/response.js";
import { sourceInputSchema } from "../workspace/sourceSchema.js";

type TextResult = { content: Array<{ type: "text"; text: string; }>; };

export function registerGymTools(server: McpServer): void {
  server.registerTool(
    "gym_list",
    {
      title: "List Gym Exercises",
      description: "List the modeling-gym exercise catalog: id, title, the "
        + "proficiency transition each exercise serves, its exit performance, "
        + "and the brief.",
      inputSchema: {},
    },
    async () => executeGymList(),
  );

  server.registerTool(
    "gym_check",
    {
      title: "Check Gym Candidate",
      description: "Evaluate a candidate ORM model against a gym exercise's "
        + "rubric of semantic checks. Returns the structured report and, on "
        + "failure, the miss-card deck file content (Anki tab-separated "
        + "import, ORM 2::Misses subdeck).",
      inputSchema: {
        exercise: z.string().describe("Exercise id (see gym_list)"),
        source: sourceInputSchema(
          "File path to the candidate .orm.yaml, or inline YAML content",
        ),
      },
    },
    async ({ exercise, source }) => executeGymCheck(exercise, source),
  );
}

export function executeGymList(): TextResult {
  const entries = listExercises().map(({ loaded }) => ({
    id: loaded.exercise.id,
    title: loaded.exercise.title,
    transition: loaded.exercise.transition,
    exitPerformance: loaded.exercise.exitPerformance,
    brief: loaded.exercise.brief,
    reading: loaded.exercise.reading,
    checks: loaded.exercise.checks.length,
  }));
  return {
    content: [{ type: "text" as const, text: JSON.stringify(entries, null, 2) }],
  };
}

export function executeGymCheck(exerciseId: string, source: SourceInput): TextResult {
  const entry = findExercise(exerciseId);
  if (!entry) {
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({ error: `no exercise with id "${exerciseId}"` }),
      }],
    };
  }

  const { exercise, reference } = entry.loaded;
  const candidate = resolveSource(source);
  const report = evaluateCandidate(candidate, exercise, reference);
  const cards = buildMissCards(exercise, report);

  const payload = {
    ...report,
    ...(cards.length > 0 && { missCardFile: renderMissCardFile(exercise, cards) }),
  };
  return boundedTextResult(JSON.stringify(payload, null, 2), {
    kind: "gym-report",
  }) as TextResult;
}
