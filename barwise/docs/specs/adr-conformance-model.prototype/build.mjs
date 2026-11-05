// The fact builder (format 4.0 role ids), asking the reader only what the
// code judge would ask: scripts() for an npm entry the gate-name and
// meta-gate verdicts accept, issues() for a none entry.
const L = "../../../scripts/lib/";
const { parseEnforcedBy, decisionIds, gateName, META_GATES } = await import(
  L + "adr-enforcement.mjs"
);
const { ADR_DIR } = await import(L + "architecture-section.mjs");

export const ROLES = {
  has: [
    "Decision_belongs_to_ADR",
    "Decision_belongs_to_ADR.belongs_to",
    "Decision_belongs_to_ADR.has",
  ],
  lists: [
    "Entry_lists_Decision",
    "Entry_lists_Decision.lists",
    "Entry_lists_Decision.is_listed_by",
  ],
  names: ["Entry_names_Script", "Entry_names_Script.names", "Entry_names_Script.is_named_by"],
  defines: [
    "Package_defines_Script",
    "Package_defines_Script.is_defined_by",
    "Package_defines_Script.defines",
  ],
  cites: ["Entry_cites_Issue", "Entry_cites_Issue.cites", "Entry_cites_Issue.is_cited_by"],
  tracked: [
    "Issue_is_tracked_in_Tracker",
    "Issue_is_tracked_in_Tracker.is_tracked_in",
    "Issue_is_tracked_in_Tracker.tracks",
  ],
  open: [
    "Issue_is_open_in_Tracker",
    "Issue_is_open_in_Tracker.is_open_in",
    "Issue_is_open_in_Tracker.holds_open",
  ],
  tagged: [
    "Test_is_tagged_with_Decision",
    "Test_is_tagged_with_Decision.is_tagged_with",
    "Test_is_tagged_with_Decision.tags",
  ],
};

// The verdict that decides whether the code judge looks the script up. In
// the plan this is one function in adr-judge.mjs that both judges call.
export const scriptIsLookedUp = (entry, adr) =>
  gateName(entry.script)
  && !(Object.hasOwn(META_GATES, entry.script) && !META_GATES[entry.script].includes(adr));

export function build(adrs, reader, { tags = [], entries = new Map() } = {}) {
  const pops = {};
  const fact = (k, a, b) => {
    const [ft, ra, rb] = ROLES[k];
    (pops[ft] ??= []).push({ [ra]: a, [rb]: b });
  };
  let askedScripts = false;
  let askedIssues = false;
  for (const { f, text } of adrs) {
    const adr = f.slice(ADR_DIR.length, -".md".length);
    const parsed = parseEnforcedBy(text);
    if (!parsed.present) continue;
    const seen = new Set();
    for (const d of decisionIds(text).decisions) {
      if (d.id === null || seen.has(d.id)) continue;
      seen.add(d.id);
      fact("has", `${adr}#${d.id}`, adr);
    }
    parsed.entries.forEach((e, n) => {
      const entry = `${adr}:${n}`;
      entries.set(entry, { adr, text: e.text });
      for (const id of new Set(e.ids)) fact("lists", entry, `${adr}#${id}`);
      if (e.kind === "npm" && scriptIsLookedUp(e, adr)) {
        askedScripts = true;
        if (reader.scripts() !== null) fact("names", entry, e.script);
      }
      if (e.kind === "none") {
        askedIssues = true;
        if (reader.issues() !== null) fact("cites", entry, e.issue);
      }
    });
  }
  if (askedScripts) {
    for (const s of Object.keys(reader.scripts() ?? {})) fact("defines", s, "barwise");
  }
  if (askedIssues) {
    for (const [id, o] of reader.issues() ?? []) {
      fact("tracked", id, "beads");
      if (o.status !== "closed") fact("open", id, "beads");
    }
  }
  for (const [t, d] of tags) fact("tagged", t, d);
  return pops;
}
