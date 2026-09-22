/**
 * MI ALLJON A MATRICAKOD MEZOBEN, HA A SZERELO EGY BEOLVASOTT KODDAL ERKEZIK.
 *
 * TISZTA FUGGVENY, ES NEM KENYELEMBOL: a mobilon nincs komponens-teszt
 * keretrendszer, tehat ami a `.tsx`-ben marad, azt semmi nem tudja megmerni.
 * Ugyanaz az alak, mint a kategoria-valasztonal (`categoryPickerPlan`).
 *
 * === A KERDES, AMIT ELDONT ===
 *
 * A FEL 2 folyamat egy SZABAD matricakoddal kuldi a szerelot egy MEGLEVO eszkoz
 * szerkesztojere. A mezoben viszont allhat mar egy masik kod -- az, ami MA van
 * az eszkozon. A ketto kozott donteni kell, es a rossz irany NEMA:
 *
 *     ha a beolvasott kod CSENDBEN felulirja a meglevot, a szerelo egy MUKODO
 *     matricat ir felul anelkul, hogy latna. A regi kod visszakerul a szabad
 *     keszletbe, es senki nem tud rola.
 *
 * Ezt a hibat a matricakod-mezonel MAR EGYSZER megfizettuk: addig a szerkeszto
 * URES dobozt mutatott, ami azt ALLITOTTA, hogy nincs matrica.
 *
 * === A DONTES ===
 *
 *     nincs beolvasott kod          -> az eszkoz sajat kodja (vagy ures)
 *     van, es az eszkozon NINCS kod -> a beolvasott kod kerul a mezobe
 *     van, es UGYANAZ all rajta     -> nincs teendo, es nincs mit mondani
 *     van, es MASIK all rajta       -> a MEGLEVO marad a mezoben, es egy
 *                                      mondat kimondja, hogy a beolvasott mas
 *
 * A negyedik ag ara: a szerelo egy koppintassal tobbet dolgozik (kezzel kell
 * atirnia, ha tenylegesen cserelni akar). Cserebe a csere TUDATOS lepes lesz,
 * nem mellekhatas. A ket irany ara nem egyforma: a felesleges ovatossag HANGOS
 * (a szerelo latja mind a ket kodot es dont), a csendes felulir as NEMA.
 */
export interface MatricaElotoltes {
  /** Ami a mezobe kerul. Ures szoveg: nincs kod. */
  mezoErteke: string;
  /**
   * A mondat a mezo mellett, ha van mit mondani. `undefined`, ha nincs --
   * NEM ures szoveg: egy ures mondat helyet foglalna a kepernyon.
   */
  uzenet?: string;
}

export function matricaElotoltes(input: {
  /** Ami a szerver szerint MOST all az eszkozon. */
  eszkozKodja: string | undefined;
  /** A beolvasott, szabad kod, az utvonalrol. */
  utvonalKod: string | undefined;
}): MatricaElotoltes {
  const meglevo = (input.eszkozKodja ?? "").trim().toUpperCase();
  const beolvasott = (input.utvonalKod ?? "").trim().toUpperCase();

  if (beolvasott === "") return { mezoErteke: meglevo };
  if (meglevo === "") return { mezoErteke: beolvasott };
  if (meglevo === beolvasott) return { mezoErteke: meglevo };

  return {
    mezoErteke: meglevo,
    uzenet:
      `Ezen az eszközön már a(z) ${meglevo} matrica áll. A beolvasott ` +
      `${beolvasott} kódot NEM írtuk a helyére: ha cserélni akarod, írd át a ` +
      `mezőt, és a régi kód visszakerül a szabad készletbe.`,
  };
}
