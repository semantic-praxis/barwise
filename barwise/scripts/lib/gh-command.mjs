/**
 * Reading a `gh` command out of a Bash tool call, for the hooks that guard
 * one: merge-guard.mjs (a merge) and pr-open-guard.mjs (an opening).
 *
 * Moved here unchanged from merge-guard.mjs when the second hook arrived
 * (docs/specs/review-before-open.spec.md, Workstream 1), so the two read a
 * command the same way. A change here is a change to both.
 *
 * What it does not see is part of its contract, because both hooks pass a
 * command in which it finds no `gh` call: `timeout 60 gh ...`, `env -C
 * <dir> gh ...`, a compound command (`if`, `{ }`, `( )`, `!`), `bash -lc`,
 * a command after a quoted `<<WORD`, and `gh` reached through `xargs`,
 * `eval`, a variable, an alias or a function. pr-open-guard.test.mjs pins
 * that list.
 */
import { spawnSync } from "node:child_process";

/**
 * The command with heredoc bodies removed. A body is data for another
 * program, and read line by line it looks like commands: a markdown file
 * written with `cat <<EOF` that mentions `gh pr merge 5` blocked every such
 * call.
 */
function withoutHeredocBodies(command) {
  const out = [];
  let end = null;
  let dash = false;
  for (const line of command.split("\n")) {
    if (end !== null) {
      if ((dash ? line.replace(/^\t+/, "") : line) === end) end = null;
      continue;
    }
    out.push(line);
    const m = line.match(/<<(-?)\s*(['"]?)([A-Za-z_]\w*)\2/);
    if (m && !line.includes("<<<")) {
      dash = m[1] === "-";
      end = m[3];
    }
  }
  return out.join("\n");
}

/** Words of a shell command, split into command segments at unquoted operators. */
function segments(command) {
  const out = [[]];
  let word = null;
  let quote = null;
  const flush = () => {
    if (word !== null) out.at(-1).push(word);
    word = null;
  };
  const cut = () => {
    flush();
    if (out.at(-1).length) out.push([]);
  };
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote === "'") {
      if (c === "'") quote = null;
      else word += c;
    } else if ((c === "`" || command.startsWith("$(", i)) && quote !== "'") {
      // A substitution runs its own command, wherever it sits.
      cut();
      if (c === "$") i++;
    } else if (quote === '"') {
      if (c === '"') quote = null;
      else if (c === "\\" && i + 1 < command.length) word += command[++i];
      else word += c;
    } else if (c === "'" || c === '"') {
      quote = c;
      word ??= "";
    } else if (c === "\\" && i + 1 < command.length) {
      if (command[i + 1] === "\n") i++;
      else word = (word ?? "") + command[++i];
    } else if (c === "\n" || c === ";" || c === "&" || c === "|") cut();
    else if (/\s/.test(c)) flush();
    else word = (word ?? "") + c;
  }
  flush();
  return out.filter((s) => s.length);
}

/** `gh` argument lists in a command, looking through env prefixes and `bash -c`. */
export function ghCalls(command, depth = 0) {
  const calls = [];
  for (const seg of segments(withoutHeredocBodies(command))) {
    let i = 0;
    while (
      i < seg.length && /^(?:\$\(|[({`])*(\w+=|env$|command$|exec$|nohup$|time$|sudo$)/.test(seg[i])
    ) {
      i++;
    }
    const head = seg[i]?.replace(/^(?:\$\(|[({`])+/, "");
    // A path to gh is gh; `xargs`, `eval` and `$GH` are known limits.
    if (head?.split("/").pop() === "gh") calls.push(seg.slice(i + 1));
    else if (/^(ba|z|da)?sh$/.test(head ?? "") && depth < 3) {
      const c = seg.indexOf("-c", i);
      if (c >= 0 && seg[c + 1]) calls.push(...ghCalls(seg[c + 1], depth + 1));
    }
  }
  return calls;
}

/** Flags whose next word is a value, not a subcommand or a positional. */
const VALUED = new Set([
  "-R",
  "--repo",
  "-X",
  "--method",
  "-f",
  "-F",
  "--field",
  "--raw-field",
  "--input",
  "-H",
  "--header",
  "-q",
  "--jq",
  "-t",
  "--template",
  "--hostname",
  "--cache",
  "-p",
  "--preview",
]);

/** The non-flag words of a gh argument list, with their indexes, skipping flag values. */
export function subcommand(args) {
  const words = [];
  const at = [];
  for (let i = 0; i < args.length; i++) {
    if (VALUED.has(args[i])) i++;
    else if (!args[i].startsWith("-")) {
      words.push(args[i]);
      at.push(i);
    }
  }
  return { words, at };
}

/** Value of a flag in any of `--flag v`, `--flag=v`, `-f v` forms. */
export function flagValue(args, names) {
  for (let i = 0; i < args.length; i++) {
    for (const n of names) {
      if (args[i] === n) return args[i + 1];
      if (n.startsWith("--") && args[i].startsWith(`${n}=`)) return args[i].slice(n.length + 1);
    }
  }
  return undefined;
}

/** `key=value` fields given to `gh api` with -f/-F/--field/--raw-field. */
export function apiFields(args) {
  const fields = {};
  for (let i = 0; i < args.length; i++) {
    if (!/^(-f|-F|--field|--raw-field)$/.test(args[i])) continue;
    const eq = (args[i + 1] ?? "").indexOf("=");
    if (eq > 0) fields[args[i + 1].slice(0, eq)] = args[i + 1].slice(eq + 1);
  }
  return fields;
}

/**
 * owner/repo from the `origin` remote's URL, including a proxy URL ending
 * in owner/repo; null when git cannot name the remote. `cwd` is the
 * directory whose `origin` is meant; absent, the process's own.
 */
export function repoFromRemote(cwd) {
  const r = spawnSync("git", ["remote", "get-url", "origin"], {
    encoding: "utf8",
    ...(cwd ? { cwd } : {}),
  });
  const url = r.error || r.status !== 0 ? undefined : r.stdout.trim();
  const m = url?.match(/([^/:]+)\/([^/]+?)(?:\.git)?$/);
  return m ? { owner: m[1], repo: m[2] } : null;
}
