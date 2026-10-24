/**
 * Which tracked files are instructions: text an agent or a review service
 * reads and acts on, so a path or a decision it cites is a fact that must
 * stay true. One definition for every gate that asks -- check-instruction-
 * refs resolves the paths these files cite, check-architecture resolves
 * the ADRs they name -- because two lists would drift the way the package
 * graph's copies did.
 */
export function isInstructionFile(f) {
  // REVIEW.md is read by the Claude Code Review service -- the root file,
  // and a nested one once the default branch is protected -- and cites
  // paths the same way.
  return /(^|\/)(CLAUDE|AGENTS|REVIEW)\.md$/.test(f)
    || (f.startsWith(".claude/") && f.endsWith(".md"));
}
