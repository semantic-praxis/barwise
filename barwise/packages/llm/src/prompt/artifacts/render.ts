import type { PromptDemo } from "./PromptArtifact.js";

/**
 * Render few-shot demos as a section appended to the system prompt.
 * `CompletionRequest` carries a single system prompt, so demos render
 * inline rather than as multi-turn messages. An artifact without demos
 * renders to the empty string, keeping the default prompt byte-stable.
 */
export function renderDemos(demos: readonly PromptDemo[]): string {
  if (demos.length === 0) return "";

  const sections = demos.map((demo, i) =>
    `### Example ${i + 1}

Transcript excerpt:

<transcript>
${demo.transcriptExcerpt}
</transcript>

Expected extraction:

\`\`\`json
${demo.extraction}
\`\`\``
  );

  return `\n\n## Worked Examples\n\n${sections.join("\n\n")}`;
}
