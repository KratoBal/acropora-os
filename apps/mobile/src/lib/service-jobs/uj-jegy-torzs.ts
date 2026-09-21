/**
 * RELATIV UT, NEM `@/` ALIAS -- a `tsconfig.test.json` nem hordoz `paths`
 * bejegyzest, tehat az alias a leforditott kodban maradna, es a FUTAS hasalna
 * el rajta. (Ugyanaz az indok, mint a `list-scope.ts` fejleceben.)
 */

/**
 * MI MEGY FEL EGY UJ HIBAJEGYBOL -- KET UTON, EGY HELYEN ELDONTVE.
 *
 * === A KET UT, ES MIERT NEM UGYANAZ ===
 *
 * GEP ELOL: a szerelo egy gep elott all, es a jegy partnere meg helyszine a
 * gepbol KOVETKEZIK -- a szerver vezeti le az `originAssetId`-bol. Ilyenkor a
 * telefon nem ad meg partnert: nem is tudja, es nem is szabad talalgatnia
 * (szallitoi eszkoznel a partner a szallito tukor-sora).
 *
 * GEP NELKUL: nincs mibol levezetni, tehat amit a szerelo megad, az megy fel.
 * A szerver ezt MA IS fogadja: a `customerId`, a `departmentId` es az
 * `originAssetId` egyarant opcionalis, a sema ket oszlopa nullazhato, es a
 * WEBES felvitel pontosan igy mukodik -- `originAssetId` nelkul. Ez a modul
 * tehat nem uj szerzodest ir, hanem a meglevot hasznalja a telefonrol is.
 *
 * === A HAROM SZABALY A SZERVERE, ES ITT CSAK ELORE SZOLUNK ===
 *
 * A szerver oriz: helyszin csak partnerrel egyutt, eszkoz csak helyszinnel
 * egyutt, es a helyszin a megadott partnere legyen. Ez a modul ugyanezt a ket
 * elso szabalyt a KULDES ELOTT ellenorzi -- nem azert, hogy helyettesitse a
 * szervert (nem tudja: a harmadik szabalyhoz adat kell), hanem hogy a szerelo
 * a helyszinen ne egy szerver-hibauzenetbol tudja meg, mit hagyott ki.
 */
import { serviceJobOperationId } from "./types";

export interface UjJegyAllapot {
  cim: string;
  leiras: string;
  /** A gep, ami elott a szerelo all. `null`, ha a Hibajegyek menubol indult. */
  originAssetId: string | null;
  customerId: string | null;
  departmentId: string | null;
  /** A bejelentkezett felhasznalo, a muvelet-azonositohoz. */
  userId: string;
  openedAt: string;
}

export type UjJegyTorzs =
  | { ok: false; hiba: string }
  | {
      ok: true;
      operationId: string;
      payload: {
        title: string;
        description?: string;
        originAssetId?: string;
        customerId?: string;
        departmentId?: string;
      };
    };

/**
 * A MUVELET-AZONOSITO A TARTALOMBOL SZULETIK, NEM VELETLENBOL -- es gep nelkul
 * a FELHASZNALO adja azt, amit addig a gep.
 *
 * A gepes alak (`service-job:<assetId>:<ido>`) ket dolgot kapcsol ossze: mirol
 * szol a bejelentes, es mikor. Gep nelkul az elso fele kiesne, es maradna a
 * puszta idobelyeg -- ket szerelo ugyanabban az ezredmasodpercben KET kulon
 * jegyet nyitna ugyanazzal a kulccsal. A szerver idempotencia-kulcsa GLOBALIS:
 * a masodik keres ilyenkor nem hibat kapna, hanem AZ ELSO JEGYET, csendben.
 *
 * A felhasznalo azonositoja ezt vagja el, es kozben megtartja a ketszer
 * megnyomott gomb elleni vedelmet: ugyanaz az ember, ugyanabban a pillanatban,
 * ugyanazt a kulcsot kapja.
 */
export function eszkozNelkuliMuveletAzonosito(input: {
  userId: string;
  openedAt: string;
}): string {
  return `service-job:nincs-eszkoz:${input.userId}:${input.openedAt}`;
}

export function ujJegyTorzse(allapot: UjJegyAllapot): UjJegyTorzs {
  const cim = allapot.cim.trim();
  if (!cim) return { ok: false, hiba: "A jegy címe kötelező." };

  const customerId = allapot.customerId?.trim() || null;
  const departmentId = allapot.departmentId?.trim() || null;

  if (departmentId && !customerId)
    return {
      ok: false,
      hiba: "Helyszínt csak partnerrel együtt lehet megadni.",
    };

  const leiras = allapot.leiras.trim();
  const originAssetId = allapot.originAssetId?.trim() || null;

  return {
    ok: true,
    operationId: originAssetId
      ? /*
           A GEPES KULCSOT A MEGLEVO FUGGVENY ADJA, nem egy ittvalo masolat: a
           kulcs alakja SZERZODES a sorral (a mar sorban allo muveletek ezzel a
           formaval mentek el), es ket helyen leirva pontosan addig egyezne,
           amig valaki az egyiket atirja.
        */
        serviceJobOperationId({ originAssetId, openedAt: allapot.openedAt })
      : eszkozNelkuliMuveletAzonosito({
          userId: allapot.userId,
          openedAt: allapot.openedAt,
        }),
    payload: {
      title: cim,
      ...(leiras ? { description: leiras } : {}),
      ...(originAssetId ? { originAssetId } : {}),
      /*
        GEP MELLETT NEM KULDUNK PARTNERT ES HELYSZINT, akkor sem, ha az allapot
        hordozna: a szerver a gepbol vezeti le, es a megadott ertek nala
        ELSOBBSEGET elvezne. Egy ottfelejtett mezo igy csendben felulirna azt,
        amit a gep mond -- es epp a gep az, ami biztosan tudja.
      */
      ...(originAssetId
        ? {}
        : {
            ...(customerId ? { customerId } : {}),
            ...(departmentId ? { departmentId } : {}),
          }),
    },
  };
}
