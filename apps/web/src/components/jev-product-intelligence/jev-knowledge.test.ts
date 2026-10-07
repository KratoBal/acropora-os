import type { ProductFieldReview, ProductKnowledgeFact } from "@acropora/types";
import { describe, expect, it } from "vitest";

import {
  acceptedLine,
  canApproveCopy,
  conflictMentions,
  conflictingFields,
  isAcceptable,
} from "./jev-knowledge";

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

  // D5: a nem ellenőrzött elfogadás kimondja, hogy nem kerül a webshopba
  it("a javaslat és az ütközés sora kimondja, hogy nem jelenik meg a webshopban", () => {
    expect(
      acceptedLine(fact({ status: "SUGGESTED" }), { fieldResultId: "fr-1" }),
    ).toBe(
      "Elfogadva: 100 ml (2. változat) Csak javaslat: a webshopban nem jelenik meg, amíg egy újabb forrás meg nem erősíti.",
    );
    expect(
      acceptedLine(fact({ status: "CONFLICTING_SOURCES", value: null }), {
        fieldResultId: "fr-1",
      }),
    ).toBe(
      "Elfogadva ütközésként, érték nélkül (2. változat) A webshopban nem jelenik meg, amíg az ütközés nincs feloldva.",
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

/** Invented values only. */
const review = (over: Partial<ProductFieldReview>): ProductFieldReview => ({
  fieldResultId: "fr-1",
  field: "dosing",
  tier: "C",
  status: "CONFLICTING_SOURCES",
  currentValue: null,
  value: null,
  sourceType: null,
  sourceRef: null,
  retrievedAt: null,
  confidence: null,
  evidence: [
    {
      sourceType: "MANUFACTURER_PAGE",
      value: { kind: "text", text: "1 drop/100 L/day" },
      sourceRef: "https://gyarto.example",
      retrievedAt: null,
    },
    {
      sourceType: "MANUFACTURER_DOCUMENT",
      value: { kind: "text", text: "1 drop/100 L, 1-2/week" },
      sourceRef: "doc",
      retrievedAt: null,
    },
  ],
  ...over,
});

describe("az ütköző érték a vevői szövegben (figyelmeztetés, nem tiltás)", () => {
  const conflicts = conflictingFields(
    [
      review({}),
      review({
        field: "packSize",
        status: "VERIFIED",
        evidence: [
          {
            sourceType: "MANUFACTURER_PAGE",
            value: { kind: "text", text: "100 ml" },
            sourceRef: null,
            retrievedAt: null,
          },
        ],
      }),
    ],
    [],
  );

  it("csak az ütköző mező kerül a listára, minden értékével", () => {
    expect(conflicts).toEqual([
      {
        field: "dosing",
        values: ["1 drop/100 L/day", "1 drop/100 L, 1-2/week"],
      },
    ]);
  });

  it("az ütközésként elfogadott tény mezője akkor is, ha az újabb eredmény más", () => {
    expect(
      conflictingFields(
        [review({ status: "VERIFIED" })],
        [fact({ field: "dosing", status: "CONFLICTING_SOURCES", value: null })],
      ).map((c) => c.field),
    ).toEqual(["dosing"]);
  });

  // KZ Amino stage run (#1431 comment 5972125293, finding 7): the first
  // approved body named both frequencies.
  it("a szövegben álló ütköző értéket megnevezi, betűmérettől és szóköztől függetlenül", () => {
    expect(
      conflictMentions(
        "Adagolás: 1 DROP/100 L/day,  vagy a lap szerint 1 drop/100 L, 1-2/week.",
        conflicts,
      ),
    ).toEqual([
      {
        field: "dosing",
        values: ["1 drop/100 L/day", "1 drop/100 L, 1-2/week"],
      },
    ]);
  });

  it("ha a szöveg nem nevez meg értéket, nincs találat", () => {
    expect(
      conflictMentions(
        "A gyártó forrásai az adagolásban nem egyeznek, ezért most nem adunk ajánlott adagot.",
        conflicts,
      ),
    ).toEqual([]);
  });
});
