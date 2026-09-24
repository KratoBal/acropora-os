import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readPdfTextLines } from "../documents/pdf/pdf-text-readback.js";

import { renderMaintenanceOrderFormPdf } from "./maintenance-order-form-document.js";
import { maintenanceOrderFormFieldLines } from "./maintenance-order-form-content.js";
import type { MaintenanceOrderFormInput } from "./maintenance-order-form.types.js";

/**
 * A SZÓKÖZ NORMALIZÁLÁSA AZ ÖSSZEVETÉSHEZ -- ugyanaz az indok, mint a
 * `worksheet-sheet-document.spec.ts`-ben: a `pdfjs` a bevezető és a halmozott
 * szóközt elnyeli, ezt a visszaolvasás szerkezetileg nem adja vissza.
 */
function szokozNelkul(sor: string): string {
  return sor.replace(/\s+/g, " ").trim();
}

/** A minta-lap négy tétele (exchange/minta-megrendelolap-allatkert.docx). */
function bemenet(
  overrides: Partial<MaintenanceOrderFormInput> = {},
): MaintenanceOrderFormInput {
  return {
    customer: {
      name: "Fővárosi Állat- és Növénykert",
      address: "1146 Budapest, Állatkerti krt. 6-12.",
    },
    contractNumber: "SZ2026/0000019",
    items: [
      {
        position: 1,
        description: "Cápasuli RO karbantartás (fordított ozmózis berendezés)",
        unitPricePerOccasion: 410000,
        quantity: 1,
        occasionsPerYear: 1,
        vatRatePercent: 27,
      },
      {
        position: 5,
        description:
          "Cápasuli nagymedence (690m3) gépészet (összesített egységár)",
        unitPricePerOccasion: 475000,
        quantity: 1,
        occasionsPerYear: 4,
        vatRatePercent: 27,
      },
    ],
    issuedAt: "2026-09-24",
    sequenceNumber: "MR-2026-0001",
    ...overrides,
  };
}

describe("a megrendelőlap bemenetéből PDF lesz", () => {
  it("a bájtok VALÓDI PDF-et adnak", async () => {
    const content = await renderMaintenanceOrderFormPdf(bemenet());
    assert.equal(content.subarray(0, 5).toString("latin1"), "%PDF-");
  });

  it("minden mező-sor visszaolvasható a bájtokból", async () => {
    /*
      MIÉRT EGYBEFÜGGŐ SZÖVEGKÉNT MÉRÜNK, NEM SORONKÉNT.

      A hosszú mező-sorok (pl. a fizetési határidő szövege) a lap
      szélességénél szélesebbek, tehát a rajzoló KÉT vizuális sorra töri
      őket -- a `pdf-text-readback.ts` pedig FÜGGŐLEGES helyzet szerint
      csoportosít, tehát egy törött bekezdés KÉT különálló visszaolvasott
      sorként jön vissza. Egy pontos, soronkénti egyezés ezért ÉPP a
      leghosszabb, leginkább ellenőrzésre szoruló mondatokon bukna el.

      Ezért a teljes lapot OLVASÁSI SORRENDBEN egybefűzzük (a `readPdfTextLines`
      már fentről lefelé, soron belül balról jobbra rendezi a sorokat), és
      RÉSZLET-illesztéssel mérünk: egy törött bekezdés a szóközzel összefűzött
      szövegben ugyanúgy egybefüggő marad, mint egy törés nélküli sor.
    */
    const input = bemenet();
    const content = await renderMaintenanceOrderFormPdf(input);
    const vissza = await readPdfTextLines(content);
    const egybefuggo = szokozNelkul(vissza.map((sor) => sor.text).join(" "));

    const { header, footer } = maintenanceOrderFormFieldLines(input);
    const vart = [...header, ...footer].map(szokozNelkul);
    const hianyzo = vart.filter((sor) => !egybefuggo.includes(sor));

    assert.deepEqual(hianyzo, [], "a visszaolvasott lapból mező-sor hiányzik");
    // ISMERT POZITÍV KONTROLL: a nulla eltérés nem egy ÜRES lapról szól.
    assert.ok(vissza.length > 10, `gyanúsan kevés sor: ${vissza.length}`);
  });

  it("a szerződésszám és a vevő neve a lapon áll", async () => {
    const content = await renderMaintenanceOrderFormPdf(bemenet());
    const vissza = await readPdfTextLines(content);
    assert.ok(
      vissza.some((sor) => sor.text.includes("SZ2026/0000019")),
      "a szerződésszám hiányzik",
    );
    assert.ok(
      vissza.some((sor) => sor.text.includes("Fővárosi Állat- és Növénykert")),
      "a vevő neve hiányzik",
    );
  });

  it("a tételsorok tartalmazzák a megnevezést, a mennyiséget és a sor díját", async () => {
    /*
      MI PIROSÍT: ha egy tétel megnevezése, egységára, darabszáma, évi
      alkalomszáma vagy a sor díja lemarad a rajzolásnál. A táblázat celláit a
      rajzoló EGY SORBA írja (lásd a tartalom-modul fejlécét), tehát a
      visszaolvasott sor egybefüggő szöveg -- ezért RÉSZLET-illesztéssel
      mérünk, nem pontos egyezéssel.
    */
    const content = await renderMaintenanceOrderFormPdf(bemenet());
    const vissza = await readPdfTextLines(content);
    const egybe = vissza.map((sor) => sor.text).join(" | ");

    // 1. tétel: 410 000 Ft x 1 db x 1 alkalom = 410 000 Ft.
    assert.ok(egybe.includes("Cápasuli RO karbantartás"));
    assert.ok(egybe.includes("410 000 Ft"));
    // 5. tétel: 475 000 Ft x 1 db x 4 alkalom = 1 900 000 Ft.
    assert.ok(egybe.includes("Cápasuli nagymedence"));
    assert.ok(egybe.includes("475 000 Ft"));
    assert.ok(egybe.includes("1 900 000 Ft"));
  });

  it("az összesítő nettó, ÁFA és bruttó a Decimal-számolásból jön, betűre", async () => {
    // A két tétel nettója 410 000 + 1 900 000 = 2 310 000 Ft, az ÁFA 27%-kal
    // 623 700 Ft, a bruttó 2 933 700 Ft.
    const content = await renderMaintenanceOrderFormPdf(bemenet());
    const vissza = await readPdfTextLines(content);
    const szovegek = vissza.map((sor) => szokozNelkul(sor.text));

    assert.ok(
      szovegek.includes("Nettó összeg: 2.310.000,- Ft"),
      "a nettó összeg nem egyezik",
    );
    assert.ok(
      szovegek.includes("ÁFA összeg: 623.700,- Ft"),
      "az ÁFA összeg nem egyezik",
    );
    assert.ok(
      szovegek.includes("Bruttó összeg: 2.933.700,- Ft"),
      "a bruttó összeg nem egyezik",
    );
  });

  it("hiányzó opcionális mezőknél a minta alapértelmezését írja ki, nem hasal el", async () => {
    /*
      MI PIROSÍT: ha egy opcionális mező hiánya kivételt dobna, vagy ha a
      "undefined" szó kerülne a lapra. A minta-lap forrás-nélküli mezői
      (szervezeti egység, terhelendő kód, ügyintéző stb.) MA opcionálisak --
      lásd a típus-fájl fejlécét a teljes listáért.
    */
    const content = await renderMaintenanceOrderFormPdf(bemenet());
    const vissza = await readPdfTextLines(content);
    const egybe = vissza.map((sor) => sor.text).join(" ");

    assert.equal(egybe.includes("undefined"), false);
    assert.ok(
      vissza.some((sor) =>
        sor.text.includes("Karbantartási keretszerződés szerinti"),
      ),
      "a tárgy alapértelmezése hiányzik",
    );
    assert.ok(
      vissza.some((sor) => sor.text.includes("IGEN / NEM")),
      "a raktár-egyeztetés kézzel kitöltendő alakja hiányzik",
    );
  });

  it("megadott opcionális mezők (ügyintéző, iktatási szám) megjelennek a lapon", async () => {
    const content = await renderMaintenanceOrderFormPdf(
      bemenet({
        customer: {
          name: "Fővárosi Állat- és Növénykert",
          address: "1146 Budapest, Állatkerti krt. 6-12.",
          contactPersonName: "Sándor Zsolt",
          registrationNumber: "IKT-2026-001",
          organizationalUnitName: "Üzemeltetési Osztály",
        },
      }),
    );
    const vissza = await readPdfTextLines(content);
    const egybe = vissza.map((sor) => sor.text).join(" | ");
    assert.ok(egybe.includes("Sándor Zsolt"));
    assert.ok(egybe.includes("IKT-2026-001"));
    assert.ok(egybe.includes("Üzemeltetési Osztály"));
  });

  it("a lap egyetlen tétel nélkül is elkészül, nulla összesítővel", async () => {
    const content = await renderMaintenanceOrderFormPdf(bemenet({ items: [] }));
    const vissza = await readPdfTextLines(content);
    const szovegek = vissza.map((sor) => szokozNelkul(sor.text));
    assert.ok(szovegek.includes("Nettó összeg: 0,- Ft"));
  });
});
