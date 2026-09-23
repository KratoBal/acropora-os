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
 *
 * === A PARTNER KOTELEZO, ES EZ MA MAR NEM VOLT MINDIG IGY ===
 *
 * Balazs dontese, 2026-09-23 06:53 (Discord fo csatorna, uzenet
 * 1552181062837346325, szo szerint: "Kotelezo"). A kerdes, amire valaszolt: a
 * helyszin kotelezove tetelebol kovetkezik, hogy a partner is azza valik a
 * hibajegyen, mert helyszine csak partnernek van.
 *
 * EDDIG ITT AZ ALLT, hogy "gep nelkul... a customerId... opcionalis", es hogy
 * ez "nem uj szerzodest ir, hanem a meglevot hasznalja". Ez a mondat a
 * DONTES elott igaz volt (a szerver DTO-ja ma is `@IsOptional()`-t visel a
 * `customerId`-n -- a szerver-oldali kotelezove tetel a MOBIL KIADAS UTAN jon,
 * Balazs sorrendje). Ez a modul viszont mar a KLIENS oldalan zarja le: a
 * szerelo mostantol nem tudja elkuldeni azt a jegyet, amit a szerver majd
 * ugyis elutasitana -- igy nem egy szerver-hibauzenetbol tudja meg, mit
 * hagyott ki, hanem a helyszinen, azonnal.
 *
 * === A HAROM SZABALY A SZERVERE, ES ITT CSAK ELORE SZOLUNK ===
 *
 * A szerver oriz: partner mindig kell (gep nelkuli uton), helyszin csak
 * partnerrel egyutt, eszkoz csak helyszinnel egyutt, es a helyszin a megadott
 * partnere legyen. Ez a modul ugyanezt harom szabalyt a KULDES ELOTT
 * ellenorzi -- nem azert, hogy helyettesitse a szervert (a negyedik, hogy a
 * helyszin a partnere legyen, adatot igenyel, amit a telefon nem lat), hanem
 * hogy a szerelo a helyszinen ne egy szerver-hibauzenetbol tudja meg, mit
 * hagyott ki.
 */
import { serviceJobOperationId } from "./types";

export interface UjJegyAllapot {
  cim: string;
  leiras: string;
  /** A gep, ami elott a szerelo all. `null`, ha a Hibajegyek menubol indult. */
  originAssetId: string | null;
  customerId: string | null;
  departmentId: string | null;
  /**
   * A HELYSZINEN ALLO ESZKOZOK, AMIKROL A JEGY SZOL. Tobb is lehet.
   *
   * CSAK A GEP NELKULI UTON ERTELMES: gep mellol a jegy MAGAROL a geprol szol,
   * es azt az `originAssetId` mondja meg.
   */
  assetIds: string[];
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
        assetIds?: string[];
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

  const originAssetId = allapot.originAssetId?.trim() || null;
  const customerId = allapot.customerId?.trim() || null;
  const departmentId = allapot.departmentId?.trim() || null;

  /*
    A PARTNER KOTELEZO A GEP NELKULI UTON (Balazs dontese, 2026-09-23). A
    gepes uton ez az ag nem sul el: ott az `originAssetId` maga a partner
    forrasa, es a szerver vezeti le -- a telefon meg nem is tudhatna, mi az.
  */
  if (!originAssetId && !customerId)
    return { ok: false, hiba: "Partner kiválasztása kötelező." };

  if (departmentId && !customerId)
    return {
      ok: false,
      hiba: "Helyszínt csak partnerrel együtt lehet megadni.",
    };

  /*
    A HELYSZIN IS KOTELEZO A GEP NELKULI UTON, UGYANATTOL A DONTESTOL. Gep
    mellol nem kell kulon ellenorizni: ott a helyszin is az `originAssetId`-bol
    vezetodik le, a telefon nem kuldi kulon.
  */
  if (!originAssetId && customerId && !departmentId)
    return { ok: false, hiba: "Helyszín kiválasztása kötelező." };

  /*
    AZ ESZKOZ CSAK HELYSZINNEL EGYUTT ERVENYES, es ez a szerver HARMADIK orzoje
    (`CreateServiceJobDto.assetIds`). A kert halmaz maga a HELYSZIN eszkozeibol
    all -- helyszin nelkul a partner OSSZES eszkoze jonne szoba, amibol a
    bejelento nem tud valasztani.

    A KULON URES-SZURES NEM OVATOSSAG: a valaszto allapota egy tomb, es egy
    torolt sor ures sztringet hagyhat benne. Egy ures azonosito a szerveren nem
    letezo eszkozre mutatna, es a TELJES felvitel hasalna el rajta -- egy olyan
    sor miatt, amit a szerelo mar levett.

    EZ AZ AG A GEP NELKULI UTON MA MAR NEM ERHETO EL DEPARTMENT NELKUL: a
    fenti "Helyszín kiválasztása kötelező" korabban lecsapja. Csak akkor sul
    el, ha `originAssetId` is all -- ott a felso ket uj ellenorzes nem fut,
    es ez marad az egyetlen vedelem arra a (a valodi urlapon elo nem allo)
    esetre, ha valaki gep MELLETT is kuldene az `assetIds`-t department nelkul.
  */
  const assetIds = allapot.assetIds
    .map((id) => id.trim())
    .filter((id) => id.length > 0);

  if (assetIds.length > 0 && !departmentId)
    return {
      ok: false,
      hiba: "Eszközt csak helyszínnel együtt lehet megadni.",
    };

  const leiras = allapot.leiras.trim();

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
            /*
              A GEPES UTON AZ `assetIds` SEM MEGY FEL, akkor sem, ha az allapot
              hordozna. Ott a jegy MAGAROL a geprol szol, es azt az
              `originAssetId` mondja meg -- egy melle tett lista ugyanazt az
              eszkozt MASODSZOR is rakotne, mas jelentessel.
            */
            ...(assetIds.length ? { assetIds } : {}),
          }),
    },
  };
}
