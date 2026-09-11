/**
 * Mess an authored transcript the way a real meeting recording is
 * messy: timestamps, a latecomer, crosstalk, an [inaudible], a tangent,
 * CRLF and a BOM at the enterprise tier. The seeded-defect key's line
 * numbers are remapped so the oracle can still find each device.
 * Deterministic in the seed.
 */
import { hashSeed, prng } from "../prng.mjs";

const TANGENT = [
  "Before we go on, did anyone see the email about the parking garage closure next week?",
  "Sorry, my other call is running over. Can we keep this to twenty minutes?",
  "Is this being recorded? Okay. Fine. Just checking.",
];

export function messTranscript(text, key, { seed = 1, tier = "small" } = {}) {
  const rnd = prng(hashSeed(`transcript:${seed}:${tier}`));
  const src = text.split(/\r?\n/);
  const out = [];
  const lineMap = new Map(); // original 1-based -> new 1-based
  let t = 9 * 3600 + rnd.int(1800);
  const stamp = () => {
    t += 20 + rnd.int(90);
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    return `[${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${
      String(s).padStart(2, "0")
    }]`;
  };
  out.push(`[00:00:00] (recording started; auto-transcribed, speaker labels may be wrong)`);
  src.forEach((line, i) => {
    const speakerTurn = /^\*\*?[A-Z][^:]{1,40}:\*\*?|^[A-Z][A-Za-z .'-]{1,40}:/.test(line);
    if (speakerTurn && tier !== "small") {
      if (rnd.chance(0.06)) out.push(`${stamp()} [crosstalk]`);
      if (rnd.chance(0.04)) out.push(`${stamp()} ${rnd.pick(TANGENT)}`);
      if (rnd.chance(0.05)) line = line.replace(/(\w+)\.$/, "$1 [inaudible].");
      out.push(`${stamp()} ${line}`);
    } else {
      out.push(line);
    }
    lineMap.set(i + 1, out.length);
  });
  const remapped = structuredClone(key);
  for (const s of remapped.seeded ?? []) {
    s.lines = (s.lines ?? []).map((n) => lineMap.get(n) ?? n);
  }
  const joined = out.join(tier === "enterprise" ? "\r\n" : "\n");
  return { text: (tier === "enterprise" ? "﻿" : "") + joined, key: remapped };
}
