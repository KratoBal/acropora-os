import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CONTRACT_JOB_TITLE_MAX,
  contractJobTitle,
  separateContractJobTitle,
} from "./contract-job-title.js";

/**
 * A KARBANTARTÁSI LAP CÍME ÁTHÚZÁSKOR (kártya 17e6fcf2). MI PIROSÍT: ha az üres vagy szóközös cím nem a tétel
 * megnevezésére esne vissza (és nem a szerződés címére); ha a kifejezett cím elveszne; ha több tételnél a szám
 * rossz (az első tétel nem számít bele a „még"-be); ha a hosszú megnevezés átlépné a 300 karaktert (az API
 * mezőhatára); ha a külön lapok közös címet kapnának.
 */
const item = (description: string) => ({ description });

describe("contractJobTitle", () => {
  it("egy tételnél a tétel megnevezése", () => {
    assert.equal(
      contractJobTitle({
        explicit: undefined,
        contractTitle: "Szerződés",
        items: [item("Cápasuli nagymedence (690m3) gépészet")],
      }),
      "Cápasuli nagymedence (690m3) gépészet",
    );
  });

  it("az üres és a szóközös cím nem kifejezett cím", () => {
    for (const explicit of ["", "   ", null, undefined])
      assert.equal(
        contractJobTitle({
          explicit,
          contractTitle: "Szerződés",
          items: [item("Tétel")],
        }),
        "Tétel",
      );
  });

  it("a kifejezett cím előbb áll, levágva a szóközöktől", () => {
    assert.equal(
      contractJobTitle({
        explicit: "  Téli  ",
        contractTitle: "Szerződés",
        items: [item("Tétel")],
      }),
      "Téli",
    );
  });

  it("több tételnél az első és az „és még N tétel”", () => {
    assert.equal(
      contractJobTitle({
        explicit: undefined,
        contractTitle: "Szerződés",
        items: [item("A"), item("B"), item("C")],
      }),
      "A és még 2 tétel",
    );
  });

  it("megnevezés nélküli tételnél a szerződés címe marad", () => {
    assert.equal(
      contractJobTitle({
        explicit: undefined,
        contractTitle: "Szerződés",
        items: [item("  ")],
      }),
      "Szerződés",
    );
  });

  it("a hosszú megnevezés a mezőhatáron belül marad, a toldalékkal együtt is", () => {
    const hosszu = "x".repeat(400);
    const egy = contractJobTitle({
      explicit: undefined,
      contractTitle: "S",
      items: [item(hosszu)],
    });
    const tobb = contractJobTitle({
      explicit: undefined,
      contractTitle: "S",
      items: [item(hosszu), item("B")],
    });
    assert.equal(egy.length, CONTRACT_JOB_TITLE_MAX);
    assert.ok(tobb.length <= CONTRACT_JOB_TITLE_MAX);
    assert.ok(tobb.endsWith(" és még 1 tétel"));
  });
});

describe("separateContractJobTitle", () => {
  it("cím nélkül a saját tétel megnevezése", () => {
    assert.equal(
      separateContractJobTitle({
        explicit: undefined,
        contractTitle: "S",
        item: item("UV-lámpa csere"),
      }),
      "UV-lámpa csere",
    );
  });

  it("kifejezett címmel a cím és a tétel, kettősponttal (a régi alak)", () => {
    assert.equal(
      separateContractJobTitle({
        explicit: "Téli",
        contractTitle: "S",
        item: item("UV-lámpa csere"),
      }),
      "Téli: UV-lámpa csere",
    );
  });
});
