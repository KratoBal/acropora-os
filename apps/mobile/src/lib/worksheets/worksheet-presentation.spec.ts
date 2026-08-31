import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  formatWorksheetAmount,
  formatWorksheetDate,
  formatWorksheetQuantity,
  worksheetAssigneeLine,
  worksheetDetailRows,
  worksheetLabelOrDraft,
  worksheetLineSummary,
  worksheetListSubtitle,
  worksheetStatusLabel,
  worksheetFilterSummary,
  worksheetVersionNote,
  WORKSHEET_STATUS_FILTERS,
} from "./worksheet-presentation";
import type {
  WorksheetDetailLike,
  WorksheetLineLike,
  WorksheetListLike,
} from "./worksheet-presentation";

/**
 * A KIMONDOTT HIÁNY A TÉT.
 *
 * A szerelő a helyszínen abból dolgozik, ami a képernyőn van. A munkalapon két
 * hiány maga az információ: a piszkozatnak nincs száma, és a lap lehet
 * kiosztatlan. Ha ezek üres helyként jelennének meg, a helyszínen az a kérdés
 * születne, hogy „miért nem töltődött be" -- és az irodát hívná valaki egy
 * szabály miatt.
 *
 * A PÉNZ- ÉS SZÁMFORMÁTUM elválasztó karaktere futtatókörnyezet szerint
 * eltérhet (törhetetlen szóköz, keskeny törhetetlen szóköz), ezért az
 * összehasonlítás előtt normalizálunk. Ami itt mérve van, az a TARTALOM: a
 * tizedesek eltűnése, a pénznem jele, és hogy az értelmezhetetlen érték nyersen
 * marad. A pontos szóköz-fajtára állítani annyi lenne, mint a Node
 * verziójától zöldülő tesztet írni.
 */
function spaces(value: string): string {
  return value.replace(/[  ]/g, " ");
}

/**
 * A PRÓBAADAT CSAK ANNYIT TARTALMAZ, AMENNYIT EZ A MODUL OLVAS. A szerver
 * válasza ennél bővebb (`lib/api/worksheets.ts`), és pont ez a lényeg: ami a
 * megjelenítés döntéseihez kell, az itt együtt látszik.
 */
const line: WorksheetLineLike = {
  quantity: "2.000000",
  unit: "db",
  grossAmount: "38100.0000",
};

const listItem: WorksheetListLike = {
  number: "BIO-2026-001",
  label: "BIO-2026-001",
  customerName: "Fánk Kft.",
  departmentCode: "BIO",
  status: "AWAITING_SIGNATURE",
  version: 1,
  versionCount: 1,
  assigneeNames: ["Kovács Anna"],
};

const worksheet: WorksheetDetailLike = {
  customer: { displayName: "Fánk Kft." },
  department: { code: "BIO", name: "Biodóm" },
  createdByName: "Szabó Péter",
  currentVersion: {
    unitName: "Biodóm",
    issueDate: "2026-08-26T00:00:00.000Z",
    fulfillmentDate: null,
    dueDate: null,
  },
};

describe("worksheetLabelOrDraft", () => {
  it("says the draft has no number yet instead of leaving the place empty", () => {
    assert.equal(worksheetLabelOrDraft(null), "Még nincs száma");
  });

  it("keeps the number the server gave", () => {
    assert.equal(worksheetLabelOrDraft("BIO-2026-001/2"), "BIO-2026-001/2");
  });
});

describe("worksheetStatusLabel", () => {
  /**
   * MIND A NÉGY ÁLLAPOT SZEREPEL, és ugyanazokkal a szavakkal, mint a webes
   * felületen (`apps/web/src/components/worksheets/worksheet-labels.ts`). A két
   * lista két fájlban áll, mert az Expo app nem húzza be a munkatér csomagjait;
   * az elcsúszásuk néma lenne, és a helyszínen derülne ki, hogy az iroda más
   * szót mond ugyanarra a lapra.
   */
  it("names every status the server can return", () => {
    assert.deepEqual(worksheetStatusLabel, {
      DRAFT: "Piszkozat",
      AWAITING_SIGNATURE: "Aláírásra vár",
      SIGNED: "Aláírva",
      REJECTED: "Elutasítva",
    });
  });
});

describe("worksheetAssigneeLine", () => {
  it("says out loud that nobody is assigned", () => {
    assert.equal(worksheetAssigneeLine([]), "Nincs kiosztva");
  });

  it("treats a blank name as no name at all", () => {
    assert.equal(worksheetAssigneeLine(["   "]), "Nincs kiosztva");
  });

  it("lists everyone responsible, in the order the server sent them", () => {
    assert.equal(
      worksheetAssigneeLine(["Kovács Anna", "Nagy Béla"]),
      "Kovács Anna, Nagy Béla",
    );
  });
});

describe("worksheetListSubtitle", () => {
  it("names the partner and the unit, not the number", () => {
    assert.equal(worksheetListSubtitle(listItem), "Fánk Kft. · BIO");
  });

  it("leaves out the separator when the unit code is missing", () => {
    assert.equal(
      worksheetListSubtitle({ ...listItem, departmentCode: "" }),
      "Fánk Kft.",
    );
  });
});

describe("worksheetVersionNote", () => {
  it("stays silent while there is only one version", () => {
    assert.equal(worksheetVersionNote(listItem), "");
  });

  /**
   * Ez a sor azért van, hogy a helyszínen kiderüljön: a kézben lévő papír lehet
   * a RÉGI változat. Ha csak a mai állapot látszana, semmi nem szólna arról,
   * hogy a lapot időközben átírták.
   */
  it("says which version this is once the sheet has been amended", () => {
    assert.equal(
      worksheetVersionNote({ ...listItem, version: 2, versionCount: 3 }),
      "2. változat, összesen 3",
    );
  });
});

describe("formatWorksheetAmount", () => {
  it("writes forint without decimals", () => {
    assert.equal(spaces(formatWorksheetAmount("38100.0000")), "38 100 Ft");
  });

  it("keeps another currency's code next to the number", () => {
    assert.equal(spaces(formatWorksheetAmount("120.00", "EUR")), "120 EUR");
  });

  /**
   * Az összeg SZÖVEGKÉNT jön az API-ból. Ha egyszer olyan érték érkezik, amit
   * nem tudunk számmá alakítani, a nyers érték kimegy a képernyőre -- "NaN Ft"
   * a szerelő kezében rosszabb, mint egy furcsa, de igaz szám.
   */
  it("prints an unreadable amount as it came, never as NaN", () => {
    assert.equal(formatWorksheetAmount("nem szám"), "nem szám");
  });
});

describe("formatWorksheetQuantity", () => {
  it("drops the stored decimals nobody typed", () => {
    assert.equal(formatWorksheetQuantity("2.000000"), "2");
  });

  it("keeps a decimal that carries meaning", () => {
    assert.equal(spaces(formatWorksheetQuantity("0.500000")), "0,5");
  });
});

describe("formatWorksheetDate", () => {
  it("keeps the day and drops the clock", () => {
    assert.equal(formatWorksheetDate("2026-08-26T00:00:00.000Z"), "2026-08-26");
  });

  it("gives an empty string for a missing date, so the row can be left out", () => {
    assert.equal(formatWorksheetDate(null), "");
  });
});

describe("worksheetLineSummary", () => {
  it("shows what was done in what quantity, and what it costs", () => {
    assert.equal(spaces(worksheetLineSummary(line)), "2 db · 38 100 Ft");
  });
});

describe("worksheetDetailRows", () => {
  it("names the partner and the place first", () => {
    const rows = worksheetDetailRows(worksheet);

    assert.deepEqual(rows[0], { label: "Partner", value: "Fánk Kft." });
    assert.deepEqual(rows[1], { label: "Helyszín", value: "Biodóm · BIO" });
  });

  /**
   * A HIÁNYZÓ DÁTUM NEM LESZ SOR. Ez a lap másik fele: a szám és a felelős
   * hiánya kimondott, egy ki nem töltött teljesítési dátum viszont csak zaj
   * lenne a helyszínen.
   */
  it("leaves out the dates nobody filled in", () => {
    const labels = worksheetDetailRows(worksheet).map((row) => row.label);

    assert.equal(labels.includes("Kiállítva"), true);
    assert.equal(labels.includes("Teljesítve"), false);
    assert.equal(labels.includes("Fizetési határidő"), false);
  });

  /**
   * A HELYSZÍN NEVE A VERZIÓBÓL JÖN, nem az alegység mai nevéből: a lezárt
   * lapon annak kell állnia, ahogy a kiírásakor szólt. Ha a verzió nem hordoz
   * nevet (régi lap), az alegység mai neve az egyetlen, amit mondhatunk.
   */
  it("shows the unit name the version was written with", () => {
    const renamed = worksheetDetailRows({
      ...worksheet,
      department: { ...worksheet.department, name: "Biodóm (új név)" },
      currentVersion: { ...worksheet.currentVersion, unitName: "Biodóm" },
    });

    assert.deepEqual(renamed[1], { label: "Helyszín", value: "Biodóm · BIO" });

    const withoutVersionName = worksheetDetailRows({
      ...worksheet,
      department: { ...worksheet.department, name: "Biodóm (új név)" },
      currentVersion: { ...worksheet.currentVersion, unitName: null },
    });

    assert.deepEqual(withoutVersionName[1], {
      label: "Helyszín",
      value: "Biodóm (új név) · BIO",
    });
  });
});

describe("WORKSHEET_STATUS_FILTERS", () => {
  it("offers every status the server knows, with Mind first", () => {
    assert.deepEqual(
      WORKSHEET_STATUS_FILTERS.map((filter) => filter.value),
      [null, "DRAFT", "AWAITING_SIGNATURE", "SIGNED", "REJECTED"],
    );
  });

  /**
   * UGYANAZOK A SZAVAK, mint a listán és a weben. Ha a szűrő „Piszkozat"-ot
   * mond, és a sor „Vázlat"-ot, a szerelő két állapotot lát ott, ahol egy van.
   */
  it("labels them exactly as the rows do", () => {
    for (const filter of WORKSHEET_STATUS_FILTERS)
      if (filter.value)
        assert.equal(filter.label, worksheetStatusLabel[filter.value]);
  });
});

describe("worksheetFilterSummary", () => {
  /**
   * HÁROM SZŰRŐ MIND SZŰKÍT, és egy üres lista elől a szerelőnek tudnia kell,
   * hogy nincs ilyen lap, vagy csak túl szűkre állította magának.
   */
  it("names the whole set, not just one filter", () => {
    assert.equal(
      worksheetFilterSummary({
        mineOnly: true,
        partnerName: "Fánk Kft.",
        status: "AWAITING_SIGNATURE",
      }),
      "Rád kiosztva · Fánk Kft. · Aláírásra vár",
    );
  });

  it("says so when nothing is narrowed", () => {
    assert.equal(
      worksheetFilterSummary({ mineOnly: false }),
      "Minden munkalap",
    );
  });

  it("carries the search text too, because that narrows as well", () => {
    assert.match(
      worksheetFilterSummary({ mineOnly: false, search: "  szivattyú " }),
      /szivattyú/,
    );
  });

  it("ignores a blank partner name and a blank search", () => {
    assert.equal(
      worksheetFilterSummary({
        mineOnly: false,
        partnerName: "   ",
        search: "  ",
      }),
      "Minden munkalap",
    );
  });
});
