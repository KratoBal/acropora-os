import { describe, expect, it } from "vitest";

import { KIHAGYAS_OKA, KULDES_KIHAGYAS_OKA } from "./handover-mail-skip-reason";

/**
 * A KET TABLA VISZONYA, ES NEM A SZOVEGUK.
 *
 * A szovegeket szandekosan NEM rogziti egyetlen allitas sem: azok
 * megfogalmazas kerdesei, es egy jobb mondat nem lehet piros teszt. Amit ezek
 * az allitasok oriznek, az a SZERKEZET -- pontosan az, amit egy kezzel masolt
 * masodik tabla csendben elrontana.
 */
describe("a kihagyasi okok ket tablaja", () => {
  /**
   * EZ AZ ALLITAS A MASOLAS ELLEN SZOL.
   *
   * Ha valaki a kuldes tablajat ujragepeli a szoras helyett, ez a sor MEG NEM
   * pirosodik -- csak akkor, amikor az elso kozos szoveg megvaltozik az egyik
   * oldalon. Epp ezert all itt: a masolas napjan minden zold, es a kar honapokkal
   * kesobb keletkezik, amikor mar senki nem emlekszik a ket tablara.
   */
  it("a kozos hat ok szovege BETURE ugyanaz a ket tablaban", () => {
    for (const [ok, szoveg] of Object.entries(KIHAGYAS_OKA)) {
      expect(KULDES_KIHAGYAS_OKA[ok as keyof typeof KIHAGYAS_OKA]).toBe(szoveg);
    }
  });

  /**
   * ES A NEVEZO: HAT KONTRA NYOLC.
   *
   * A szam beegetve all, es ez SZANDEKOS (allitasban a beegetett szam csapda,
   * nem hazugsag): ha a ket halmaz barmelyike mozdul, ez pirosodik, es a
   * kovetkezo olvaso megnezi, hogy a MASIK tablanak is mozdulnia kellett-e.
   */
  it("az elonezet HAT okot ismer, a kuldes NYOLCAT", () => {
    expect(Object.keys(KIHAGYAS_OKA)).toHaveLength(6);
    expect(Object.keys(KULDES_KIHAGYAS_OKA)).toHaveLength(8);
  });

  /**
   * A KET TOBBLET NEVE, NEV SZERINT -- mert ez a ketto az, ami a KULDES utjan
   * all elo, es amit az elonezet szerkezetileg nem tud adni.
   */
  it("a ket tobblet a no-sender es a no-job", () => {
    const tobblet = Object.keys(KULDES_KIHAGYAS_OKA).filter(
      (ok) => !(ok in KIHAGYAS_OKA),
    );
    expect(tobblet.sort()).toEqual(["no-job", "no-sender"]);
  });

  /*
    ES AMIRE SZANDEKOSAN NINCS ALLITAS -- MERT MEGIRTAM, ES ELBUKOTT.

    Irtam egy negyedik allitast: a ket uj mondat NE emlitse a cimzetteket
    (`not.toMatch(/címzett/i)`). A szandeka jo volt -- a regi, egyetlen mondat
    epp a cimzettekhez kuldte a kezelot olyankor is, amikor azok helyesek.

    PIROSRA VALTOTT, es a mondat volt a helyes, nem az allitas: a `no-sender`
    szovege KIMONDJA, hogy "a cimzettekkel nincs baj". A mintam a SZO jelenletet
    tiltotta, a szandekom viszont a FELSZOLITAS ellen szolt -- ket kulonbozo dolog.

    Nem foltoztam a mintat szukebbre, mert akkor is a SZOVEGET merne, es a fenti
    fejlec epp azt mondja ki, hogy a szovegek megfogalmazas kerdesei. Ami ebbol
    orizheto -- hogy a ket halmaz kulon all es a kozos resz nem masolodik --, azt
    a fenti harom allitas mar meri.
  */
});
