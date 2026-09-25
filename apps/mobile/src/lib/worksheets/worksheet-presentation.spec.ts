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
  worksheetStatusTone,
  worksheetFilterSummary,
  worksheetListStartsMineOnly,
  worksheetVersionNote,
  WORKSHEET_STATUS_FILTERS,
} from "./worksheet-presentation";
import type {
  WorksheetDetailLike,
  WorksheetLineLike,
  WorksheetListLike,
} from "./worksheet-presentation";
import type { UserRole } from "../auth/types";
import { recordLiteralFromSource } from "../testing/record-literal-from-source";

/**
 * A KIMONDOTT HIÁNY A TÉT.
 *
 * A szerelő a helyszínen abból dolgozik, ami a képernyőn van. A munkalapon
 * HÁROM hiány maga az információ: a piszkozatnak nincs száma, a lap lehet
 * kiosztatlan, és állhat hibajegy nélkül. Ha ezek üres helyként jelennének meg,
 * a helyszínen az a kérdés születne, hogy „miért nem töltődött be" -- és az
 * irodát hívná valaki egy szabály miatt.
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
  /*
    A PROBAADAT NEM-MUNKA TETEL, es ez SZANDEKOS: az egysege "db", tehat a
    munkaora rajta ertelmetlen lenne. Igy a lenti allitasok a mennyiseg-sort
    merik, nem a munkaorat -- arra kulon fixturak allnak.
  */
  kind: "OTHER",
  workerCount: 1,
  laborHours: "0",
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
  serviceJob: { id: "job-7", jobNumber: "HJ-2026-007" },
  // ALAPBOL NALUNK VAN AZ ESZKOZ: ez a lap eletenek nagy resze. Ami a masik
  // allapotot meri, az a hivas helyen allitja be.
  handedOverAt: null,
  handedOverByName: null,
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
   * A KORÁBBI ALAK ÖNHIVATKOZÓ VOLT: ugyanazt a négy értéket írta be
   * elvárásként, amit a modul maga is tartalmaz -- ez a modul BELSŐ
   * konzisztenciáját mérte, a `packages/types` forrással való egyezést nem.
   * Mostantól a KÖZÖS forrást (`packages/types/src/worksheet-management.ts`)
   * olvassuk be szövegként, ugyanazzal a mintával, mint
   * `asset-status.spec.ts`.
   */
  it("names every status the server can return, matching the common source", () => {
    const kozos = recordLiteralFromSource(
      "../../packages/types/src/worksheet-management.ts",
      "worksheetStatusLabel",
    );
    assert.deepEqual(worksheetStatusLabel, kozos);
  });
});

/**
 * SZÁNDÉKOSAN NINCS FORRÁS-EGYEZTETŐ ŐRZŐ, MINT A CÍMKÉN: ez a táblázat NEM
 * a `packages/types` kanonikus `worksheetStatusTone`-jának másolata (az
 * `SIGNED`-re "green"-t adna, amit a mobil témakészlet nem ismer), hanem a
 * mobil négy tokenjéhez SZÁNDÉKOSAN igazított, önálló döntés (acrobot,
 * 2026-09-26). Az állítás ezért a NÉGY ÁLLAPOT-NÉGY TOKEN megfeleltetést
 * méri, nem egy külső forrással való egyezést.
 */
describe("worksheetStatusTone", () => {
  it("minden állapothoz pontosan egy, megkülönböztethető tónust rendel", () => {
    assert.equal(worksheetStatusTone("DRAFT"), "neutral");
    assert.equal(worksheetStatusTone("AWAITING_SIGNATURE"), "warning");
    assert.equal(worksheetStatusTone("SIGNED"), "accent");
    assert.equal(worksheetStatusTone("REJECTED"), "danger");
  });

  it("nincs két állapot, ami ugyanazt a tónust kapná", () => {
    const statuses = Object.keys(
      worksheetStatusLabel,
    ) as (keyof typeof worksheetStatusLabel)[];
    const tones = statuses.map((status) => worksheetStatusTone(status));
    assert.equal(new Set(tones).size, statuses.length);
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
  /**
   * A BRUTTO OSSZEG 2026-09-17 OTA NINCS A SORBAN -- es ez Balazs dontese.
   *
   * Itt korabban az allt, hogy a sor megmondja, "mit vegeztek, mennyit, es
   * mennyibe kerul". Az ar-resz targytalan lett: a mezok sehol nem jelennek
   * meg, sem a weben, sem az appban.
   *
   * MIERT NEM TOROLTEM, HANEM MEGFORDITOTTAM: egy torolt teszt utan semmi nem
   * mondana meg, hogy a viselkedes MEGVALTOZOTT, es nem elfelejtettuk.
   */
  it("megmondja, mit vegeztek es mennyit -- arat NEM", () => {
    assert.equal(spaces(worksheetLineSummary(line)), "2 db");
  });

  /**
   * ES A TILTO ALLITAS KULON, NEV SZERINT. Az elozo allitas egy URES
   * visszateres mellett is teljesulne ("2 db" helyett semmi), tehat az
   * onmagaban nem mondja meg, hogy epp az AR tunt el.
   */
  it("a brutto osszeg SEHOL nem all a sorban", () => {
    const sor = worksheetLineSummary(line);

    assert.equal(sor.includes("38"), false, `ar-nyom a sorban: ${sor}`);
    assert.equal(sor.includes("Ft"), false, `penznem a sorban: ${sor}`);
    // ISMERT POZITIV KONTROLL: a sor egyaltalan nem ures.
    assert.ok(sor.length > 0, "a sor ures -- akkor nem az arat mertuk");
  });

  /**
   * A MUNKAORA A SORBAN (2026-09-17, Balazs kerese).
   *
   * Szo szerint: "ha egy tetel 0.5 ora de ketten dolgoztak rajta akkor az 1
   * ora". A ket allitas EZT a mondatot meri, ket iranyban.
   */
  const munka = {
    quantity: "0.500000",
    unit: "óra",
    grossAmount: "0",
    kind: "LABOR" as const,
  };

  it("KETTEN dolgoztak rajta: kiírja a létszámot és a munkaórát", () => {
    assert.equal(
      spaces(
        worksheetLineSummary({ ...munka, workerCount: 2, laborHours: "1" }),
      ),
      "0,5 óra · 2 fő · 1 munkaóra",
    );
  });

  it("EGY fő esetén NEM ismétli meg ugyanazt a számot", () => {
    /*
      MI PIROSIT: egy olyan valtozat, ami mindig kiirja a munkaorat. Akkor a
      sor "0,5 óra · 0,5 munkaóra" lenne -- ugyanaz a szam ketszer, ket
      kulonbozo nevvel, es az olvaso azt kerdezne, mi a kulonbseg.

      ES A FELTETEL NEM A KEPLETRE EPUL (hogy egy fonel a ketto egyenlo), hanem
      a ket ERTEK osszevetesere: ha a szerver keplete valaha valtozik, ez a sor
      magatol kiirja a kulonbseget.
    */
    assert.equal(
      spaces(
        worksheetLineSummary({ ...munka, workerCount: 1, laborHours: "0.5" }),
      ),
      "0,5 óra",
    );
  });

  it("a NEM-munka tételnél munkaóra SEHOL nem áll", () => {
    /*
      A szerver az `OTHER` tetelre "0"-t kuld (a hiany es a nulla igy nem
      keveredik a szamolasban). A SORBAN viszont a "0 munkaóra" allitasnak
      latszana: ugy nezne ki, mintha valaki nulla orat dolgozott volna rajta.
    */
    const sor = worksheetLineSummary({
      quantity: "2.000000",
      unit: "db",
      grossAmount: "0",
      kind: "OTHER",
      workerCount: 3,
      laborHours: "0",
    });

    assert.equal(spaces(sor), "2 db");
    assert.equal(sor.includes("fő"), false, `letszam a sorban: ${sor}`);
  });
});

describe("worksheetDetailRows", () => {
  it("names the partner and the place first", () => {
    const rows = worksheetDetailRows(worksheet);

    assert.deepEqual(rows[0], { label: "Partner", value: "Fánk Kft." });
    assert.deepEqual(rows[1], { label: "Helyszín", value: "Biodóm · BIO" });
  });

  /**
   * A HIBAJEGY SORA MINDIG OTT ÁLL, mert a hiánya is állítás: hibajegy nélkül
   * a lapot nem lehet lezárni. A telefon eddig ezt NEM mutatta -- nem azért,
   * mert a szerver nem küldte, hanem mert a mobil típusából hiányzott a mező.
   */
  it("names the ticket the sheet belongs to", () => {
    const ticket = worksheetDetailRows(worksheet).find(
      (row) => row.label === "Hibajegy",
    );

    /*
      A `serviceJobId` 2026-09-21 OTA RESZE A SORNAK: ebbol tudja a kepernyo,
      hogy ATKATTINTHATOT rajzoljon. A `deepEqual` itt nem kenyelem -- egy
      mezonkenti allitas mellett egy VELETLENUL bekerult tovabbi mezo (peldaul
      egy belso azonosito) csendben atmenne.
    */
    assert.deepEqual(ticket, {
      label: "Hibajegy",
      value: "HJ-2026-007",
      serviceJobId: "job-7",
    });
  });

  it("says out loud when there is no ticket behind the sheet", () => {
    /*
      MI PIROSIT: a sor `if` moge tetele. Akkor a hibajegy nelkuli lapon
      egyszeruen nem lenne sor -- es a szerelo nem tudna meg, miert nem
      zarhato le a lap. A szoveg a webes lape, hogy ket helyen ne ket
      kulonbozo mondat alljon ugyanarrol.
    */
    const ticket = worksheetDetailRows({ ...worksheet, serviceJob: null }).find(
      (row) => row.label === "Hibajegy",
    );

    /*
      ES EZ AZ ALLITAS EGYBEN AZT IS ORZI, HOGY A SOR NEM NEZ KI GOMBNAK.

      A `deepEqual` PONTOSAN ket mezot enged: ha a `serviceJobId` ide is
      bekerulne, a kepernyo megnyomhatot rajzolna egy olyan sorra, ami sehova
      nem visz. Ezt nem kellett kulon allitassal potolni -- a teljes
      objektum-egyezes mar meri.
    */
    assert.deepEqual(ticket, {
      label: "Hibajegy",
      value: "Nincs mögötte hibajegy",
    });
  });

  /**
   * A HIÁNYZÓ DÁTUM NEM LESZ SOR. Ez a lap másik fele: a szám és a felelős
   * hiánya kimondott, egy ki nem töltött teljesítési dátum viszont csak zaj
   * lenne a helyszínen.
   */
  it("leaves out the dates nobody filled in", () => {
    const labels = worksheetDetailRows(worksheet).map((row) => row.label);

    assert.equal(labels.includes("Keltezés"), true);
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
  it("offers every status the server knows, with Összes first", () => {
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

describe("worksheetListStartsMineOnly", () => {
  /**
   * BALÁZS KÉRÉSE, 2026-09-17: „a szűrésnél a minden munkalap legyen az
   * alapértelmezett". Előtte a `SERVICE` szerepkör a saját lapjaival indult.
   *
   * MINDEN SZEREPKÖR FELSOROLVA, NEM CSAK A `SERVICE`. Ha csak azt az egyet
   * néznénk, egy MÁSIK szerepkörre visszaírt szűkítés csendben átmenne -- és
   * pont az a fajta, amit senki nem próbál ki a telefonon.
   *
   * A LISTA A FORDÍTÓTÓL JÖN, NEM KÉZBŐL: a `Record<UserRole, true>` alak
   * miatt egy ÚJ szerepkör felvétele fordítási hibát ad itt, nem pedig
   * csendben kimarad a körből. (Ugyanaz az idióma, mint a
   * `webshop-authorization.ts` `ROLE_CAPABILITIES` táblája.)
   */
  const MIND_TABLA: Record<UserRole, true> = {
    OWNER: true,
    ADMIN: true,
    MANAGER: true,
    SALES: true,
    WAREHOUSE: true,
    SERVICE: true,
    PARTNER_SERVICE: true,
    VIEWER: true,
  };
  const MIND = Object.keys(MIND_TABLA) as UserRole[];

  it("opens with the whole set in every role", () => {
    for (const role of MIND) {
      assert.equal(
        worksheetListStartsMineOnly(role),
        false,
        `${role} szerepkörben szűkebb halmazzal indul a lista`,
      );
    }
  });

  /**
   * A BEJELENTKEZÉS ELŐTTI PILLANAT IS IDETARTOZIK: a képernyő a szerepkört a
   * felhasználóból veszi, ami lehet még `undefined`. Ott sem szűkít.
   */
  it("opens with the whole set before the role is known", () => {
    assert.equal(worksheetListStartsMineOnly(undefined), false);
  });
});

/**
 * AZ ATADAS SORA MINDIG OTT ALL -- a hibajegy melle a MASODIK kimondott
 * hiany ebben a fuggvenyben.
 */
describe("worksheetDetailRows és az átadás", () => {
  function atadasSor(sorok: { label: string; value: string }[]) {
    return sorok.find((sor) => sor.label === "Átadás");
  }

  /*
    A FELIRAT A JELOLES HIANYAT MONDJA KI, NEM A GEP HELYET: helyszini
    munkanal a "meg nalunk van" hamis lenne, mert a gep el sem jott.
  */
  it("átadás nélkül kimondja, hogy a jelölés hiányzik", () => {
    const sor = atadasSor(worksheetDetailRows(worksheet));
    assert.equal(sor?.value, "Átadás nincs rögzítve");
  });

  it("átadás után a dátum és az átadó neve áll ott", () => {
    const sor = atadasSor(
      worksheetDetailRows({
        ...worksheet,
        handedOverAt: "2026-09-21T10:00:00.000Z",
        handedOverByName: "Kiss Péter",
      }),
    );
    assert.ok(sor?.value.includes("Kiss Péter"));
    assert.ok(sor?.value.includes("2026"));
    assert.ok(!sor?.value.includes("nincs rögzítve"));
  });

  /*
    A NEV HIANYA NEM VONJA VISSZA AZ ATADAST, es ez a sor SZOVEGEN is
    latszania kell: ha a sor a nevre agazna, a visszaadott eszkoz ujra
    "nalunk levonek" latszana a szerelo telefonjan.
  */
  it("a dátum egymagában is átadást jelent, név nélkül", () => {
    const sor = atadasSor(
      worksheetDetailRows({
        ...worksheet,
        handedOverAt: "2026-09-21T10:00:00.000Z",
        handedOverByName: null,
      }),
    );
    assert.ok(!sor?.value.includes("nincs rögzítve"));
    assert.ok(sor?.value.includes("2026"));
  });
});
