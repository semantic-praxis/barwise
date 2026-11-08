/**
 * The record a merge leaves, and the rules it is read against
 * (docs/adr/merge-delegation.md decisions 1, 3, 4 and 5;
 * docs/specs/adr-batch10-enforcers.spec.md, WS6).
 *
 * Two readers over one rule set, because the record lives in two places:
 *
 *   readMerges + judgeMerge       git alone: the merge commit's parents and
 *                                 trailers. No network, so it runs on every
 *                                 event and locally.
 *   readMergeComments + judgeComments
 *                                 GitHub: the verdict comment the agent
 *                                 posts before the merge. Network, so the
 *                                 caller runs it on pushes to main only.
 *
 * Nothing here has path logic. Decision 3 (no size exemption) is a property
 * of the code: a tracker-only merge and a code merge go through the same
 * function, and the tagged test holds that.
 *
 * WHY THE CUTOFF IS A CONSTANT. Between #937 and #956 the trailers existed
 * but the comment spellings did not agree, so an earlier cutoff flags four
 * merges that followed the practice of the day (owner, Open decision 2).
 * Every merge from #956 on is read; it is a fixed point in history, so the
 * same input gives the same answer on any later day.
 *
 * Throws, never exits: each reader's caller owns the exit code, and every
 * throw is "could not answer" (exit 2), never a finding. A finding is only
 * what `judge*` returns.
 */
import { createHash } from "node:crypto";

/** The merge commit of PR #956, the restatement of rows 7, 8, 9 and 20 into the ADR. */
export const MERGE_RECORD_SINCE = "21075c415cc3d2296783f10ca923364b988b1b9c";

/** Merges the API half reads per push: a window, not `before..after`, because
 * a push run can be cancelled by the next (#956 and #957 landed 12 s apart). */
export const API_WINDOW = 30;

/** Pages of comments read per pull request before pagination is called broken. */
export const PAGE_CAP = 10;

/** pr-review section 6's five verdicts. */
export const VERDICTS = [
  "merge",
  "merge after",
  "do not merge",
  "cannot tell",
  "code-review unavailable",
];

const FULL_SHA = /^[0-9a-f]{40}$/;
const FIELD = "\u001f";

// Bold is optional on both halves: 49 verdict comments in the corpus bold
// the verdict only, 7 bold nothing, and `**Review verdict on head X**: ...`
// is the form the grammar also admits. The head is a 7 to 40 hex prefix.
const VERDICT_LINE = new RegExp(
  `^\\*{0,2}Review verdict on head ([0-9a-f]{7,40})\\*{0,2}: \\*{0,2}(${
    VERDICTS.join("|")
  })\\*{0,2}\\.$`,
  "i",
);
const OWNER_ANSWER = /^\s*Owner-answer:/;

/** A reading that could not be completed; the gate exits 2 on it. */
export class Refusal extends Error {}

// ---------------------------------------------------------------- git half

/**
 * The first-parent history from `tip` back to MERGE_RECORD_SINCE inclusive,
 * newest first, as `{ sha, parents, committed, subject, trailers }`.
 *
 * Refuses on a shallow clone, a cutoff that is not a first-parent ancestor
 * of the tip, or an empty range: each would read as "no bad merges".
 *
 * `since` is a parameter only so the gate's tests can build a history with a
 * cutoff of its own; the script passes MERGE_RECORD_SINCE.
 *
 * @param {{ run: (args: string[]) => string, answers: (args: string[]) => boolean }} git
 */
export function readMerges(git, tip, since = MERGE_RECORD_SINCE) {
  if (git.run(["rev-parse", "--is-shallow-repository"]).trim() !== "false") {
    throw new Refusal(
      "this is a shallow clone, so the merge history cannot be read in full. Fix: git fetch --unshallow",
    );
  }
  if (!git.answers(["merge-base", "--is-ancestor", since, tip])) {
    throw new Refusal(
      `the cutoff ${since.slice(0, 8)} is not an ancestor of ${tip}, `
        + "so the range to read does not exist.",
    );
  }
  const out = git.run([
    "log",
    "--first-parent",
    "-z",
    `--format=%H${FIELD}%P${FIELD}%ct${FIELD}%s${FIELD}%(trailers:only,unfold)`,
    tip,
    `^${since}^`,
  ]);
  const merges = out.split("\u0000").filter((r) => r.trim() !== "").map((r) => {
    const [sha, parents, committed, subject, trailerText = ""] = r.replace(/^\n/, "").split(FIELD);
    return {
      sha,
      parents: parents.split(" ").filter(Boolean),
      committed: Number(committed),
      subject,
      trailers: trailerText.split("\n").flatMap((line) => {
        const m = /^([A-Za-z][\w-]*):[ \t]*(.*?)\s*$/.exec(line);
        return m ? [{ key: m[1].toLowerCase(), value: m[2] }] : [];
      }),
    };
  });
  if (merges.length === 0 || merges.at(-1).sha !== since) {
    throw new Refusal(
      `the first-parent history of ${tip} does not end at the cutoff `
        + `${since.slice(0, 8)}; read ${merges.length} commit(s).`,
    );
  }
  return merges;
}

/** The text of each `Owner-directed:` trailer of a merge. */
const directedText = (m) =>
  m.trailers.filter((t) => t.key === "owner-directed").map((t) => t.value);

/**
 * Whether the owner directed this merge: exactly one `Owner-directed:`
 * trailer with text. An empty one is not an instruction, so it exempts
 * nothing (and is itself a finding).
 */
export function isOwnerDirected(m) {
  const od = directedText(m);
  return od.length === 1 && od[0] !== "";
}

/**
 * The rules one merge commit breaks, as `[{ rule, why }]`; empty when it
 * conforms.
 *
 * - A merge has two parents, or it is a squash, rebase or direct push with
 *   no merged head to compare, unless the owner directed it.
 * - `Reviewed-head` is 40 hex and equals the second parent; `Review` is
 *   exactly `merge`; neither without the other.
 * - `Owner-directed:` has text; with it the review trailers are optional
 *   and, if present, still hold to the line above (#983 carries both).
 * - A merge with none of the three is a finding. That is the likely
 *   violation (an agent that merges without trailers) and the cost is the
 *   owner's manual merges, accepted by baseline row (Open decision 1).
 */
export function judgeMerge(m) {
  const found = [];
  const add = (rule, why) => found.push({ rule, why });
  const values = (key) => m.trailers.filter((t) => t.key === key).map((t) => t.value);
  const rh = values("reviewed-head");
  const rv = values("review");
  const od = directedText(m);

  if (m.parents.length !== 2 && !isOwnerDirected(m)) {
    add(
      "not-a-merge",
      m.parents.length === 1
        ? "a single-parent commit on the first-parent history is a squash, rebase or direct push: "
          + "there is no merged head to compare, and it carries no Owner-directed trailer"
        : `a commit with ${m.parents.length} parents is not a two-parent merge of a reviewed head`,
    );
  }
  for (const [name, list] of [["Reviewed-head", rh], ["Review", rv], ["Owner-directed", od]]) {
    if (list.length > 1) {
      add("duplicate-trailer", `${list.length} ${name} trailers; which one counts is ambiguous`);
    }
  }
  if (od.length > 0 && !isOwnerDirected(m) && od.length === 1) {
    add("owner-directed-empty", "an Owner-directed trailer with no text records no instruction");
  }
  if ((rh.length > 0) !== (rv.length > 0)) {
    add(
      "trailer-pair",
      `${rh.length ? "Reviewed-head" : "Review"} without ${rh.length ? "Review" : "Reviewed-head"}`,
    );
  }
  for (const head of rh) {
    if (!FULL_SHA.test(head)) {
      add("reviewed-head-form", `Reviewed-head "${head}" is not a 40-hex commit id`);
    } else if (head !== m.parents[1]) {
      add(
        "reviewed-head-mismatch",
        `Reviewed-head ${head.slice(0, 8)} is not the merged head (second parent `
          + `${
            m.parents[1]?.slice(0, 8) ?? "absent"
          }): the head moved after the review, or the trailer names another commit`,
      );
    }
  }
  for (const verdict of rv) {
    if (verdict !== "merge") add("review-not-merge", `Review trailer is "${verdict}", not "merge"`);
  }
  if (rh.length === 0 && rv.length === 0 && od.length === 0) {
    add(
      "no-record",
      "no Reviewed-head, Review or Owner-directed trailer: the merge leaves no record that a review recommended it",
    );
  }
  return found;
}

// ---------------------------------------------------------------- API half

/**
 * One GitHub read. Anything but a 2xx JSON body is a refusal that names
 * the read: a rate limit or a 403 would otherwise read as "no comments",
 * which the rules below call a finding.
 */
async function getJson(fetchImpl, url, headers, what) {
  let res;
  try {
    res = await fetchImpl(url, { headers });
  } catch (err) {
    throw new Refusal(`${what}: network failure (${err.message})`);
  }
  if (res.status === 403 || res.status === 429) {
    throw new Refusal(`${what}: HTTP ${res.status} (token lacks read access, or rate limited)`);
  }
  if (res.headers.get("x-ratelimit-remaining") === "0") {
    throw new Refusal(`${what}: the rate limit is exhausted (x-ratelimit-remaining: 0)`);
  }
  if (!(res.status >= 200 && res.status < 300)) throw new Refusal(`${what}: HTTP ${res.status}`);
  let body;
  try {
    body = await res.json();
  } catch (err) {
    throw new Refusal(`${what}: the response is not JSON (${err.message})`);
  }
  return { body, link: res.headers.get("link") ?? "" };
}

const nextLink = (link) => /<([^>]+)>;\s*rel="next"/.exec(link)?.[1];

/**
 * Every comment of a pull request, oldest first, following `Link: next`.
 * A next link still present after PAGE_CAP pages refuses, and a link that
 * leaves the API's origin does too, since the token rides on each request.
 */
async function readAllComments(fetchImpl, { apiUrl, repo, number, headers }) {
  const origin = new URL(apiUrl).origin;
  const what = `comments of #${number}`;
  let url = `${apiUrl}/repos/${repo}/issues/${number}/comments?per_page=100`;
  const all = [];
  for (let page = 0; page < PAGE_CAP; page++) {
    const { body, link } = await getJson(fetchImpl, url, headers, what);
    if (!Array.isArray(body)) throw new Refusal(`${what}: expected a list`);
    all.push(...body);
    const next = nextLink(link);
    if (!next) return all;
    if (new URL(next).origin !== origin) throw new Refusal(`${what}: Link: next leaves ${origin}`);
    url = next;
  }
  throw new Refusal(`${what}: still paginating after ${PAGE_CAP} pages`);
}

/** The pull request a merge commit came from; two or more is an ambiguous head. */
async function pullFor(fetchImpl, { apiUrl, repo, sha, headers }) {
  const what = `pull request of ${sha.slice(0, 8)}`;
  const { body } = await getJson(
    fetchImpl,
    `${apiUrl}/repos/${repo}/commits/${sha}/pulls`,
    headers,
    what,
  );
  if (!Array.isArray(body)) throw new Refusal(`${what}: expected a list`);
  // The endpoint lists every pull request whose history holds the commit,
  // so a stacked PR can appear beside the one merged; the one GitHub
  // recorded as producing this merge commit is the answer.
  const own = body.filter((p) => p.merge_commit_sha === sha);
  const pick = own.length === 1
    ? own[0]
    : own.length === 0 && body.length === 1
    ? body[0]
    : undefined;
  if (body.length === 0) {
    // The index lags a fresh push; a merge that never had a pull request
    // is accepted by a baseline row, not guessed at here.
    throw new Refusal(`${what}: GitHub lists no pull request for it (the index can lag a push)`);
  }
  if (pick === undefined) {
    throw new Refusal(`${what}: ${body.length} pull requests contain it, so the head is ambiguous`);
  }
  return pick.number;
}

/**
 * Read the comments of each merge's pull request.
 *
 * @param {Array<{sha: string}>} merges those to read, already filtered
 * @returns {Promise<Array<{merge: object, number: number|undefined, comments: object[]}>>}
 */
export async function readMergeComments(merges, { fetchImpl, apiUrl, repo, token }) {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "barwise-check-merge-record",
  };
  const out = [];
  for (const merge of merges) {
    const number = await pullFor(fetchImpl, { apiUrl, repo, sha: merge.sha, headers });
    const comments = number === undefined
      ? []
      : await readAllComments(fetchImpl, { apiUrl, repo, number, headers });
    out.push({ merge, number, comments });
  }
  return out;
}

const seconds = (iso, what) => {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) throw new Refusal(`${what}: "${iso}" is not a timestamp`);
  return Math.floor(ms / 1000);
};

/** A comment's verdict line, or null when its first line is not one. */
/** Comment author_association values that carry write access. */
const WRITERS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

export function parseVerdict(body) {
  const m = VERDICT_LINE.exec(String(body ?? "").split("\n")[0].trim());
  return m ? { head: m[1].toLowerCase(), verdict: m[2].toLowerCase() } : null;
}

/**
 * The rules a pull request's comments break for one merge, and what was
 * read, as `{ found: [{ rule, why }], read: [...] }`.
 *
 * `comment <= merge`, not `<`: both are GitHub-set ISO seconds and the
 * margin on record is 2 to 13 seconds, so they can share one.
 *
 * Edits cannot be seen: the API keeps no history, so a body is judged as
 * it reads now. A comment edited after the merge is reported in `read`
 * (and the job summary), not a finding (could be a typo fix) and not a
 * refusal (that would blind the gate on that merge for good).
 */
export function judgeComments(merge, number, comments) {
  const head = merge.parents[1];
  const mergedAt = merge.committed;
  const parsed = comments
    .map((c) => ({
      c,
      at: seconds(c.created_at, `comment ${c.id}`),
      v: parseVerdict(c.body),
    }))
    .sort((a, b) => a.at - b.at || a.c.id - b.c.id);

  const read = parsed.map(({ c, at }) => ({
    id: c.id,
    created_at: c.created_at,
    updated_at: c.updated_at,
    hash: createHash("sha256").update(String(c.body ?? "")).digest("hex").slice(0, 12),
    edited: c.updated_at !== c.created_at,
    editedAfterMerge: c.updated_at !== undefined
      && seconds(c.updated_at, `comment ${c.id}`) > mergedAt,
    afterMerge: at > mergedAt,
  }));

  const found = [];
  const add = (rule, why) => found.push({ rule, why });
  const where = number === undefined ? "its pull request" : `#${number}`;

  // Anyone can comment on a public repository; only a verdict from someone
  // with write access speaks for the review the merge relied on.
  const named = parsed.filter((p) =>
    p.v && head.startsWith(p.v.head) && WRITERS.has(p.c.author_association)
  );
  const before = named.filter((p) => p.at <= mergedAt);
  if (before.length === 0) {
    add(
      named.length === 0 ? "no-verdict-comment" : "verdict-after-merge",
      named.length === 0
        ? `no verdict comment on ${where} names the merged head ${head.slice(0, 8)}`
        : `every verdict comment naming ${head.slice(0, 8)} on ${where} is dated after the merge`,
    );
  } else if (before.at(-1).v.verdict !== "merge") {
    add(
      "verdict-not-merge",
      `the latest verdict comment on ${head.slice(0, 8)} before the merge says "${
        before.at(-1).v.verdict
      }"`,
    );
  }

  // Only verdicts after the owner's last answer count (decision 4); an
  // answer posted after the merge decides nothing about it.
  const upTo = parsed.filter((p) => p.at <= mergedAt);
  const lastAnswer = upTo.findLastIndex((p) => OWNER_ANSWER.test(String(p.c.body ?? "")));
  const refused = upTo.slice(lastAnswer + 1).filter((p) => p.v && p.v.verdict !== "merge");
  if (refused.length >= 2) {
    add(
      "two-nonmerge-verdicts",
      `${refused.length} verdicts other than "merge" on ${where} after the last Owner-answer: comment, `
        + "and the agent merged without asking the owner",
    );
  }
  return { found, read };
}
