import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HIANYZO_FORRAS_UZENET, kepHibaSzovege } from "./kep-hiba";

describe("a kép-hiba mérőeszköz", () => {
  /**
   * A NATÍV ÜZENET TELJES SZÖVEGGEL MEGY KI. Egy saját átirat ("hálózati
   * hiba") pontosan azt a különbséget törölné el, amiért a mérés készült: a
   * 401, a dekódolási hiba és az időtúllépés három külön szöveg.
   */
  it("a sztring alakú natív hibát szó szerint viszi", () => {
    const szoveg = kepHibaSzovege({
      nativeEvent: { error: "Failed to load image: 401 Unauthorized" },
    });

    assert.ok(szoveg.includes("Failed to load image: 401 Unauthorized"));
  });

  it("az Error alakút is, az üzenetéből", () => {
    assert.ok(
      kepHibaSzovege({
        nativeEvent: { error: new Error("unexpected end of stream") },
      }).includes("unexpected end of stream"),
    );
  });

  /**
   * ISMERETLEN ALAKNÁL A TELJES OBJEKTUM MEGY KI. Egy általam kiválasztott
   * mező épp azt a platformot hagyná ki, amit mérni akarunk -- az `error`
   * típusa platformonként más.
   */
  it("objektum alakúnál a teljes tartalmat kiírja", () => {
    const szoveg = kepHibaSzovege({
      nativeEvent: { error: { code: 404, domain: "NSURLErrorDomain" } },
    });

    assert.ok(szoveg.includes("404"));
    assert.ok(szoveg.includes("NSURLErrorDomain"));
  });

  /**
   * AZ ÜRES HIBA IS VÁLASZ, ÉS KI KELL MONDANI. Ha csak annyit írnánk ki, hogy
   * "elhasalt", a felolvasott mondat nem zárna ki semmit -- pontosan olyan
   * hasznavehetetlen lenne, mint a mai üres csempe.
   */
  it("üres hiba-objektumnál KIMONDJA, hogy nem jött üzenet", () => {
    for (const eset of [
      { nativeEvent: {} },
      { nativeEvent: { error: "" } },
      { nativeEvent: { error: "   " } },
      {},
      null,
      undefined,
    ]) {
      const szoveg = kepHibaSzovege(eset);
      assert.ok(
        szoveg.includes("NEM adott üzenetet"),
        `nem mondta ki: ${JSON.stringify(eset)} -> ${szoveg}`,
      );
    }
  });

  /**
   * A KÉT ESET KÜLÖN MONDAT, ÉS EZ A MÉRÉS LÉNYEGE: a hiányzó forrásnál kérés
   * EL SEM INDULT. Ha a két szöveg egyforma lenne, a Balázstól kapott válasz
   * nem zárna ki semmit.
   */
  it("a hiányzó forrás üzenete MÁS, és kimondja, hogy nem hálózati hiba", () => {
    assert.ok(HIANYZO_FORRAS_UZENET.includes("NEM hálózati hiba"));
    assert.notEqual(
      HIANYZO_FORRAS_UZENET,
      kepHibaSzovege({ nativeEvent: { error: "bármi" } }),
    );
  });

  /**
   * MIND A KÉT MONDAT MAGÁT MÉRÉSNEK NEVEZI. A szerelő és Balázs is látja a
   * képernyőn: ez nem a végleges felirat, hanem egy kérdés, amire válasz kell.
   */
  it("mindkét mondat MÉRÉS-ként jelöli magát", () => {
    assert.ok(HIANYZO_FORRAS_UZENET.startsWith("MÉRÉS:"));
    assert.ok(
      kepHibaSzovege({ nativeEvent: { error: "x" } }).startsWith("MÉRÉS:"),
    );
  });
});
