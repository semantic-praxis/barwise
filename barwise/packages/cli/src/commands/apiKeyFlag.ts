/**
 * `--api-key` is declared so it can be refused, and refused in one place.
 *
 * A credential passed in argv reaches the shell history file, the CI job
 * log, and `/proc/<pid>/cmdline`, which any process running as the same user
 * can read while the command is alive. None of those is a place a key can be
 * withdrawn from once it has arrived.
 *
 * The hazard was known and written down: `docs/local-eval-runbook.md` and
 * `docs/handoff-2026-08-23.md` have both said "never pass `--api-key` on a
 * command line, where it lands in shell history" since August, while the
 * flag kept accepting one. That is the case CLAUDE.md's rule is about -- a
 * finding is closed by a check or a fix, not by a document
 * (docs/specs/keyless-model-access.spec.md, barwise-1031).
 *
 * The flag is kept DECLARED rather than deleted so the failure can explain
 * itself. Deleting it would make commander report an unknown option, which
 * is safe and tells a user with a working script nothing about what to do
 * instead.
 *
 * The refusal lives on the ROOT program, once, rather than beside each of
 * the five declarations. A per-command hook would be a must-agree pair with
 * nothing checking it: the sixth command to declare the flag would accept a
 * key. Here, any command that declares it is refused automatically, and any
 * command that does not gets commander's unknown-option error -- both safe,
 * with no list to maintain.
 */
import type { Command } from "commander";

/** The flag spelling, shared so the five declarations cannot drift. */
export const API_KEY_FLAG = "--api-key <key>";

export const API_KEY_FLAG_DESCRIPTION =
  "REMOVED -- set ANTHROPIC_API_KEY or OPENAI_API_KEY in the environment";

const REFUSAL = "--api-key was removed, and the value was NOT used.\n"
  + "  A key in argv reaches shell history, CI logs, and /proc/<pid>/cmdline,\n"
  + "  none of which it can be withdrawn from.\n"
  + "  Set ANTHROPIC_API_KEY (or OPENAI_API_KEY) in the environment instead.\n"
  + "  If this key has ever been passed this way, rotate it.";

/**
 * Refuse `--api-key` on any subcommand, before that subcommand's action.
 *
 * `preAction` rather than a check inside each action: the point is that no
 * command body ever sees the value, and a hook is the only place that holds
 * for commands not yet written.
 */
export function installApiKeyRefusal(program: Command): void {
  program.hook("preAction", (_thisCommand, actionCommand) => {
    // Commander camel-cases the flag. `undefined` means not supplied;
    // an empty string was still supplied, and is still refused.
    if ((actionCommand.opts() as Record<string, unknown>)["apiKey"] === undefined) return;
    actionCommand.error(`error: ${REFUSAL}`, { exitCode: 1 });
  });
}
