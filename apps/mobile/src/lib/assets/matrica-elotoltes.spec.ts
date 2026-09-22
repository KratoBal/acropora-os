import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { matricaElotoltes } from "./matrica-elotoltes";

describe("matricakod elotoltese beolvasott kodbol", () => {
  it("beolvasott kod nelkul az eszkoz sajat kodja all a mezoben", () => {
    assert.deepEqual(
      matricaElotoltes({ eszkozKodja: "V2196", utvonalKod: undefined }),
      { mezoErteke: "V2196" },
    );
  });

  it("matrica nelkuli eszkozon a beolvasott kod kerul a mezobe", () => {
    assert.deepEqual(
      matricaElotoltes({ eszkozKodja: undefined, utvonalKod: "Z9001" }),
      { mezoErteke: "Z9001" },
    );
  });

  /**
   * UGYANAZ A KOD: NINCS MIT MONDANI.
   *
   * MI PIROSIT: ha az uzenet a puszta „van beolvasott kod" tenyre allna, es
   * nem a KULONBSEGRE. Akkor a szerelo egy figyelmeztetest kapna arrol, hogy a
   * matrica, ami a kezeben van, nem egyezik azzal, ami a kezeben van.
   */
  it("ugyanarra a kodra nincs uzenet", () => {
    assert.deepEqual(
      matricaElotoltes({ eszkozKodja: "V2196", utvonalKod: "V2196" }),
      { mezoErteke: "V2196" },
    );
  });

  /**
   * EZ AZ AZ AG, AMIERT A FUGGVENY LETEZIK.
   *
   * A mezoben a MEGLEVO marad, nem a beolvasott -- kulonben a szerelo egy
   * MUKODO matricat irna felul anelkul, hogy latna, es a regi kod
   * visszakerulne a szabad keszletbe ugy, hogy senki nem tud rola.
   */
  it("masik kod all rajta: a MEGLEVO marad, es a mondat kimondja", () => {
    const terv = matricaElotoltes({
      eszkozKodja: "V2196",
      utvonalKod: "Z9001",
    });

    assert.equal(terv.mezoErteke, "V2196");
    assert.ok(terv.uzenet, "kell mondat, kulonben a kulonbseg lathatatlan");
    // MIND A KET KOD SZEREPEL BENNE: egy mondat, ami csak az egyiket nevezi
    // meg, nem dontest segit, hanem elbizonytalanit.
    assert.match(terv.uzenet, /V2196/);
    assert.match(terv.uzenet, /Z9001/);
  });

  /**
   * A KISBETUS BEOLVASAS UGYANAZ A KOD.
   *
   * A kamera es a kezi mezo is adhat kisbetus alakot. Ha a normalizalas
   * kimaradna, a fenti „ugyanaz a kod" ag NEM sulne el, es a szerelo egy
   * cserere figyelmeztetot kapna arrol a matricarol, ami mar rajta van.
   */
  it("kis- es nagybetu nem szamit a kulonbseg eldontesenel", () => {
    assert.deepEqual(
      matricaElotoltes({ eszkozKodja: "v2196", utvonalKod: "V2196" }),
      { mezoErteke: "V2196" },
    );
  });

  /**
   * KONTROLL: a fuggveny TUD uzenetet adni.
   *
   * Enelkul a fenti ket „nincs uzenet" allitas akkor is zold lenne, ha a
   * fuggveny SOHA nem adna uzenetet -- ket allitas ugyanazon a hamis alapon.
   */
  it("KONTROLL: nem mindig uzenet nelkuli", () => {
    const uzenetek = [
      matricaElotoltes({ eszkozKodja: "V2196", utvonalKod: undefined }).uzenet,
      matricaElotoltes({ eszkozKodja: "V2196", utvonalKod: "V2196" }).uzenet,
      matricaElotoltes({ eszkozKodja: "V2196", utvonalKod: "Z9001" }).uzenet,
    ];

    assert.deepEqual(
      uzenetek.map((u) => u !== undefined),
      [false, false, true],
    );
  });
});
