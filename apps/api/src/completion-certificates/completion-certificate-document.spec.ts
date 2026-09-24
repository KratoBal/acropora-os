import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readPdfTextLines } from "../documents/pdf/pdf-text-readback.js";

import { completionCertificateDocument } from "./completion-certificate-document.js";
import type { CompletionCertificateInput } from "./completion-certificate-types.js";

/**
 * A BEMENET A MINTÁRÓL (exchange/minta-teljesitesi-igazolas-allatkert.pdf,
 * "ÁLT #2026-12"), betűre -- így a visszaolvasott szöveg a valódi lappal
 * vethető össze, nem egy kitalált fixtúrával.
 */
function input(
  overrides: Partial<CompletionCertificateInput> = {},
): CompletionCertificateInput {
  return {
    certificateNumber: "ÁLT #2026-12",
    issuedAt: new Date("2026-07-28T00:00:00Z"),
    completedAt: new Date("2026-06-30T00:00:00Z"),
    subject: "Cápasuli akvárium felügyeleti rendszerek",
    worksheetReference: "Munkalap ÁLT #2026-31",
    customer: {
      name: "Fővárosi Állat- És Növénykert",
      addressLines: ["Állatkerti körút 6-12", "1146 Budapest"],
      taxNumber: "15490658-2-42",
    },
    items: [
      {
        description: "Cápasuli akvárium felügyeleti rendszerek",
        detail: "Karbantartása és ellenőrzése elvégzésre került.",
        contractNumber: "SZ2026/0000019",
        quantity: 3,
        quantityUnit: "alkalom",
        unitPrice: 700000,
        vatRatePercent: 27,
      },
    ],
    signerName: "Kratochwill Balázs",
    signerEmail: "info@acropora.hu",
    ...overrides,
  };
}

describe("a teljesítési igazolás PDF-je", () => {
  it("a bizonylat száma és a két dátum a mintán látott ISO alakban áll", async () => {
    const rows = await readPdfTextLines(
      await completionCertificateDocument(input()),
    );
    assert.ok(rows.some((row) => row.text.includes("ÁLT #2026-12")));
    assert.ok(rows.some((row) => row.text.includes("2026-07-28")));
    assert.ok(rows.some((row) => row.text.includes("2026-06-30")));
  });

  it("a tárgy, a munkalap-hivatkozás és az ügyfél adatai megjelennek", async () => {
    const rows = await readPdfTextLines(
      await completionCertificateDocument(input()),
    );
    const text = rows.map((row) => row.text).join("\n");
    assert.ok(text.includes("Cápasuli akvárium felügyeleti rendszerek"));
    assert.ok(text.includes("Munkalap ÁLT #2026-31"));
    assert.ok(text.includes("Fővárosi Állat- És Növénykert"));
    assert.ok(text.includes("Állatkerti körút 6-12"));
    assert.ok(text.includes("15490658-2-42"));
  });

  it("a tétel sora tartalmazza a mennyiséget, az egységárat, az ÁFA-t és a nettó összeget", async () => {
    const rows = await readPdfTextLines(
      await completionCertificateDocument(input()),
    );
    const text = rows.map((row) => row.text).join("\n");
    assert.ok(text.includes("Karbantartása és ellenőrzése elvégzésre került."));
    assert.ok(text.includes("SZ2026/0000019"));
    assert.ok(text.includes("3 alkalom"));
    assert.ok(text.includes("700 000"));
    assert.ok(text.includes("27%"));
    assert.ok(text.includes("2 100 000"));
  });

  /**
   * A MINTA HÁROM ÖSSZEGET AD: nettó 2 100 000, ÁFA 567 000, bruttó
   * 2 667 000 -- mindhárom betűre a mintáról, a `completion-certificate-
   * amounts.spec.ts` saját, kalibrált tesztje bizonyítja, hogy ez a szám
   * Decimal-lal jön ki, nem lebegőpontosan kerekítve véletlenül egyezik.
   */
  it("az összesítő mindhárom sora a mintán látott összeget adja, HUF-ban", async () => {
    const rows = await readPdfTextLines(
      await completionCertificateDocument(input()),
    );
    const text = rows.map((row) => row.text).join("\n");
    assert.ok(text.includes("2 100 000 HUF"));
    assert.ok(text.includes("567 000 HUF"));
    assert.ok(text.includes("2 667 000 HUF"));
  });

  it("az aláíró neve és e-mail címe megjelenik, ha meg van adva", async () => {
    const rows = await readPdfTextLines(
      await completionCertificateDocument(input()),
    );
    const text = rows.map((row) => row.text).join("\n");
    assert.ok(text.includes("Kratochwill Balázs"));
    assert.ok(text.includes("info@acropora.hu"));
  });

  /**
   * TESTVÉR-KONTROLL: aláíró nélkül a lap NEM omlik el, és nem hagy egy
   * üres, senkinek nem szóló sort. Enélkül a fenti állítás azt is
   * bizonyítaná, ha az aláíró mindig kötelezően ott állna a rajzoló
   * kódjában -- ez a teszt mutatja meg, hogy valóban ELHAGYHATÓ mező.
   */
  it("aláíró nélkül is érvényes, teljes PDF-et ad", async () => {
    const bytes = await completionCertificateDocument(
      input({ signerName: undefined, signerEmail: undefined }),
    );
    const rows = await readPdfTextLines(bytes);
    assert.ok(rows.length > 0);
    assert.ok(!rows.some((row) => row.text.includes("Kratochwill Balázs")));
  });

  /**
   * TÖBB TÉTEL: a második tétel is megjelenik, és az összesítő a KÉT tétel
   * együttes összegét adja, nem csak az elsőét.
   */
  it("több tétel esetén az összesítő mindkét sort összeadja", async () => {
    const rows = await readPdfTextLines(
      await completionCertificateDocument(
        input({
          items: [
            {
              description: "Cápasuli akvárium felügyeleti rendszerek",
              quantity: 3,
              quantityUnit: "alkalom",
              unitPrice: 700000,
              vatRatePercent: 27,
            },
            {
              description: "Medence vízforgató karbantartása",
              quantity: 2,
              quantityUnit: "alkalom",
              unitPrice: 150000,
              vatRatePercent: 27,
            },
          ],
        }),
      ),
    );
    const text = rows.map((row) => row.text).join("\n");
    assert.ok(text.includes("Cápasuli akvárium felügyeleti rendszerek"));
    assert.ok(text.includes("Medence vízforgató karbantartása"));
    // Nettó: 2 100 000 + 300 000 = 2 400 000; ÁFA: 567 000 + 81 000 = 648 000;
    // bruttó: 2 667 000 + 381 000 = 3 048 000.
    assert.ok(text.includes("2 400 000 HUF"));
    assert.ok(text.includes("648 000 HUF"));
    assert.ok(text.includes("3 048 000 HUF"));
  });
});
