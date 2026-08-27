/**
 * NORMA import rejects an unrecognized ring type instead of coercing
 * it to "irreflexive" (barwise-869). Coercion silently rewrote the
 * model's semantics; an unknown value in NORMA's fixed vocabulary
 * means a version mismatch and must fail loudly.
 */
import { describe, expect, it } from "vitest";
import { NormaImportFormat } from "../src/norma/NormaImportFormat.js";

const XML_WITH_UNKNOWN_RING = `<?xml version="1.0" encoding="utf-8"?>
<ormRoot:ORM2 xmlns:ormRoot="http://schemas.neumont.edu/ORM/2006-01/ORMRoot" xmlns:orm="http://schemas.neumont.edu/ORM/2006-04/ORMCore">
  <orm:ORMModel id="model1" Name="RingTest">
    <orm:Objects>
      <orm:EntityType id="et1" Name="Person" _ReferenceMode="id" />
    </orm:Objects>
    <orm:Facts>
      <orm:Fact id="ft1" _Name="PersonMentorsPerson">
        <orm:FactRoles>
          <orm:Role id="r1" _IsMandatory="false" Name="mentor">
            <orm:RolePlayer ref="et1" />
          </orm:Role>
          <orm:Role id="r2" _IsMandatory="false" Name="mentee">
            <orm:RolePlayer ref="et1" />
          </orm:Role>
        </orm:FactRoles>
      </orm:Fact>
    </orm:Facts>
    <orm:Constraints>
      <orm:RingConstraint id="rc1" Name="ring1" Type="StronglyIntransitive">
        <orm:RoleSequence>
          <orm:Role ref="r1" />
          <orm:Role ref="r2" />
        </orm:RoleSequence>
      </orm:RingConstraint>
    </orm:Constraints>
  </orm:ORMModel>
</ormRoot:ORM2>`;

describe("NORMA ring type rejection", () => {
  it("rejects an unrecognized ring type instead of coercing it", () => {
    const importer = new NormaImportFormat();
    expect(() => importer.parse(XML_WITH_UNKNOWN_RING)).toThrowError(
      /Unrecognized ring constraint type "StronglyIntransitive"/,
    );
  });
});
