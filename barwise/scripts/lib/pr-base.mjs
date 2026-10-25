/**
 * The commit a gate reads a change against: `--base <ref>`, else
 * $BASE_SHA, else `origin/main` (docs/specs/touches-required.spec.md).
 *
 * check:plan-review and check:spec-touches both ask what a change adds
 * over its base, and they must mean the same base, so the order lives
 * once. ci.yml passes $BASE_SHA: the pull request's base commit, or, for
 * check:spec-touches on a push to main, `github.event.before`. ci-local
 * passes nothing, so the fallback applies there.
 *
 * Throws rather than exits; the caller owns its refusal message.
 */
import { opt } from "./args.mjs";

/**
 * GitHub's `before` for a newly created ref is forty zeros. Read as a
 * revision it names no commit, and a gate that went on to diff against
 * it would fail on git's error, or worse, on whatever a caller did with
 * an empty answer. Refused by name, so the reader learns why.
 */
const ALL_ZERO = /^0{7,40}$/;

/** `{ base, source }`, or throws when the base is the all-zero SHA or a flag has no value. */
export function resolveBase() {
  const flag = opt("--base");
  const env = process.env.BASE_SHA?.trim();
  const base = flag ?? (env || "origin/main");
  const source = flag !== null ? "--base" : env ? "BASE_SHA" : "the default, origin/main";
  if (ALL_ZERO.test(base)) {
    throw new Error(
      `the base (${source}) is the all-zero SHA, which names no commit: a newly created ref has no before-state to compare against`,
    );
  }
  return { base, source };
}
