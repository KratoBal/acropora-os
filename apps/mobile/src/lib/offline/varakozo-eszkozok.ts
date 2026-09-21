/**
 * A MEG FEL NEM MENT ESZKOZOK, A LISTAN -- ES MIERT KELL EGYALTALAN.
 *
 * === A JELENTES (Balazs, 2026-09-18 08:26 UTC, Discord) ===
 *
 * "az offline eszkoz felvitelnel minden mukodik, de ha megnyomom a mentes
 * gombot, akkor inaktivva valik, de nem lep vissza az elozo kepernyore. ha
 * visszalepek akkor ujra tudok felvenni, csak semmi visszajelzes nincs, hogy
 * sikerult a mentes"
 *
 * === A DONTES (Balazs, 2026-09-21 11:42:58 UTC: "elfogadom") ===
 *
 * Offline mentes utan a kepernyo LEPJEN VISSZA a listara, es a felvitt eszkoz
 * JELENJEN MEG a listan, megjelolve, hogy meg feltoltesre var. Az alternativa
 * (csak visszalepes plusz egy mondat) fele annyi munka lett volna, es azt NEM
 * valasztotta.
 *
 * === MIERT TISZTA MODUL ===
 *
 * A sor olvasasa adatbazis, a lista rajzolasa kepernyő; EZ a resz viszont az,
 * amit el lehet rontani -- es telefon nelkul is lehet allitani. Ugyanaz a
 * szetvalasztas, mint a `list-source.ts`-ben.
 *
 * === EGY MEZO, AMI NINCS: AZ ESZKOZSZAM ===
 *
 * A szamot a SZERVER adja a felmenetelkor, tehat a sorban allo tetelnek meg
 * nincs. A lista ezert a matricakodot mutatja helyette, ha van -- es ha az
 * sincs, kimondja, hogy meg nincs szama. Egy ures hely ott ugy nezne ki, mint
 * egy elromlott sor.
 */

/** Egy sor a szinkron-sorbol, annyiban, amennyit ez a modul olvas. */
export interface SorbanAlloSor {
  id: string;
  operation: string;
  entityType: string;
  payloadJson: string;
}

export interface VarakozoEszkoz {
  /** A MUVELET-azonosito, nem eszkoz-azonosito: a masodik meg nem letezik. */
  operationId: string;
  name: string;
  /** A matricakod, ha van. A lista ezt mutatja az eszkozszam helyen. */
  labelCode: string | null;
}

/**
 * A SORBOL CSAK AZ ESZKOZ-FELVITELEK ERDEKELNEK.
 *
 * A `update` es a `upload-photo` MAR LETEZO rekordhoz tartozik, tehat azok a
 * listan amugy is ott allnak. Egy fel nem ment MODOSITAS masodik sorkent
 * jelenne meg ugyanarrol az eszkozrol.
 */
export function varakozoEszkozok(
  sorok: readonly SorbanAlloSor[],
): VarakozoEszkoz[] {
  const eredmeny: VarakozoEszkoz[] = [];
  for (const sor of sorok) {
    if (sor.entityType !== "asset" || sor.operation !== "create") continue;
    /*
      A SERULT TORZS NEM DOB, ES NEM IS TUNIK EL NYOMTALANUL: a sor bekerul
      nev nelkuli tetelkent. Egy kivetel itt az EGESZ listat elvinne -- egy
      olvashatatlan sor miatt a szerelo a sajat, ep felviteleit sem latna.
    */
    let torzs: { name?: unknown; labelCode?: unknown } = {};
    try {
      const olvasott: unknown = JSON.parse(sor.payloadJson);
      if (olvasott && typeof olvasott === "object")
        torzs = olvasott as { name?: unknown; labelCode?: unknown };
    } catch {
      torzs = {};
    }
    eredmeny.push({
      operationId: sor.id,
      name:
        typeof torzs.name === "string" && torzs.name.trim()
          ? torzs.name
          : "Névtelen felvitel",
      labelCode:
        typeof torzs.labelCode === "string" && torzs.labelCode.trim()
          ? torzs.labelCode
          : null,
    });
  }
  return eredmeny;
}

/**
 * A VARAKOZOK A LISTA ELEJERE KERULNEK.
 *
 * Nem izles: a szerelo epp az imenti felvitelet keresi. Ha a lista vegen
 * allna, egy otven soros helyszinen gorgetnie kellene erte -- es a kerdes,
 * amire valaszt akar ("sikerult-e"), pont az elso pillanatban merul fel.
 */
export function eszkozokVarakozokkal<T>(input: {
  szerverElemek: readonly T[];
  varakozok: readonly VarakozoEszkoz[];
}): (
  { fajta: "varakozo"; tetel: VarakozoEszkoz } | { fajta: "kesz"; tetel: T }
)[] {
  return [
    ...input.varakozok.map((tetel) => ({ fajta: "varakozo", tetel }) as const),
    ...input.szerverElemek.map((tetel) => ({ fajta: "kesz", tetel }) as const),
  ];
}
