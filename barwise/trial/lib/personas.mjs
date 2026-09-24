/**
 * The rules a persona's declaration must satisfy, and which of its rubric
 * checks an artifact kind is excused from. Pure: the rubric is passed in,
 * so the package check can be tested without a customer on disk.
 *
 * Two declarations, both explicit because both used to be inferred.
 *
 * `judges` names the artifacts whose imports a persona grades. It was
 * optional, AUTHORING.md said a persona without it was graded over the
 * kernel alone, and the runner graded such a persona over every import:
 * eleven baseline rows rested on a rule the documentation denied
 * (barwise-uzn). It is now required, and the runner reads every id in it
 * -- it used to read only the first.
 *
 * `not_expressible` names a rubric check an artifact kind cannot satisfy
 * by construction, with the reason. TypeScript has no objectification, so
 * a check for "a fact type connecting Shipment and Carrier" cannot be met
 * from code that holds the booking as a class with three fields, however
 * faithful the importer (barwise-y6a). The check stays in the rubric and
 * still grades the kernel and every other artifact kind.
 */

/** A check is named by its `element`, exactly as the rubric writes it. */
const sameElement = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Everything wrong with a customer's persona declarations, as messages.
 * `rubricChecks(persona)` returns that persona's rubric `checks` array.
 */
export function personaProblems(customer, rubricChecks) {
  const problems = [];
  const artifacts = new Map((customer.artifacts ?? []).map((a) => [a.id, a]));
  for (const p of customer.personas ?? []) {
    const who = `${customer.id} persona ${p.id}`;
    if (!Array.isArray(p.judges) || p.judges.length === 0) {
      problems.push(
        `${who}: judges is required -- list the artifact ids whose imports this persona grades`,
      );
      continue;
    }
    for (const id of p.judges) {
      if (!artifacts.has(id)) problems.push(`${who}: judges names ${id}, which is not an artifact`);
    }
    const judgedKinds = new Set(p.judges.map((id) => artifacts.get(id)?.generator));
    const checks = (p.not_expressible ?? []).length ? rubricChecks(p) : [];
    for (const [i, x] of (p.not_expressible ?? []).entries()) {
      const at = `${who}: not_expressible[${i}]`;
      if (!x.reason) problems.push(`${at} has no reason`);
      if (!judgedKinds.has(x.artifact_kind)) {
        problems.push(
          `${at} names artifact kind ${x.artifact_kind}, which this persona judges none of`,
        );
      }
      const matches = checks.filter((c) => sameElement(c.element, x.check));
      if (matches.length !== 1) {
        problems.push(`${at} matches ${matches.length} rubric checks; it must name exactly one`);
      }
    }
  }
  return problems;
}

/**
 * The positions, in the rubric's `checks` order, that an artifact of this
 * kind is excused from. The gym report lists results in that same order
 * and carries no check id, so position is the only join; the grader
 * refuses when the counts disagree rather than excuse the wrong check.
 */
export function exemptPositions(checks, notExpressible, artifactKind) {
  const positions = new Set();
  for (const x of notExpressible ?? []) {
    if (x.artifact_kind !== artifactKind) continue;
    checks.forEach((c, i) => {
      if (sameElement(c.element, x.check)) positions.add(i);
    });
  }
  return positions;
}
