/**
 * `localName`, the one normalizer from an element's name to its format 4.0
 * id (docs/specs/iri-identity.spec.md, decision 3).
 */
import { describe, expect, it } from "vitest";
import { localName, localNameEncodes } from "../../src/model/name.js";

describe("localName", () => {
  it("keeps case and turns each run of whitespace into one underscore", () => {
    expect(localName("Customer places Order")).toBe("Customer_places_Order");
    expect(localName("  Order \t  Line  ")).toBe("Order_Line");
  });

  it("leaves a name an IRI path segment can hold as written", () => {
    expect(localName("CustomerHasCustomerId")).toBe("CustomerHasCustomerId");
    expect(localName("is-of_~(a)!")).toBe("is-of_~(a)!");
  });

  it("encodes the separators barwise reserves, so a name never reads as an alias or a role", () => {
    expect(localName("v1.2 Order")).toBe("v1%2E2_Order");
    expect(localName("crm:Customer")).toBe("crm%3ACustomer");
  });

  it("encodes what a path segment cannot hold, the percent sign included", () => {
    expect(localName("a/b#c?d")).toBe("a%2Fb%23c%3Fd");
    expect(localName("100%")).toBe("100%25");
    expect(localName('say "hi"')).toBe("say_%22hi%22");
  });

  it("keeps letters beyond ASCII, as an IRI allows, and encodes a control character as UTF-8", () => {
    expect(localName("Straße Café")).toBe("Straße_Café");
    expect(localName("a\u0085b")).toBe("a%C2%85b");
  });

  it("gives names that differ only in whitespace or underscores one id", () => {
    expect(localName("Order Line")).toBe(localName("Order_Line"));
  });

  it("normalizes to NFC, so names that print alike share an id", () => {
    expect(localName("Cafe\u0301")).toBe(localName("Caf\u00e9"));
    expect(localName("Cafe\u0301")).toBe("Café");
  });

  it("encodes characters beyond ASCII that RFC 3987 bars from an IRI", () => {
    expect(localName("a\uE000b")).toBe("a%EE%80%80b"); // private use
    expect(localName("a\uFFFDb")).toBe("a%EF%BF%BDb"); // a special
    expect(localName("a\uFDD0b")).toBe("a%EF%B7%90b"); // a noncharacter
    expect(localName("a\u202Eb")).toBe("a%E2%80%AEb"); // a bidi override
    expect(localName("a\u{F0000}b")).toBe("a%F3%B0%80%80b"); // plane-15 private use
  });

  it("keeps two lone surrogates apart instead of folding both to U+FFFD", () => {
    expect(localName("a\uD800b")).toBe("a%ED%A0%80b");
    expect(localName("a\uD800b")).not.toBe(localName("a\uDBFFb"));
  });
});

describe("localNameEncodes", () => {
  it("is false for a change that is only whitespace or NFC", () => {
    expect(localNameEncodes("Customer places Order")).toBe(false);
    expect(localNameEncodes("Cafe\u0301")).toBe(false);
  });

  it("is true when a character is percent-encoded", () => {
    expect(localNameEncodes("v1.2 Order")).toBe(true);
  });
});
