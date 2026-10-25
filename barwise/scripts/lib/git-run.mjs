/**
 * git for the gates that read history: check:plan-review and
 * check:spec-touches (docs/specs/touches-required.spec.md).
 *
 * Both need the same three readings, and each reading has one way to be
 * wrong that looks like an answer, so the readings live once:
 *
 *   run      output, or a throw naming the command and git's first error
 *            line -- never an empty string standing in for a failure;
 *   answers  a yes/no question: exit 0 yes, 1 no, anything else throws.
 *            128 is git failing, and read as "no" it would blame the
 *            author for what git could not see;
 *   commit   `rev-parse --verify --quiet <rev>^{commit}`: the full id, or
 *            undefined when no such commit exists (exit 1, which is also
 *            what an unknown or ambiguous revision gives), anything else
 *            throws.
 *
 * Throws rather than exits; each gate owns its refusal message.
 */
import { execFileSync } from "node:child_process";

const firstLine = (err) =>
  err.stderr?.toString().trim().split("\n")[0] || err.message.split("\n")[0];

/** The three readings, at `root`. */
export function gitAt(root) {
  const run = (args) => {
    try {
      return execFileSync("git", args, {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 256 * 1024 * 1024,
      });
    } catch (err) {
      throw new Error(`\`git ${args.join(" ")}\` failed: ${firstLine(err)}`);
    }
  };
  const answers = (args) => {
    try {
      execFileSync("git", args, { cwd: root, stdio: "ignore" });
      return true;
    } catch (err) {
      if (err.status === 1) return false;
      throw new Error(`\`git ${args.join(" ")}\` exited ${err.status ?? err.signal}`);
    }
  };
  const commit = (rev) => {
    try {
      return execFileSync("git", ["rev-parse", "--verify", "--quiet", `${rev}^{commit}`], {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
    } catch (err) {
      if (err.status === 1) return undefined;
      throw new Error(
        `\`git rev-parse --verify ${rev}\` exited ${err.status ?? err.signal}: ${firstLine(err)}`,
      );
    }
  };
  return { run, answers, commit };
}
