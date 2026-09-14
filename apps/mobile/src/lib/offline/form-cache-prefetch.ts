import { isCacheStale } from "./offline-notice";

/**
 * MIKOR TOLTSUK ELO AZ ESZKOZ-URLAP KET LISTAJAT.
 *
 * === A HIANY, AMI EZT KIVALTOTTA ===
 *
 * A masolat eddig CSAK az uj eszkoz urlapon keletkezett, es csak akkor, ha a
 * halozati lekeres ott sikerult. Vagyis aki egyszer sem nyitotta meg az urlapot
 * terero mellett, annak a pinceben URES a partnerlista -- pontosan ugy, mintha
 * a masolat nem is letezne.
 *
 * Balazs 2026-09-14-en ugyanazt jelentette, amit 2026-09-03-an: nem tudja
 * kivalasztani a partnert. Akkor a masolat hianyzott; most a masolat MEGVAN, de
 * senki nem tolti fel. A ket tunet a telefonon MEGKULONBOZTETHETETLEN, es ez a
 * fuggveny az, ami a masodikat megszunteti.
 *
 * === MIERT A FOKEPERNYON, ES NEM A BEJELENTKEZESNEL ===
 *
 * A bejelentkezes egyszer tortenik, aztan a munkamenet napokig el. Egy
 * bejelentkezeshez kotott elotoltes tehat pont annal a kollegánal nem futna le
 * soha, aki be van jelentkezve es reggel elindul a helyszinre. A fokepernyo
 * viszont minden inditasnal latszik, es a sor kiuritese is ott indul.
 *
 * === MIERT HAT ORA, ES NEM HUSZONNEGY ===
 *
 * A felulet huszonnegy ora utan mondja a masolatot REGINEK
 * (`STALE_AFTER_HOURS`). Ha az elotoltes is huszonnegy oranal frissitene, akkor
 * a masolat epp abban a pillanatban ujulna meg, amikor mar regi -- vagyis a
 * szerelo egy teljes munkanapot vihetne ki ugy, hogy a lapja regit mond. Hat
 * ora mellett a masolat a terero elvesztesekor legrosszabb esetben is hat oras,
 * tehat a munkanap alatt soha nem eri el a regi hatart.
 */
export const PREFETCH_AFTER_HOURS = 6;

export interface FormCachePrefetchInput {
  online: boolean;
  authenticated: boolean;
  /** Ugyanaz a kapu, mint az urlap lekeresen: aki nem vihet fel eszkozt, annak
   * a lista sem kell, es a szerver ugyis megtagadna. */
  assetsManage: boolean;
  /** A mentett tulajdonos-lista kora. `null`, ha meg soha nem mentettuk. */
  ownersSyncedAt: string | null;
  now: Date;
  staleAfterHours?: number;
}

export interface FormCachePrefetchDecision {
  run: boolean;
  /** MIERT nem futott. Naploba es tesztbe valo, nem a kepernyore: egy elmaradt
   * elotoltes nema, es a nemasagnak tobb oka lehet. */
  reason:
    | "offline"
    | "nincs-munkamenet"
    | "nincs-jogosultsag"
    | "friss-a-masolat"
    | "futhat";
}

/**
 * A DONTES KULON ALL A VEGREHAJTASTOL, mert ez az a resz, amit el lehet
 * rontani, es ez az, amit adatbazis es halozat nelkul is lehet allitani.
 */
export function decideFormCachePrefetch(
  input: FormCachePrefetchInput,
): FormCachePrefetchDecision {
  if (!input.online) return { run: false, reason: "offline" };
  if (!input.authenticated) return { run: false, reason: "nincs-munkamenet" };
  if (!input.assetsManage) return { run: false, reason: "nincs-jogosultsag" };
  const stale = isCacheStale(
    input.ownersSyncedAt,
    input.now,
    input.staleAfterHours ?? PREFETCH_AFTER_HOURS,
  );
  return stale
    ? { run: true, reason: "futhat" }
    : { run: false, reason: "friss-a-masolat" };
}

/**
 * HANY PARTNER ALEGYSEGEIT TOLTJUK LE AZ ELOTOLTESBEN.
 *
 * A tulajdonos-lista EGY hivas; az alegysegek partnerenkent EGY-EGY. A modul,
 * ami a masolatot irja (`asset-form-cache.ts`), szandekosan NEM tolt le minden
 * partnerhez mindent, es az indoka all: egy nagy partnertorzsnel az inditas
 * percekig tartana.
 *
 * A MERES VISZONT ITT MAST MOND, MINT A FELTETELEZES: a valaszthato partnerek
 * kore nem a teljes torzs, hanem az aktiv, SZERVIZ-jelolt, nem torolt partner
 * -- murena merese szerint (2026-09-04) ebbol OSSZESEN KETTO van. Husz partner
 * tehat a mai allapot tizszerese, es addig az elotoltes huszonegy hivas.
 *
 * A hatar nem optimalizacio, hanem OR: ha a partnertorzs egyszer megno, az
 * elotoltes nem lassul el csendben, hanem egyszeruen abbahagyja -- es az
 * urlapon a mai, partnerenkenti mentes tovabbra is mukodik.
 */
export const PREFETCH_UNIT_PARTNER_LIMIT = 20;
