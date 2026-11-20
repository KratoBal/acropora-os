import { describe, expect, it } from "vitest";

import {
  contractItemAmounts,
  isValidContractItem,
  repairFeeSummary,
  repairFeesPayload,
  repairFeesValid,
  repairTotalState,
} from "./contract-items";

/*
  A JAVÍTÁSI DÍJAK (kártya 3d80a18d). MI PIROSÍT: ha egy szóközzel vagy
  tizedesvesszővel beírt szám a szerver számalakja helyett elmegy (400 angolul);
  ha az üres mező üres sztringként megy, nem törlésként; ha betű átmegy; ha az
  adatlap sora a kitöltetlen díjat is kiírja.
*/
describe("a javítási díjak", () => {
  it("a beírt szám a szerver alakjára megy, az üres null", () => {
    expect(
      repairFeesPayload({
        repairFeeWorkdayHours: "9 000",
        repairFeeHoliday: "14500,5",
        repairWeight: "90",
        repairTotal: "",
      }),
    ).toEqual({
      repairFeeWorkdayHours: "9000",
      repairFeeWorkdayOffHours: null,
      repairFeeHoliday: "14500.5",
      repairWeight: "90",
      repairTotal: null,
    });
  });

  it("betű nem szám, a hiányzó és az üres rendben van", () => {
    expect(repairFeesValid({ repairTotal: "10 125 000" })).toBe(true);
    expect(repairFeesValid({ repairTotal: "" })).toBe(true);
    expect(repairFeesValid({})).toBe(true);
    expect(repairFeesValid({ repairWeight: "kilencven" })).toBe(false);
  });

  it("az adatlap sora csak a kitöltöttet mondja, kitöltetlen díjnál nincs sor", () => {
    expect(
      repairFeeSummary(
        {
          repairFeeWorkdayHours: "9000",
          repairWeight: "90",
          repairTotal: null,
        },
        (v) => v,
      ),
    ).toBe("Javítási díjak (nettó): munkaidőben 9000 Ft · súlyszám 90");
    expect(repairFeeSummary({}, (v) => v)).toBeNull();
  });
});

/*
  A TÉTEL SZABÁLYA FAJTÁNKÉNT (hétfői lista M4). MI PIROSÍT: ha a beszerzési
  tétel alkalmat kérne vagy egység nélkül átmenne; ha a karbantartási tétel
  alkalom nélkül átmenne.
*/
describe("a tétel szabálya a szerződés fajtája szerint", () => {
  const base = {
    description: "Tengeri só, 25 kg",
    unitNet: "18000",
    quantity: "4",
    vatRatePercent: "27",
  };
  it("WEB-CONTRACT-ITEM-KIND: beszerzésnél egység kell, karbantartásnál alkalom", () => {
    expect([
      isValidContractItem(
        { ...base, occasionsPerYear: null, unitOfMeasureId: "uom-zsak" },
        "PURCHASE",
      ),
      isValidContractItem(
        { ...base, occasionsPerYear: 4, unitOfMeasureId: null },
        "PURCHASE",
      ),
      isValidContractItem({ ...base, occasionsPerYear: 4 }, "MAINTENANCE"),
      isValidContractItem({ ...base, occasionsPerYear: null }, "MAINTENANCE"),
    ]).toEqual([true, false, true, false]);
  });
});

/*
  A TÉTEL SZÁMOLT ÖSSZEGE (kártya 51898ed9, Luca 450 000 Ft-ja). MI PIROSÍT: ha az alkalom kimarad a szorzatból (a tétel
  összege az éves dij, nem egy alkalomé); ha a beszerzés az alkalommal szorozna; ha az alkalom nélküli javítási tétel nullát vagy
  semmit adna egy helyett; ha a karbantartási tétel az alkalom nélkül is összeget írna; ha a szorzat lebegőpontos (0,1 x 3
  nem 0,3000); ha az ÁFA a nyers, nem a kerekített nettóból számolna (a lap és a kép eltérne); ha a félig beírt mező
  összeget adna; ha az 5. tizedes fele nem felfelé kerekítene.
*/
describe("contractItemAmounts", () => {
  const luca = {
    unitNet: "15000",
    quantity: "10",
    vatRatePercent: "27",
    occasionsPerYear: 3,
  };

  it("Luca tétele: 15 000 x 10 db x 3 alkalom = 450 000 nettó, 571 500 bruttó", () => {
    expect(contractItemAmounts(luca)).toEqual({
      net: "450000.0000",
      vat: "121500.0000",
      gross: "571500.0000",
    });
  });

  it("beszerzésnél az alkalom nem számít, javítási tételnél alkalom nélkül egy, alkalommal szorzó", () => {
    expect(
      contractItemAmounts({ ...luca, occasionsPerYear: null }, "PURCHASE")!.net,
    ).toBe("150000.0000");
    expect(
      contractItemAmounts({ ...luca, occasionsPerYear: 3 }, "PURCHASE")!.net,
    ).toBe("150000.0000");
    expect(
      contractItemAmounts({ ...luca, occasionsPerYear: null }, "REPAIR")!.net,
    ).toBe("150000.0000");
    expect(
      contractItemAmounts({ ...luca, occasionsPerYear: "" }, "REPAIR")!.net,
    ).toBe("150000.0000");
    expect(contractItemAmounts(luca, "REPAIR")!.net).toBe("450000.0000");
  });

  it("karbantartásnál az alkalom nélkül nincs összeg", () => {
    expect(contractItemAmounts({ ...luca, occasionsPerYear: null })).toBeNull();
    expect(contractItemAmounts({ ...luca, occasionsPerYear: "" })).toBeNull();
  });

  it("a félig beírt vagy érvénytelen mező nem ad összeget", () => {
    for (const rossz of [
      { unitNet: "" },
      { unitNet: "abc" },
      { quantity: "1,2,3" },
      { vatRatePercent: "" },
      { occasionsPerYear: 0 },
      { occasionsPerYear: 367 },
      { occasionsPerYear: 1.5 },
      { occasionsPerYear: "x" },
    ])
      expect(
        contractItemAmounts({ ...luca, ...rossz }),
        JSON.stringify(rossz),
      ).toBeNull();
  });

  it("decimálisan pontos, nem lebegőpontos, és a tizedesvessző is jó", () => {
    expect(
      contractItemAmounts({
        ...luca,
        unitNet: "0.1",
        quantity: "3",
        occasionsPerYear: 1,
        vatRatePercent: "0",
      })!.net,
    ).toBe("0.3000");
    expect(
      contractItemAmounts({
        ...luca,
        unitNet: "12,5",
        quantity: "2,5",
        occasionsPerYear: 1,
      })!.net,
    ).toBe("31.2500");
    expect(
      contractItemAmounts({
        ...luca,
        unitNet: "0.1",
        quantity: "0.2",
        occasionsPerYear: 1,
      })!.net,
    ).toBe("0.0200");
  });

  it("négy tizedesre kerekít, félre felfelé, és az ÁFA a kerekített nettóból jön", () => {
    // 33,33335 x 3 = 100,00005: az 5. tizedes 5, tehát felfelé: 100,0001
    const out = contractItemAmounts({
      unitNet: "33.33335",
      quantity: "3",
      vatRatePercent: "27",
      occasionsPerYear: 1,
    })!;
    expect(out.net).toBe("100.0001");
    // 100,0001 x 27% = 27,000027 -> 27,0000 (a nyers 100,00005 x 27% = 27,0000135 is 27,0000, de a kerekített alapból megy)
    expect(out.vat).toBe("27.0000");
    expect(out.gross).toBe("127.0001");
    // 5. tizedes 4: lefelé
    expect(
      contractItemAmounts({
        unitNet: "33.33334",
        quantity: "3",
        vatRatePercent: "0",
        occasionsPerYear: 1,
      })!.net,
    ).toBe("100.0000");
  });

  it("nagy érték sem csúszik el (egész számokkal megy)", () => {
    expect(
      contractItemAmounts({
        unitNet: "999999999.9999",
        quantity: "1000",
        vatRatePercent: "27",
        occasionsPerYear: 366,
      })!.net,
    ).toBe("365999999999963.4000");
  });
});

/*
  A JAVÍTÁSI DÍJAK ÖSSZESEN MEZŐJE (kártya 51898ed9, Balázs). MI PIROSÍT: ha súlyszám nélkül szerkeszthető maradna; ha a
  szóközös "súlyszám" kitöltöttnek számítana; ha a meglévő kézi összeg mellől hiányozna a megmaradását kimondó mondat; ha súlyszámmal
  tiltott lenne.
*/
describe("repairTotalState", () => {
  it("súlyszám nélkül tiltott, és mondja, miért", () => {
    for (const weight of [undefined, null, "", "   "]) {
      const state = repairTotalState({ repairWeight: weight });
      expect(state.editable).toBe(false);
      expect(state.hint).toMatch(/Súlyszám nélkül/);
    }
  });

  it("a meglévő kézi összeg mellett a megmaradását is kimondja", () => {
    const state = repairTotalState({ repairWeight: "", repairTotal: "450000" });
    expect(state.editable).toBe(false);
    expect(state.hint).toMatch(/megmarad/);
  });

  it("súlyszámmal szerkeszthető, magyarázat nélkül", () => {
    expect(
      repairTotalState({ repairWeight: "90", repairTotal: "10125000" }),
    ).toEqual({
      editable: true,
      hint: null,
    });
  });
});
