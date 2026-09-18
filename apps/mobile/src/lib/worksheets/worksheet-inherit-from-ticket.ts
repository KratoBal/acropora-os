/**
 * MIT OROKOL A LAP A JEGYTOL AZ ESZKOZOKBOL ES A FELELOSOKBOL -- A TISZTA RESZ.
 *
 * Balazs jelentese (2026-09-18): "nem veszi at se a partnert se a helyszint se
 * az eszkozt se a felelost". Az elso ketto ELOTOLTESI hiany volt (a mezo
 * letezett, csak nem toltodott). Ez a ketto MAS: a telefonos urlap nem is
 * ismerte oket -- nulla `assetIds` es nulla `assigneeIds` az egesz appban.
 *
 * === A SZERVER MIND A KETTOT FOGADJA, DE MIND A KETTOT ELLENORZI IS ===
 *
 * Es ez a lenyeg, mert egy elutasitott letrehozas a telefonon NEM egy piros
 * doboz: terero nelkul a lap a SORBAN marad, es a szerelo annyit lat, hogy
 * "var feltoltesre". Ezert nem kuldunk fel olyat, amirol elore tudjuk, hogy
 * elutasitjak.
 *
 *   ESZKOZ:  `requireAssetsInDepartment` -- az eszkoznek a lap HELYSZINEN kell
 *            allnia. A jegy eszkozei a JEGY helyszinen allnak; ha a szerelo mas
 *            helyszint valaszt, azok mar nem oda tartoznak.
 *   FELELOS: `requireAssignableUsers` -- a szerepkorenek engednie kell a
 *            munkalap szerkesztest. A jegy felelose NEM feltetlenul ilyen: a
 *            ket lista mas jogra szur.
 *
 * Mind a ketto 400-at ad, ha nem teljesul, es mind a kettot ELORE el lehet
 * donteni a telefonon -- uj vegpont nelkul.
 */

/** A jegy egy eszkoz-kapcsolata. Csak amit hasznalunk. */
export interface JegyEszkoz {
  assetId: string;
  assetName: string;
}

/** A jegy egy felelose. Csak amit hasznalunk. */
export interface JegyFelelos {
  userId: string;
  name: string;
}

/**
 * AKI A LAPRA KIOSZTHATO. A szerver `assignable-users` listaja adja.
 *
 * ES A KULCS NEVE ITT `id`, NEM `userId` -- ez nem elirás, hanem a ket valasz
 * valodi kulonbsege: a jegy felelose `userId`-t hoz, a kioszthato lista `id`-t.
 * Az elso valtozatomban mind a ketto `userId` volt, es a FORDITO fogta meg
 * (TS2322). Ha ugyanaz a nev allt volna mind a kettoben, a metszet CSENDBEN
 * ures maradt volna -- es a lap felelos nelkul ment volna fel, hibauzenet
 * nelkul.
 */
export interface KioszthatoKollega {
  id: string;
  name: string;
}

/**
 * A JEGY ESZKOZEI, HA A LAP UGYANAZON A HELYSZINEN KESZUL.
 *
 * MIERT NEM MINDIG: a szerver az eszkozt a lap helyszinehez meri, nem a
 * jegyehez. Ha a szerelo mas helyszint valaszt (joga van hozza, a jegynek nem is
 * kell helyszin), a jegy eszkozei mar nem oda tartoznak -- es a lap
 * 400-zal bukna el, terero nelkul pedig a sorban ragadna.
 *
 * HELYSZIN NELKULI JEGYNEL SINCS OROKLES: nincs mihez merni. Ez nem hiba, csak
 * nincs mit atvenni.
 */
export function oroklendoEszkozok(bemenet: {
  jegyEszkozok: readonly JegyEszkoz[];
  jegyDepartmentId: string | null;
  lapDepartmentId: string;
}): string[] {
  if (!bemenet.jegyDepartmentId) return [];
  if (bemenet.jegyDepartmentId !== bemenet.lapDepartmentId) return [];
  return [...new Set(bemenet.jegyEszkozok.map((e) => e.assetId))];
}

/**
 * A JEGY FELELOSEI, AKIK A LAPRA IS KIOSZTHATOK.
 *
 * A METSZET, ES NEM A TELJES LISTA: a jegy felelose lehet olyan szerepkoru, aki
 * munkalapot nem szerkeszthet. Azt felkuldeni 400-at ad az EGESZ lapra -- tehat
 * egyetlen nem kioszthato nev miatt veszne el a lap, nem csak az a nev.
 *
 * ES INKABB KEVESEBBET OROKLUNK: a hianyzo felelos potolhato a lap adatlapjan
 * (ott mar ma is szerkesztheto telefonon), egy elakadt lap viszont nem.
 */
export function oroklendoFelelosok(bemenet: {
  jegyFelelosok: readonly JegyFelelos[];
  kioszthatok: readonly KioszthatoKollega[];
}): string[] {
  const kioszthatoIdk = new Set(bemenet.kioszthatok.map((k) => k.id));
  return [
    ...new Set(
      bemenet.jegyFelelosok
        .map((f) => f.userId)
        .filter((userId) => kioszthatoIdk.has(userId)),
    ),
  ];
}

/**
 * MIT MOND A KEPERNYO ARROL, AMIT ATVESZ.
 *
 * NEM DISZ: a szerelo a kuldes ELOTT lassa, mi kerul a lapra. A weben a ket
 * lista valaszthato, a telefonon (egyelore) nem -- tehat itt az EGYETLEN
 * visszajelzes ez a mondat.
 *
 * ES AZ URES ESET IS MONDAT, ha a jegynek VOLT eszkoze: az elmaradt orokles oka
 * (mas helyszint valasztott) kulonben lathatatlan marad.
 */
export function oroklesUzenete(bemenet: {
  jegyEszkozok: readonly JegyEszkoz[];
  oroklendoEszkozok: readonly string[];
  oroklendoFelelosok: readonly string[];
}): string | null {
  const reszek: string[] = [];
  if (bemenet.oroklendoEszkozok.length > 0)
    reszek.push(
      bemenet.oroklendoEszkozok.length === 1
        ? "a hibajegy eszköze"
        : `a hibajegy ${bemenet.oroklendoEszkozok.length} eszköze`,
    );
  if (bemenet.oroklendoFelelosok.length > 0)
    reszek.push(
      bemenet.oroklendoFelelosok.length === 1
        ? "a hibajegy felelőse"
        : `a hibajegy ${bemenet.oroklendoFelelosok.length} felelőse`,
    );

  if (reszek.length > 0) return `A lapra átkerül ${reszek.join(" és ")}.`;

  /* AZ ELMARADT ORKLES OKA -- csak akkor, ha VOLT mit orokolni. */
  if (bemenet.jegyEszkozok.length > 0)
    return "A hibajegy eszközei nem kerülnek át: azok a jegy helyszínéhez tartoznak, és ez a lap másik helyszínre készül.";
  return null;
}
