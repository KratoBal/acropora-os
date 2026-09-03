/**
 * MENNYI IDEIG HIHETUNK EGY TAROLT MUNKAMENETNEK HALOZAT NELKUL.
 *
 * === A DONTES BALAZSE, ES IDEZETTEL ALL ITT ===
 *
 * Balazs, 2026-09-02, a mobilalkalmazas szalban: a hatar "24 ora". A kerdes,
 * amire valaszolt, az volt, hogy ha van tarolt token es nincs halozat, meddig
 * indulhat az app a tarolt munkamenettel.
 *
 * ES AMIT EZ FELARAZ, amit o tudva vallalt: egy ELVESZETT telefonon a tarolt
 * munkamenet 24 oraig offline is hasznalhato, mert a szerver nem tudja
 * visszavonni. Ez nem mellekhatas, hanem a dontes ara -- es azert all itt, hogy
 * aki a hatart egyszer meg akarja emelni, lassa, mit emel vele.
 *
 * (Nem az en dontesem, es nem is acroboté. Ha valaha megvaltozik, ugyanigy
 * idezettel kell atirni.)
 *
 * === MIERT VAN EGYALTALAN SZUKSEG RA ===
 *
 * Merve (Balazs kepernyokepe, repulogep uzemmod, 2026-09-02 23:31): az app EL
 * SEM INDUL halozat nelkul. Indulaskor a munkamenetet a szervernel ellenorzi, es
 * halozati hibanal csak egy Ujraprobalas gomb marad; a teljes utvonal-verem meg
 * csak nem is mountolodik.
 *
 * Vagyis a korabbi allitasunk ("offline a telefon OLVAS, de nem IR") a RETEGRE
 * igaz volt es HASZNALHATATLAN: az olvashato resz a kapu MOGOTT van, es a kapu
 * elobb zar. Nem korlatozott offline mod volt, hanem semmilyen.
 */

/** A hatar ezredmasodpercben. Balazs dontese: 24 ora. */
export const OFFLINE_GRACE_MS = 24 * 60 * 60 * 1000;

export type OfflineStartVerdict =
  | { allowed: true; ageMs: number }
  /** Volt mar sikeres ellenorzes, de tul regen. A szerver-ellenorzes kotelezo. */
  | { allowed: false; reason: "grace-expired"; ageMs: number }
  /**
   * MEG SOHA NEM ELLENORIZTUK ONLINE ezt a munkamenetet.
   *
   * Ez a legfontosabb ag, es szandekosan TILT. Egy meglevo telepitesen a tarolt
   * munkamenetben nincs `lastVerifiedAt` (a mezo ma szuletik), es a hianyabol
   * NEM kovetkezik, hogy a munkamenet friss -- csak az, hogy nem tudjuk.
   *
   * A ket teves irany ara nem egyforma: aki feleslegesen kap egy
   * szerver-ellenorzest, az egyszer varakozik; akit tevesen engedunk be, az egy
   * visszavont munkamenettel dolgozik tovabb. Ezert a hianyzo adat NEM
   * beengedes.
   */
  | { allowed: false; reason: "never-verified"; ageMs: null };

export interface OfflineStartInput {
  /**
   * Az utolso SIKERES szerver-ellenorzes ideje, ISO alakban. `null`, ha meg
   * nem volt ilyen -- vagy ha a tarolt munkamenet a mezo bevezetese ELOTT
   * keletkezett.
   */
  lastVerifiedAt: string | null;
  now: number;
  /** Injektalhato a mereshez; alapertelmezesben a fenti hatar. */
  graceMs?: number;
}

export function canStartOffline(input: OfflineStartInput): OfflineStartVerdict {
  if (!input.lastVerifiedAt) {
    return { allowed: false, reason: "never-verified", ageMs: null };
  }
  const verified = new Date(input.lastVerifiedAt).getTime();
  if (Number.isNaN(verified)) {
    /**
     * OLVASHATATLAN IDOBELYEG = NEM TUDJUK. Ugyanaz az ag, mint a hianyzo mezo:
     * egy elrontott ertekbol nem kovetkezik frissesseg. Ha ezt beengedesnek
     * vennenk, egy serult tarolo hatarozatlan ideig nyitva tartana a kaput.
     */
    return { allowed: false, reason: "never-verified", ageMs: null };
  }
  const ageMs = input.now - verified;
  const grace = input.graceMs ?? OFFLINE_GRACE_MS;
  /**
   * A JOVOBELI IDOBELYEG IS KIESIK. Ha az ora elore all vagy a tarolt ertek
   * hibas, a kor NEGATIV lenne, es egy `ageMs <= grace` vizsgalat ezt
   * beengedne -- hatarozatlan idore, mert minden jovobeli belyeg atmegy.
   */
  if (ageMs < 0) {
    return { allowed: false, reason: "grace-expired", ageMs };
  }
  if (ageMs > grace) {
    return { allowed: false, reason: "grace-expired", ageMs };
  }
  return { allowed: true, ageMs };
}

/** A mondat, amit a kollega lat, ha a kapu zarva marad. */
export function describeOfflineStart(verdict: OfflineStartVerdict): string {
  if (verdict.allowed) {
    const orak = Math.floor(verdict.ageMs / (60 * 60 * 1000));
    return `Offline mód: a munkamenetet ${orak} órája ellenőriztük utoljára.`;
  }
  if (verdict.reason === "never-verified") {
    return (
      "Ehhez a munkamenethez még nem volt sikeres szerver-ellenőrzés, ezért " +
      "hálózat nélkül nem indítható. Csatlakozz egyszer, utána 24 óráig offline is megy."
    );
  }
  return (
    "A munkamenet utolsó ellenőrzése 24 óránál régebbi, ezért hálózat nélkül " +
    "nem indítható. Csatlakozz a szerverhez."
  );
}
