import { describe, expect, it } from "vitest";

import { emptyItem, missingFields } from "./contracts-page";
import { missingContractFields } from "./contract-detail-page";

/**
 * A "validFrom must be a valid ISO 8601 date string" ANGOL HIBA NE JUSSON
 * EL AZ API-IG.
 *
 * === MIÉRT KELL EZ AZ ŐRZŐ (2026-09-24, Balázs éles hibája) ===
 *
 * Balázs a Partnerek / Szerződések / Új keretszerződés űrlapon a
 * "Mentés" gombot megnyomta úgy, hogy az "Érvényesség kezdete" mező
 * (csak `aria-label`-lel, látható felirat nélkül) üresen maradt -- a gomb
 * semmit nem akadályozott, és az API `@IsDateString` hibája ANGOLUL jelent
 * meg a felületen. A javítás a gomb-tiltás: ez a teszt azt méri, hogy a
 * tiltást tápláló `missingFields`/`missingContractFields` a HELYES mezőket
 * nevezi meg, magyarul, és a HELYES pillanatban enged.
 */
describe("missingFields -- Új keretszerződés űrlap", () => {
  const validDraft = {
    customerId: "customer-1",
    number: "SZ2026/0000019",
    title: "Éves karbantartás",
    validFrom: "2026-09-24",
    items: [{ ...emptyItem(), description: "Szűrőcsere", unitNet: "12000" }],
  };

  it("minden kötelező mező kitöltve: nincs hiány", () => {
    expect(missingFields(validDraft)).toEqual([]);
  });

  /*
    A MÉRT ESET: pontosan ez volt Balázs helyzete -- minden más mező
    kitöltve, csak az "Érvényesség kezdete" üres.
  */
  it("üres validFrom: 'Érvényesség kezdete' szerepel a hiányban, magyarul", () => {
    const missing = missingFields({ ...validDraft, validFrom: "" });
    expect(missing).toContain("Érvényesség kezdete");
  });

  it("üres partner, szám, cím mindegyike külön szerepel", () => {
    const missing = missingFields({
      ...validDraft,
      customerId: "",
      number: "",
      title: "",
    });
    expect(missing).toEqual(
      expect.arrayContaining(["Partner", "Szerződésszám", "Szerződés címe"]),
    );
  });

  /*
    POZITÍV KONTROLL, HOGY A TÉTEL-ELLENŐRZÉS TÉNYLEG MŰKÖDIK: az
    alapértelmezett üres tétel (`emptyItem()`) leírás és egységár NÉLKÜL
    NEM érvényes -- ha ez az állítás false-t adna, a lenti negatív
    állítás (hogy az alapértelmezett draft hiányt jelez) hamisan zöld
    lenne.
  */
  it("az alapértelmezett, kitöltetlen tétel önmagában HIÁNYZÓ tételt jelent", () => {
    const missing = missingFields({
      ...validDraft,
      items: [emptyItem()],
    });
    expect(missing).toContain("legalább egy kitöltött tétel");
  });

  it("egy hibás formátumú (nem szám) egységár is hiányzó tételnek számít", () => {
    const missing = missingFields({
      ...validDraft,
      items: [{ ...emptyItem(), description: "Szűrőcsere", unitNet: "sok" }],
    });
    expect(missing).toContain("legalább egy kitöltött tétel");
  });

  it("több tétel közül elég, ha EGY érvényes", () => {
    const missing = missingFields({
      ...validDraft,
      items: [
        emptyItem(),
        { ...emptyItem(), description: "Szűrőcsere", unitNet: "12000" },
      ],
    });
    expect(missing).not.toContain("legalább egy kitöltött tétel");
  });
});

describe("missingContractFields -- szerződés-adatlap szerkesztése", () => {
  const validContract = {
    number: "SZ2026/0000019",
    title: "Éves karbantartás",
    validFrom: "2026-09-24T00:00:00.000Z",
  };

  it("minden kitöltve: nincs hiány", () => {
    expect(missingContractFields(validContract)).toEqual([]);
  });

  it("kiürített validFrom hiányt jelez", () => {
    expect(
      missingContractFields({ ...validContract, validFrom: "" }),
    ).toContain("Érvényesség kezdete");
  });

  it("csak szóközre ürített szám/cím is hiánynak számít, nem csak az üres string", () => {
    const missing = missingContractFields({
      ...validContract,
      number: "   ",
      title: "  ",
    });
    expect(missing).toEqual(
      expect.arrayContaining(["Szerződésszám", "Szerződés címe"]),
    );
  });
});
