/**
 * The shared SQL-type mapping (barwise-865). The DDL and dbt import
 * paths previously owned separate mappings that disagreed --
 * TIMESTAMP became "datetime" through DDL and "timestamp" through
 * dbt. These cases pin the shared semantics, including the settled
 * disagreement and the guards that keep a keyword prefix from
 * swallowing an unrelated type.
 */
import { describe, expect, it } from "vitest";
import { mapSqlTypeToConceptual } from "../../src/sql/typeMapping.js";

describe("mapSqlTypeToConceptual", () => {
  it("maps the common families, any case, with length suffixes", () => {
    expect(mapSqlTypeToConceptual("VARCHAR(255)")).toBe("text");
    expect(mapSqlTypeToConceptual("character varying")).toBe("text");
    expect(mapSqlTypeToConceptual("varchar2")).toBe("text");
    expect(mapSqlTypeToConceptual("BIGINT")).toBe("integer");
    expect(mapSqlTypeToConceptual("int unsigned")).toBe("integer");
    expect(mapSqlTypeToConceptual("DECIMAL(10, 2)")).toBe("decimal");
    expect(mapSqlTypeToConceptual("double precision")).toBe("float");
    expect(mapSqlTypeToConceptual("bool")).toBe("boolean");
    expect(mapSqlTypeToConceptual("SERIAL")).toBe("auto_counter");
    expect(mapSqlTypeToConceptual("bytea")).toBe("binary");
    expect(mapSqlTypeToConceptual("bytes")).toBe("binary");
    expect(mapSqlTypeToConceptual("UUID")).toBe("uuid");
    expect(mapSqlTypeToConceptual("MONEY")).toBe("money");
  });

  it("settles TIMESTAMP as timestamp and DATETIME as datetime", () => {
    // The disagreement barwise-865 fixed: DDL import said "datetime",
    // dbt said "timestamp". They are distinct conceptual types, so the
    // mapping keeps them distinct.
    expect(mapSqlTypeToConceptual("TIMESTAMP")).toBe("timestamp");
    expect(mapSqlTypeToConceptual("timestamp_ntz")).toBe("timestamp");
    expect(mapSqlTypeToConceptual("timestamp with time zone")).toBe("timestamp");
    expect(mapSqlTypeToConceptual("DATETIME")).toBe("datetime");
  });

  it("orders the temporal checks so prefixes do not collide", () => {
    expect(mapSqlTypeToConceptual("DATE")).toBe("date");
    expect(mapSqlTypeToConceptual("TIME")).toBe("time");
    expect(mapSqlTypeToConceptual("time(6)")).toBe("time");
  });

  it("does not let a keyword prefix swallow an unrelated type", () => {
    // "interval" starts with "int" but is not an integer; the DDL
    // regex chain had this over-match and the shared mapping does not.
    expect(mapSqlTypeToConceptual("interval")).toBeUndefined();
  });

  it("returns undefined for an unrecognized type -- the caller owns the fallback", () => {
    expect(mapSqlTypeToConceptual("geography")).toBeUndefined();
  });
});
