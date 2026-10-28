import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  decideResolution,
  expectedSzamlazzKindCode,
  lookupKeyFor,
  type ResolutionFacts,
} from "./billing-issuing-resolution.js";

/**
 * A KIVEZETŐ ÚT DÖNTÉSI TÁBLÁJA (kártya 38e9271d). Mi pirosít: DRAFT javaslat
 * a pozitív kontroll, a kor vagy az érvényes 7-es hibakód nélkül (EZ a dupla
 * kiállítás útja); DRAFT egy olyan sorra, amelynek a szövegében számlaszám áll;
 * ISSUED eltérő számmal, típussal vagy összeggel; bármilyen javaslat, ha a
 * lekérdezés nem adott érthető választ.
 */
const FOUND = {
  outcome: "FOUND",
  invoiceNumber: "E-TST-2026-7",
  kindCode: "SZ",
  issueDate: "2026-10-27",
  netTotal: "1000",
  grossTotal: "1270",
} as const;

function facts(over: Partial<ResolutionFacts> = {}): ResolutionFacts {
  return {
    kind: "NO_REPLY",
    knownNumber: null,
    ageMinutes: 120,
    documentType: "INVOICE",
    computedGross: "1270",
    lookup: FOUND,
    controlProven: true,
    ...over,
  };
}

describe("decideResolution: a Számlázz.hu igazolta a bizonylatot", () => {
  for (const kind of ["NO_REPLY", "UNCLEAR_REPLY", "NO_NOTE", "OTHER"] as const)
    it(`${kind}: külső azonosítóra talált, egyező típus és bruttó -> ISSUED a visszaadott számmal`, () => {
      const decision = decideResolution(facts({ kind }));
      assert.equal(decision.action, "RECORD_ISSUED");
      assert.equal(decision.invoiceNumber, "E-TST-2026-7");
      assert.equal(decision.lookup, "FOUND");
    });

  for (const kind of ["RECORDING_FAILED", "STRAY_PREVIEW"] as const) {
    it(`${kind}: a szövegben álló számmal egyező találat -> ISSUED`, () => {
      const decision = decideResolution(
        facts({ kind, knownNumber: "E-TST-2026-7" }),
      );
      assert.equal(decision.action, "RECORD_ISSUED");
    });
    it(`${kind}: más számot ad a Számlázz.hu, mint a szöveg -> nem tudjuk`, () => {
      const decision = decideResolution(
        facts({ kind, knownNumber: "E-TST-2026-8" }),
      );
      assert.equal(decision.action, "NONE");
      assert.equal(decision.invoiceNumber, null);
    });
    it(`${kind}: a szöveg szerint van bizonylat, a Számlázz.hu nem találja -> NEM megy DRAFT-ba`, () => {
      const decision = decideResolution(
        facts({
          kind,
          knownNumber: "E-TST-2026-7",
          lookup: { outcome: "NOT_FOUND" },
        }),
      );
      assert.equal(decision.action, "NONE");
    });
  }

  it("eltérő bizonylattípus -> nem tudjuk", () => {
    const decision = decideResolution(
      facts({ lookup: { ...FOUND, kindCode: "D" } }),
    );
    assert.equal(decision.action, "NONE");
    assert.match(decision.reason, /típusa/);
  });

  it("a típus a vázlatéhoz van kötve (előlegszámla ES, végszámla VS)", () => {
    assert.equal(expectedSzamlazzKindCode("ADVANCE_INVOICE"), "ES");
    assert.equal(expectedSzamlazzKindCode("FINAL_INVOICE"), "VS");
    assert.equal(
      decideResolution(
        facts({
          documentType: "ADVANCE_INVOICE",
          lookup: { ...FOUND, kindCode: "ES" },
        }),
      ).action,
      "RECORD_ISSUED",
    );
  });

  it("hiányzó típus vagy kelt, eltérő bruttó -> nem tudjuk", () => {
    for (const lookup of [
      { ...FOUND, kindCode: null },
      { ...FOUND, issueDate: null },
      { ...FOUND, grossTotal: "1271" },
      { ...FOUND, grossTotal: null },
    ])
      assert.equal(decideResolution(facts({ lookup })).action, "NONE");
  });

  it("az összeg tizedes- és szóköz-írásmódja nem számít", () => {
    assert.equal(
      decideResolution(
        facts({
          lookup: { ...FOUND, grossTotal: "1 270.00" },
          computedGross: "1270",
        }),
      ).action,
      "RECORD_ISSUED",
    );
  });
});

describe("decideResolution: a DRAFT-hoz minden feltétel kell", () => {
  const notFound = { outcome: "NOT_FOUND" } as const;

  it("érvényes 7-es + pozitív kontroll + elég régi sor -> DRAFT", () => {
    const decision = decideResolution(facts({ lookup: notFound }));
    assert.equal(decision.action, "BACK_TO_DRAFT");
    assert.equal(decision.lookup, "NOT_FOUND");
    assert.equal(decision.invoiceNumber, null);
  });

  it("pozitív kontroll nélkül NEM DRAFT (a kérés alakja hibás is lehet)", () => {
    const decision = decideResolution(
      facts({ lookup: notFound, controlProven: false }),
    );
    assert.equal(decision.action, "NONE");
    assert.match(decision.reason, /igazolható/);
  });

  it("fiatal sor NEM DRAFT (a hívás még feldolgozás alatt lehet)", () => {
    for (const ageMinutes of [0, 12, 29])
      assert.equal(
        decideResolution(facts({ lookup: notFound, ageMinutes })).action,
        "NONE",
        String(ageMinutes),
      );
    assert.equal(
      decideResolution(facts({ lookup: notFound, ageMinutes: 30 })).action,
      "BACK_TO_DRAFT",
    );
  });

  it("időtúllépés, más hibakód, érthetetlen válasz -> nem tudjuk, sosem DRAFT", () => {
    for (const lookup of [
      { outcome: "UNAVAILABLE" },
      { outcome: "ERROR", errorCode: "3" },
      { outcome: "ERROR", errorCode: null },
    ] as const) {
      const decision = decideResolution(facts({ lookup }));
      assert.equal(decision.action, "NONE");
      assert.equal(decision.lookup, "UNKNOWN");
    }
  });
});

describe("lookupKeyFor", () => {
  it("az előnézet-kérésnek nincs külső azonosítója: számlaszám szerint keres, szám nélkül sehogy", () => {
    assert.deepEqual(lookupKeyFor("STRAY_PREVIEW", "E-1"), {
      by: "invoiceNumber",
      value: "E-1",
    });
    assert.equal(lookupKeyFor("STRAY_PREVIEW", null), null);
  });
  it("minden más ág a külső azonosítóra keres", () => {
    for (const kind of [
      "RECORDING_FAILED",
      "NO_REPLY",
      "UNCLEAR_REPLY",
      "NO_NOTE",
      "OTHER",
    ] as const)
      assert.deepEqual(lookupKeyFor(kind, "E-1"), { by: "externalId" });
  });
});
