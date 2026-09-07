#!/usr/bin/env node
/**
 * Every citation of Halpin & Morgan must point at a section the book has.
 *
 * The reference text (Information Modeling and Relational Databases,
 * 3rd ed.) is cited from the Anki deck's "Read more" pointers, the gym
 * exercises' reading fields, the tutorial's closing, the contents
 * transcript's deck mapping and the reading guide. Each of those is a
 * copy of a section number whose authority is the transcribed table of
 * contents in docs/halpin-morgan-3e-contents.md, and a copy that must
 * agree with an authority gets a drift check in the same commit that
 * creates it (CLAUDE.md; docs/specs/duplication-drift-guards.spec.md).
 *
 * Written when the reading guide added a fifth copy, and the sweep that
 * preceded it found three of the existing four had already drifted:
 * the tutorial renderer cited the 2nd edition, a gym check sent the
 * learner to "section 3.5 (reference schemes)" (3.5 is schema trimming;
 * reference schemes are 5.3) and the contents transcript's own deck
 * mapping named 7.4 for final checks (7.5). None of that was visible
 * to a reader without the book open, which is the reader the pointers
 * exist for.
 *
 * WHAT THIS CHECKS, precisely:
 *   - a cited chapter or section number exists in the transcript;
 *   - a parenthetical gloss after a citation -- "5.3 (reference
 *     schemes)" -- shares a keyword with the title of what it cites,
 *     so a right-looking number with the wrong topic is caught;
 *   - a page span after a chapter citation -- "ch. 3, pp. 59-110" --
 *     is the chapter's span in the transcript;
 *   - the book is never cited by another edition.
 * A citation with no gloss passes on existence alone; the check is a
 * floor, not a proof that the pointer is the best one.
 *
 * WHAT COUNTS AS A CITATION. In most files, only text that names the
 * book: a segment (a `;`-delimited run of a paragraph) containing
 * "Halpin" or "3rd ed." is book-scoped, and every `ch. N`, `section
 * N.M`, and bare `N.M` in it is checked. Two files are book-scoped
 * throughout, because they are about the book: the contents transcript
 * and the reading guide. In either mode a segment stops being about the
 * book at a barwise reference ("barwise", "ARCHITECTURE.md", "ORM2-02",
 * ...), so "ch. 11; barwise ARCHITECTURE.md sections 3.4-3.5" checks 11
 * and leaves 3.4 alone. Put barwise references after a `;`.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { REPO_ROOT, trackedFiles } from "./lib/tracked.mjs";

const AUTHORITY = "barwise/docs/halpin-morgan-3e-contents.md";
const BOOK_SCOPED_FILES = new Set([
  AUTHORITY,
  "barwise/docs/halpin-morgan-3e-reading-guide.md",
]);
/**
 * Findings that are right as written. Each names the file, a substring of
 * the offending line, and why; an entry that matches nothing fails the
 * check, so a fixed site forces its row out.
 */
const ALLOWLIST = [
  {
    file: "barwise/docs/book-verification-cc5-serialization.md",
    match: "one 2nd-ed section (16.7",
    why: "compares the editions; the 2nd-ed section number is the point being made",
  },
];

const SELF = new Set([
  "barwise/scripts/check-book-citations.mjs",
  "barwise/scripts/tests/gates.test.mjs",
]);

/** Which tracked files are read. Historical specs cite whatever edition they cited. */
function scanned(file) {
  if (SELF.has(file)) return false;
  if (file.startsWith("barwise/docs/specs/archive/")) return false;
  if (file === "README.md") return true;
  if (file.startsWith("barwise/docs/")) return /\.(md|txt)$/.test(file);
  if (file.startsWith("barwise/packages/learn/")) return /\.(md|yaml|ts)$/.test(file);
  if (file.startsWith(".claude/skills/")) return file.endsWith(".md");
  return false;
}

// --- the authority ---------------------------------------------------------

const CHAPTER_LINE = /^\s*(\d{1,2})\s{2,}(.+?)\s{2,}(\d+)\s*$/;
const SECTION_LINE = /^\s*(\d{1,2})\.(\d{1,2})\s+(.+?)\s{2,}(\d+)\s*$/;
const BACK_MATTER_LINE = /^(ORM Glossary)\s{2,}(\d+)\s*$/;

/** Chapters and sections from the transcript's fenced contents block. */
function authority(text) {
  const chapters = new Map();
  const sections = new Map();
  let glossaryPage = null;
  const fence = /```\n([\s\S]*?)\n```/.exec(text);
  if (!fence) throw new Error(`${AUTHORITY}: no fenced contents block`);
  for (const line of fence[1].split("\n")) {
    let m;
    if ((m = SECTION_LINE.exec(line))) {
      sections.set(`${m[1]}.${m[2]}`, { title: m[3], page: Number(m[4]) });
    } else if ((m = CHAPTER_LINE.exec(line))) {
      chapters.set(Number(m[1]), { title: m[2], page: Number(m[3]) });
    } else if ((m = BACK_MATTER_LINE.exec(line))) {
      glossaryPage = Number(m[2]);
    }
  }
  if (chapters.size === 0 || sections.size === 0) {
    throw new Error(`${AUTHORITY}: contents block parsed to nothing`);
  }
  // A chapter's span ends where the next chapter (or the glossary) begins.
  for (const [n, ch] of chapters) {
    const next = chapters.get(n + 1)?.page ?? glossaryPage;
    ch.last = next === null || next === undefined ? null : next - 1;
  }
  return { chapters, sections };
}

/** Every title a chapter citation may be glossed against: its own and its sections'. */
function chapterPool(auth, n) {
  const titles = [auth.chapters.get(n).title];
  for (const [id, s] of auth.sections) if (id.startsWith(`${n}.`)) titles.push(s.title);
  return titles.join(" | ").toLowerCase();
}

// --- citations -------------------------------------------------------------

const BOOK_MARKER = /Halpin|3rd ed\./;
const STOP =
  /\bbarwise\b|ARCHITECTURE\.md|ORM_PROJECT_GUIDE|ORM2-0\d|Business Rules Journal|\bEvans\b/;
const OTHER_EDITION = /\b(1st|2nd|4th|5th)\s+ed(?:ition|\.)/g;
const CHAPTER_REF = /\bch(?:apter)?s?\.?\s+(\d{1,2})(?:\s*(?:-|to|and)\s*(\d{1,2}))?/g;
const PAGE_SPAN = /\bpp\.\s*(\d+)\s*-\s*(\d+)/g;
// A two-part number that is not part of a three-part one (a semver, a
// barwise doc section like 3.1.4). A trailing period ("section 5.3.") is
// sentence punctuation, not a third part.
const SECTION_REF =
  /(?<![\d.])(\d{1,2})\.(\d{1,2})(?!\d|\.\d)(?:\s*-\s*(\d{1,2})\.(\d{1,2})(?!\d|\.\d))?/g;
const GLOSS = /^\s*\(([^()]*)\)/;
const STOPWORDS = new Set([
  "the",
  "and",
  "that",
  "with",
  "from",
  "into",
  "some",
  "also",
  "this",
  "which",
  "where",
  "section",
  "sections",
  "chapter",
  "chapters",
  "step",
  "steps",
  "procedure",
  "material",
  "here",
  "only",
  "both",
  "each",
  "their",
  "what",
  "when",
  "then",
  "than",
  "them",
]);

/** Words a gloss can be matched on: four or more letters, not filler. */
function keywords(gloss) {
  return gloss.toLowerCase().match(/[a-z]{4,}/g)?.filter((w) => !STOPWORDS.has(w)) ?? [];
}

/**
 * Some keyword and some title word are the same stem: one is a prefix of
 * the other and they share at least four letters. "trim"/"trimming" and
 * "constraint"/"constraints" match; "schemes"/"schema" does not, which is
 * the pair that let "3.5 (reference schemes)" read as right.
 */
function glossMatches(gloss, pool) {
  const words = keywords(gloss);
  if (words.length === 0) return true;
  const titleWords = pool.match(/[a-z]{4,}/g) ?? [];
  return words.some((w) => titleWords.some((p) => p.startsWith(w) || w.startsWith(p)));
}

/** Split a paragraph at `;` outside parentheses. */
function segments(paragraph) {
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < paragraph.length; i++) {
    const c = paragraph[i];
    if (c === "(") depth++;
    else if (c === ")") depth = Math.max(0, depth - 1);
    else if (c === ";" && depth === 0) {
      out.push({ offset: start, text: paragraph.slice(start, i) });
      start = i + 1;
    }
  }
  out.push({ offset: start, text: paragraph.slice(start) });
  return out;
}

/** Paragraphs with their starting line. Line-oriented formats (cards, YAML) use lines. */
function paragraphs(file, text) {
  const byLine = /\.(txt|yaml)$/.test(file);
  const out = [];
  if (byLine) {
    text.split("\n").forEach((line, i) => out.push({ line: i + 1, text: line }));
    return out;
  }
  let line = 1;
  for (const block of text.split(/\n[ \t]*\n/)) {
    out.push({ line, text: block });
    line += block.split("\n").length + 1;
  }
  return out;
}

function checkSegment(auth, file, line, seg, findings) {
  const cited = []; // in order, for page spans
  const count = { citations: 0 };
  const check = (id, gloss, at) => {
    count.citations++;
    const s = auth.sections.get(id);
    if (!s) {
      findings.push({ file, line, what: `section ${id} is not in the 3rd ed. contents`, raw: at });
      return;
    }
    if (gloss && !glossMatches(gloss, s.title.toLowerCase())) {
      findings.push({
        file,
        line,
        what: `section ${id} is "${s.title}", but the gloss says (${gloss})`,
        raw: at,
      });
    }
  };
  const text = seg.text;
  const context = (i) => text.slice(Math.max(0, i - 40), i + 60).replace(/\s+/g, " ");

  for (const m of text.matchAll(CHAPTER_REF)) {
    const from = Number(m[1]);
    const to = m[2] ? Number(m[2]) : from;
    const gloss = GLOSS.exec(text.slice(m.index + m[0].length))?.[1];
    const pools = [];
    for (let n = from; n <= to; n++) {
      count.citations++;
      if (!auth.chapters.has(n)) {
        findings.push({
          file,
          line,
          what: `chapter ${n} is not in the 3rd ed. contents`,
          raw: context(m.index),
        });
        continue;
      }
      cited.push(n);
      pools.push(chapterPool(auth, n));
    }
    // A gloss on a range describes the range ("chs. 4-7 (the constraint
    // chapters)"), so it is matched against every chapter in it at once.
    if (gloss && pools.length > 0 && !glossMatches(gloss, pools.join(" | "))) {
      const which = from === to
        ? `chapter ${from} is "${auth.chapters.get(from).title}"`
        : `chapters ${from}-${to}`;
      findings.push({
        file,
        line,
        what: `${which}, but the gloss says (${gloss})`,
        raw: context(m.index),
      });
    }
  }
  for (const m of text.matchAll(SECTION_REF)) {
    const gloss = GLOSS.exec(text.slice(m.index + m[0].length))?.[1];
    if (m[3]) {
      // A range: every section from the first to the last, in one chapter.
      const [c1, s1, c2, s2] = [m[1], m[2], m[3], m[4]].map(Number);
      const ids = [];
      if (c1 === c2) { for (let s = s1; s <= s2; s++) ids.push(`${c1}.${s}`); }
      else ids.push(`${c1}.${s1}`, `${c2}.${s2}`);
      const pool = ids.map((id) => auth.sections.get(id)?.title ?? "").join(" | ").toLowerCase();
      for (const id of ids) check(id, null, context(m.index));
      count.citations++;
      if (gloss && !glossMatches(gloss, pool)) {
        findings.push({
          file,
          line,
          what: `sections ${m[1]}.${m[2]}-${m[3]}.${m[4]} do not cover the gloss (${gloss})`,
          raw: context(m.index),
        });
      }
    } else {
      check(`${m[1]}.${m[2]}`, gloss, context(m.index));
    }
  }
  let spanIndex = 0;
  for (const m of text.matchAll(PAGE_SPAN)) {
    const n = cited[spanIndex++];
    if (n === undefined) {
      findings.push({
        file,
        line,
        what: "page span without a chapter citation before it",
        raw: context(m.index),
      });
      continue;
    }
    const ch = auth.chapters.get(n);
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a !== ch.page || (ch.last !== null && b !== ch.last)) {
      findings.push({
        file,
        line,
        what: `chapter ${n} spans pp. ${ch.page}-${
          ch.last ?? "?"
        } in the contents, not pp. ${a}-${b}`,
        raw: context(m.index),
      });
    }
  }
  return count.citations;
}

// --- main ------------------------------------------------------------------

const lineCache = new Map();
/** The source line a finding points at, for allowlist matching. */
function lineText(f) {
  if (!lineCache.has(f.file)) {
    lineCache.set(f.file, readFileSync(resolve(REPO_ROOT, f.file), "utf8").split("\n"));
  }
  // A paragraph-level finding names the paragraph's first line; the match
  // may sit on a later line of it, so look through the paragraph.
  const lines = lineCache.get(f.file);
  const out = [];
  for (let i = f.line - 1; i < lines.length && (i === f.line - 1 || lines[i].trim() !== ""); i++) {
    out.push(lines[i]);
  }
  return out.join("\n");
}

const auth = authority(readFileSync(resolve(REPO_ROOT, AUTHORITY), "utf8"));
const findings = [];
const scannedFiles = new Set(trackedFiles().filter(scanned));
let citations = 0;

// The scan enumerates tracked files (scripts/lib/tracked.mjs), so a file
// written but not yet added is invisible to it. The reading guide was
// exactly that for its first four "green" runs: 588 citations OK, none
// of them its own, and the gloss it got wrong surfaced only after the
// commit (the barwise-906 blind spot, met again). A book-scoped file
// that is on disk and not tracked is therefore a failure, not a skip.
for (const file of BOOK_SCOPED_FILES) {
  if (!scannedFiles.has(file) && existsSync(resolve(REPO_ROOT, file))) {
    findings.push({
      file,
      line: 0,
      what: "exists but is not tracked, so nothing in it was checked; git add it and rerun",
      raw: "",
    });
  }
}

for (const file of scannedFiles) {
  const text = readFileSync(resolve(REPO_ROOT, file), "utf8");
  const bookScoped = BOOK_SCOPED_FILES.has(file);

  for (const m of text.matchAll(OTHER_EDITION)) {
    const before = text.slice(Math.max(0, m.index - 300), m.index);
    if (/Halpin|Information Modeling/.test(before)) {
      const line = text.slice(0, m.index).split("\n").length;
      findings.push({
        file,
        line,
        what: `cites the ${m[1]} edition; the reference edition is the 3rd (${AUTHORITY})`,
        raw: text.slice(Math.max(0, m.index - 60), m.index + 30).replace(/\s+/g, " "),
      });
    }
  }

  for (const para of paragraphs(file, text)) {
    for (const seg of segments(para.text)) {
      if (!bookScoped && !BOOK_MARKER.test(seg.text)) continue;
      const stop = STOP.exec(seg.text);
      const scoped = stop ? { ...seg, text: seg.text.slice(0, stop.index) } : seg;
      const line = para.line + para.text.slice(0, seg.offset).split("\n").length - 1;
      citations += checkSegment(auth, file, line, scoped, findings);
    }
  }
}

const used = new Set();
const real = findings.filter((f) => {
  const hit = ALLOWLIST.find((a) => a.file === f.file && lineText(f).includes(a.match));
  if (hit) used.add(hit);
  return !hit;
});
// An entry for a file this tree does not track is inert, not stale: the
// gate's own tests run it in throwaway repos that carry none of them.
const stale = ALLOWLIST.filter((a) => !used.has(a) && scannedFiles.has(a.file));

if (real.length > 0 || stale.length > 0) {
  console.error("Book citations must agree with the 3rd ed. contents transcript:\n");
  for (const f of real) {
    console.error(`  ${f.file}:${f.line}  ${f.what}`);
    console.error(`      ...${f.raw.trim().slice(0, 110)}...`);
  }
  for (const a of stale) {
    console.error(
      `  ${a.file}  STALE allowlist entry "${a.match}" (${a.why}) -- nothing matches it any more; remove it`,
    );
  }
  console.error(
    `\nThe authority is ${AUTHORITY}. Fix the citation, or the transcript if the book disagrees with it.`,
  );
  process.exit(1);
}
console.log(
  `book citations OK: ${citations} citations in ${scannedFiles.size} files agree with ${AUTHORITY} `
    + `(${auth.chapters.size} chapters, ${auth.sections.size} sections)`,
);
