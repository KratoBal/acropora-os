import type { ProductKnowledgeFact } from "@acropora/types";
import { describe, expect, it } from "vitest";

import { acceptedLine, canApproveCopy, isAcceptable } from "./jev-knowledge";

/** Invented values only. */
const fact = (over: Partial<ProductKnowledgeFact>): ProductKnowledgeFact => ({
  field: "packSize",
  value: "100 ml",
  unit: null,
  status: "VERIFIED",
  revision: 2,
  acceptedAt: "2026-10-03T19:00:00.000Z",
  acceptedBy: { id: "u", displayName: "Teszt Kolléga" },
  fieldResultId: "fr-1",
  source: { sourceType: null, sourceRef: null, retrievedAt: null },
  ...over,
});

describe("termékismeret a felülvizsgálati soron", () => {
  it("az elfogadott érték a változattal, a sor saját eredményénél", () => {
    expect(acceptedLine(fact({}), { fieldResultId: "fr-1" })).toBe(
      "Elfogadva: 100 ml (2. változat)",
    );
  });

  it("egy korábbi eredményből elfogadott tény kimondja, hogy újabb bizonyíték jött", () => {
    expect(acceptedLine(fact({}), { fieldResultId: "fr-2" })).toBe(
      "Elfogadva: 100 ml, egy korábbi ellenőrzésből. Újabb bizonyíték érkezett azóta.",
    );
  });

  it("csak az ellenőrzött, a javaslat és az ütközés fogadható el", () => {
    expect(isAcceptable({ status: "CONFLICTING_SOURCES" })).toBe(true);
    expect(isAcceptable({ status: "MISSING" })).toBe(false);
    expect(isAcceptable({ status: "POSSIBLE_WRONG_VALUE" })).toBe(false);
  });

  it("jóváhagyni csak friss piszkozatot lehet", () => {
    const entry = {
      block: "lead" as const,
      body: "x",
      editedAt: "2026-10-03T19:00:00.000Z",
      approvedAt: null,
    };
    expect(canApproveCopy({ ...entry, status: "DRAFT", stale: false })).toBe(
      true,
    );
    expect(canApproveCopy({ ...entry, status: "DRAFT", stale: true })).toBe(
      false,
    );
    expect(canApproveCopy({ ...entry, status: "APPROVED", stale: false })).toBe(
      false,
    );
    expect(canApproveCopy(undefined)).toBe(false);
  });
});
