import { describe, expect, it } from "vitest";

import {
  emptyLine,
  toLineInput,
  type WorksheetLineDraft,
} from "./worksheet-line-editor";

/**
 * A SZERKESZTŐ MEGŐRZI ÉS VISSZAKÜLDI AZ ÁRAT, HOLOTT NEM MUTATJA.
 *
 * === MIÉRT KELL EZ AZ ŐRZŐ (2026-09-17) ===
 *
 * Balázs döntése szerint a nettó, bruttó és áfa mezők sehol nem jelennek meg --
 * és ugyanabban a mondatban azt is kimondta: "Ne töröljük ezeket."
 *
 * A KETTŐ EGYÜTT VESZÉLYES, mert a szerkesztő a TELJES tartalmat küldi vissza
 * (`PATCH :id`, a `ContentDto`-val). Ha a `toLineInput` egyszer nem küldi az
 * árat, akkor egy ártalmatlan szerkesztés -- például egy elírt megnevezés
 * javítása -- NÉMÁN törli a meglévő árat:
 *
 *   - a mentés SIKERES, a lap tartalma teljes;
 *   - a felületen semmi nem változik, mert az ár nem is látszik;
 *   - és az érték eltűnik, hibaüzenet nélkül.
 *
 * Ez pontosan az a hibafajta, amit a szerkesztőből kivett mező mellé írt
 * komment említ -- és ez az a teszt, amire hivatkozik.
 *
 * === MIÉRT NEM ELÉG A TÍPUS ===
 *
 * A `WorksheetLineInput.unitNet` ELHAGYHATÓ (`unitNet?: number`), mert a
 * telefon ár nélkül rögzít. A fordító tehát nem szól, ha a mező kimarad a
 * `toLineInput` visszatéréséből: az objektum attól még érvényes marad.
 *
 * Egy elhagyható mező hiánya sosem fordítási hiba -- csak adatvesztés.
 */

function draft(reszlet: Partial<WorksheetLineDraft> = {}): WorksheetLineDraft {
  return { ...emptyLine(), description: "Kompresszor bevizsgálás", ...reszlet };
}

describe("a szerkesztő megőrzi az árat, holott nem mutatja", () => {
  it("a szerverről betöltött egységár és ÁFA VISSZAMEGY a mentésben", () => {
    const input = toLineInput(
      draft({ unitNet: "12000", vatRatePercent: "27" }),
    );

    expect(input.unitNet).toBe(12000);
    expect(input.vatRatePercent).toBe(27);
  });

  /**
   * ÉS A HIÁNY TOVÁBBRA IS HIÁNY, NEM NULLA. A szerelő ár nélkül rögzít; egy
   * nulla forintos tétel a lapon ÉRTÉKNEK látszik, nem hiánynak. Ha ez a két
   * állítás egy tesztben állna, egy rontás mindkettőt elvinné, és nem tudnánk,
   * melyik fogott.
   */
  it("az üres ár `undefined`-ként megy, nem nullaként", () => {
    const input = toLineInput(draft({ unitNet: "", vatRatePercent: "" }));

    expect(input.unitNet).toBeUndefined();
    expect(input.vatRatePercent).toBeUndefined();
  });

  /**
   * ISMERT POZITÍV KONTROLL: a leképezés egyáltalán működik-e. Ha a
   * `toLineInput` valaha üres objektumot adna vissza, a fenti két állítás
   * közül az egyik (az `undefined`-os) UGYANÚGY teljesülne -- és akkor nem az
   * árat mérnénk, hanem a semmit.
   */
  it("a leképezés a többi mezőt is átviszi", () => {
    const input = toLineInput(draft({ quantity: "2", unit: "óra" }));

    expect(input.description).toBe("Kompresszor bevizsgálás");
    expect(input.quantity).toBe(2);
    expect(input.unit).toBe("óra");
  });
});
