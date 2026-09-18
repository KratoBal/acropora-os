import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import type { WorksheetDetail, WorksheetVersionDetail } from "@acropora/types";

import { worksheetSheetLines } from "./worksheet-sheet-content.js";
import { worksheetSheetInput } from "./worksheet-sheet-mapping.js";

function version(
  overrides: Partial<WorksheetVersionDetail> = {},
): WorksheetVersionDetail {
  return {
    id: "version-1",
    version: 1,
    label: "BIO-2026-001/1",
    status: "AWAITING_SIGNATURE",
    changeReason: null,
    createdByName: "Szerelő Sándor",
    createdAt: "2026-08-27T08:00:00.000Z",
    closedAt: "2026-09-17T20:00:00.000Z",
    closedByName: "Szerelő Sándor",
    netAmount: "30000",
    vatAmount: "8100",
    grossAmount: "38100",
    laborHours: "2",
    signature: null,
    subject: "Kompresszorok bevizsgálása",
    unitName: "Cápasuli",
    description: null,
    issueDate: "2026-08-27",
    fulfillmentDate: "2026-08-27",
    dueDate: "2026-09-30",
    currency: "HUF",
    lines: [
      {
        id: "line-1",
        position: 1,
        description: "Kompresszor bevizsgálás",
        detail: null,
        assetId: "asset-1",
        assetNumber: "ESZK-000123",
        inventoryNumber: "UGYFEL-42",
        quantity: "2",
        unit: "óra",
        kind: "LABOR",
        workerCount: 1,
        laborHours: "2",
        unitNet: "15000",
        vatRatePercent: "27",
        netAmount: "30000",
        vatAmount: "8100",
        grossAmount: "38100",
      },
    ],
    ...overrides,
  } as WorksheetVersionDetail;
}

function detail(overrides: Partial<WorksheetDetail> = {}): WorksheetDetail {
  return {
    id: "worksheet-1",
    number: "BIO-2026-001",
    numberYear: 2026,
    sequence: 1,
    customer: {
      id: "customer-1",
      customerNumber: "VEVO-A",
      displayName: "Fánk Kft.",
      worksheetPartnerCode: "FNK",
    },
    department: {
      id: "department-1",
      parentId: null,
      code: "BIO",
      name: "Biodóm",
      path: "Biodóm",
      isActive: true,
    },
    createdByName: "Szerelő Sándor",
    serviceJob: { id: "job-1", jobNumber: "HJ-2026-0007" },
    assignees: [
      { userId: "user-1", name: "Kovács Anna", assignedAt: "2026-08-27" },
    ],
    assets: [],
    createdAt: "2026-08-27T08:00:00.000Z",
    updatedAt: "2026-09-17T20:00:00.000Z",
    continues: null,
    continuedBy: [],
    currentVersion: version(),
    versions: [],
    ...overrides,
  } as WorksheetDetail;
}

describe("a válaszból a lap bemenete", () => {
  it("a lap minden mezője a HELYES forrásból jön", () => {
    const input = worksheetSheetInput(detail(), version(), []);

    assert.equal(input.label, "BIO-2026-001/1");
    assert.equal(input.customerName, "Fánk Kft.");
    assert.equal(input.customerNumber, "VEVO-A");
    assert.equal(input.departmentName, "Biodóm");
    assert.equal(input.departmentCode, "BIO");
    assert.equal(input.subject, "Kompresszorok bevizsgálása");
    assert.equal(input.laborHours, "2");
  });

  it("a felelősöknél a NEVÜK megy át, nem az azonosítójuk", () => {
    /*
      MI PIROSÍT: egy `assignee.userId` elírás. A lapon akkor egy belső azonosító
      állna a szerelő neve helyett -- a vevő kezében, és semmi nem szólna róla,
      mert mind a kettő szöveg.
    */
    const input = worksheetSheetInput(detail(), version(), []);
    assert.deepEqual(input.assigneeNames, ["Kovács Anna"]);
  });

  it("az előzmény-lapból a SZÁM megy át, nem az azonosító", () => {
    const input = worksheetSheetInput(
      detail({ continues: { id: "worksheet-0", number: "BIO-2026-000" } }),
      version(),
      [],
    );
    assert.equal(input.continuesLabel, "BIO-2026-000");
  });

  /**
   * A HIBAJEGY SZAMA AKKOR SEM KERUL AT, HA A VALASZ HORDOZZA.
   *
   * EZ AZ ALLITAS MEGFORDULT 2026-09-18-KOR. Korabban azt merte, hogy a szam
   * atmegy; azota dontes all rola (acrobot, 10:56): a lezart laphoz utolag is
   * csatolhato jegy, tehat ez lenne az egyetlen mezo, ami a fagyasztas utan is
   * mozdulhat.
   *
   * ES A FIXTURA SZANDEKOSAN TARTALMAZZA a `serviceJob`-ot: epp az a lenyeg,
   * hogy a valasz HORDOZZA, es a lekepezes MEGSEM viszi at. Egy `serviceJob:
   * null` fixturan ez az allitas akkor is zold lenne, ha a lekepezes atvinne.
   */
  it("a hibajegy száma NEM megy át, pedig a válaszban ott áll", () => {
    const teljes = detail();
    assert.ok(teljes.serviceJob?.jobNumber, "a fixtúra előfeltétele: van jegy");

    const input = worksheetSheetInput(teljes, version(), []);
    assert.equal("jobNumber" in input, false);
    // ISMERT POZITIV KONTROLL: a tobbi mezo ATMEGY, tehat nem egy ures
    // objektumot merunk.
    assert.equal(input.customerName, "Fánk Kft.");
  });

  it("a napló KÜLÖN paraméterként érkezik, és átmegy", () => {
    /*
      A `WorksheetDetail` NEM hordozza a naplót (mérve 2026-09-17: a típus
      tizenhat mezője között nincs `entries`), Balázs viszont 22:49:52-kor úgy
      döntött, hogy rákerül a lapra. A külön paraméter teszi láthatóvá a hívó
      helyén, hogy egy MÁSODIK lekérdezés kell hozzá.
    */
    const input = worksheetSheetInput(detail(), version(), [
      "Szivattyú zajos.",
    ]);
    assert.deepEqual(input.entries, ["Szivattyú zajos."]);
  });

  it("ÁR-MEZŐ egyetlen úton sem szivárog át", () => {
    /*
      A forrás-típus VISZI az árat (`unitNet`, `netAmount`, `grossAmount`, a
      verzión és a tételen is), a lap bemenete pedig nem. Ez az állítás azt méri,
      hogy a leképezés nem hoz át semmit belőlük -- a lap tartalma önmagában ezt
      nem tudná megmondani, mert a fixtúrája eleve ár nélküli.
    */
    const input = worksheetSheetInput(detail(), version(), []);
    const kulcsok = [
      ...Object.keys(input),
      ...Object.keys(input.lines[0] ?? {}),
    ];

    for (const tiltott of [
      "unitNet",
      "vatRatePercent",
      "netAmount",
      "vatAmount",
      "grossAmount",
      "currency",
      "dueDate",
    ])
      assert.equal(
        kulcsok.includes(tiltott),
        false,
        `ár-mező a lap bemenetében: ${tiltott}`,
      );

    // ISMERT POZITÍV KONTROLL: a fenti hét nulla nem egy üres objektumról szól.
    assert.ok(kulcsok.includes("laborHours"));
    assert.ok(kulcsok.includes("quantity"));
  });

  it("a teljes lap valóban elkészül belőle", () => {
    /*
      A leképezés és a tartalom KÜLÖN romlik el: az egyik rossz mezőt olvas, a
      másik rossz sorrendben rajzol. Ez az egy állítás a kettőt EGYÜTT járja be,
      hogy a varrat se maradjon mérés nélkül.
    */
    const lap = worksheetSheetLines(
      worksheetSheetInput(detail(), version(), ["Szivattyú zajos."]),
    ).join("\n");

    assert.match(lap, /MUNKALAP {2}BIO-2026-001\/1/);
    assert.match(lap, /Partner: Fánk Kft\. \(VEVO-A\)/);
    assert.match(lap, /Eszköz: ESZK-000123/);
    assert.match(lap, /Leltári szám: UGYFEL-42/);
    assert.match(lap, /Dolgozott rajta: Kovács Anna/);
    assert.match(lap, /- Szivattyú zajos\./);
    assert.match(lap, /Összes munkaóra: 2/);
  });
});

describe("szám nélküli piszkozat is kap lapot", () => {
  it("a fejléc kimondja, hogy még nincs száma", () => {
    /*
      A munkalapszámot a LEZÁRÁS foglalja le (a `close()` a tranzakcióban, ha még
      nincs). Egy piszkozat tehát szám nélkül áll -- és piszkozat is kap lapot.

      MI PIROSÍT: a nyers behelyettesítés. A `${null}` „MUNKALAP null"-t írna a
      vevő lapjára; az üresen hagyás pedig azt sugallná, hogy elveszett a szám,
      holott még meg sem született.
    */
    const lap = worksheetSheetLines(
      worksheetSheetInput(
        detail(),
        version({ label: null, status: "DRAFT" }),
        [],
      ),
    );

    assert.equal(lap.includes("MUNKALAP  null"), false);
    assert.match(lap.join("\n"), /MUNKALAP {2}\(még nincs száma\)/);
    // ISMERT POZITÍV KONTROLL: piszkozat, tehát a jelölés is ott áll.
    assert.match(lap[0] ?? "", /PISZKOZAT/);
  });
});

describe("a leképezés minden mezőt kiolvas", () => {
  it("a lap bemenetének EGYETLEN mezője sem marad kitöltetlen", () => {
    /*
      === MIÉRT NEM ELÉG A FENTI MEZŐNKÉNTI ÁLLÍTÁS ===

      Azok azt mérik, hogy a KIOLVASOTT mezők a helyes forrásból jönnek. Azt NEM,
      hogy MINDET kiolvassuk: egy új mező a lap bemenetében (a mezőhalmaz-őrző
      átengedi, ha a döntés megvan) itt csendben `undefined` maradna, és a lapon
      egy sor egyszerűen hiányozna.

      Ez az állítás a NEVEZŐT méri: a bemeneti típus mezőinek számát a ténylegesen
      kitöltöttekéhez.
    */
    const forras = readFileSync(
      "src/worksheets/worksheet-sheet-content.ts",
      "utf8",
    );
    const blokk = /export interface WorksheetSheetInput \{([\s\S]*?)\n\}/.exec(
      forras,
    );
    if (!blokk) throw new Error("nincs WorksheetSheetInput a forrásban");
    const varhato = [...(blokk[1] ?? "").matchAll(/^ {2}(\w+)\??:/gm)]
      .map((m) => m[1])
      .filter((nev): nev is string => Boolean(nev));
    assert.ok(
      varhato.length > 10,
      "gyanúsan kevés mezőt olvastam ki a típusból",
    );

    const input = worksheetSheetInput(detail(), version(), ["napló"]);
    const hianyzo = varhato.filter((mezo) => !(mezo in input));

    assert.deepEqual(
      hianyzo,
      [],
      `a leképezés nem tölti ki: ${hianyzo.join(", ")}`,
    );
  });
});
