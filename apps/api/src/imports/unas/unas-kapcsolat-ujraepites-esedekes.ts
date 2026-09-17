/**
 * MIKOR ESEDEKES A KAPCSOLAT-UJRAEPITES -- ONALLO, MERHETO DONTES.
 *
 * Kulon fajl, mert az utemezo tobbi resze idozitokbol es adatbazisbol all, ez
 * viszont tiszta fuggveny: orat es datumot kap, `due` jelzest ad vissza. A
 * `medusa-projection-due.ts` ugyanigy all kulon a sajat utemezojetol.
 *
 * KET FELTETEL, ES MIND A KETTO KULON OKBOL VAN:
 *
 * 1. CSENDES ABLAK. acrobot kikotese (2026-09-17): a futas napi egy, csendes
 *    orakban. Az ujraepites TOROL, mielott ujrair, tehat egy napkozbeni futas
 *    alatt a kapcsolatok masodpercekre eltunnenek a boltbol.
 *
 * 2. EGY FUTAS EGY NAPON. Ez NEM ugyanaz, mint az ablak, es NEM is
 *    kenyelmi masolat: a telepites-hullam ellen ez ved. 2026-09-17-en
 *    TIZENNEGY telepites ment ki egy nap alatt -- ha mindegyik ujrainditas
 *    egy teljes kort jelentene, az ablakon belul tizennegy ujraepites futna
 *    le egymas utan. Az indulasi keslelteto ezt NEM oldja meg: az csak
 *    eltolja a kort, nem szunteti meg.
 *
 * A KETTO EGYUTT AD NAPI EGYET: az ablak azt mondja meg, MIKOR, a naponkenti
 * korlat azt, HANYSZOR. Kulon-kulon egyik sem eleg.
 */

export interface UjraepitesEsedekessegBemenet {
  /** A jelenlegi ido. Parameter, kulonben a dontes nem merheto. */
  most: Date;
  /** A csendes ablak kezdete es vege, HELYI orakban. A vege kizarolag. */
  ablakKezdoOra: number;
  ablakZaroOra: number;
  /**
   * AZ UTOLSO FUTAS KEZDETE, vagy `null`, ha meg egy sem volt.
   *
   * A KEZDETE, NEM A VEGE, es ez szandekos: egy megallt vagy elhasalt futas
   * is elhasznalta a mai kort. Ha a vegere neznenk, egy hibas futas utan a
   * kovetkezo ebredeskor ujra elindulna -- pont az a hurok, amit el akarunk
   * kerulni.
   */
  utolsoFutasKezdete: Date | null;
}

export type UjraepitesEsedekessegOk =
  /** Az ablakon kivul vagyunk. */
  | "ABLAKON_KIVUL"
  /** Ma mar futott egy kor. */
  | "MA_MAR_FUTOTT"
  /** Esedekes. */
  | "ESEDEKES";

export interface UjraepitesEsedekessegDontes {
  due: boolean;
  ok: UjraepitesEsedekessegOk;
}

/** Ugyanaz a HELYI naptari nap-e a ket idopont. */
function ugyanaznap(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function decideUjraepitesDue(
  bemenet: UjraepitesEsedekessegBemenet,
): UjraepitesEsedekessegDontes {
  const ora = bemenet.most.getHours();
  if (ora < bemenet.ablakKezdoOra || ora >= bemenet.ablakZaroOra)
    return { due: false, ok: "ABLAKON_KIVUL" };
  if (
    bemenet.utolsoFutasKezdete &&
    ugyanaznap(bemenet.utolsoFutasKezdete, bemenet.most)
  )
    return { due: false, ok: "MA_MAR_FUTOTT" };
  return { due: true, ok: "ESEDEKES" };
}
