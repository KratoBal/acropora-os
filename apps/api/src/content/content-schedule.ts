/**
 * AZ ÜTEMEZETT TARTALOM LEJÁRATA: a „piszkozat gyújtózsinórral" szabály.
 *
 * BALÁZS ÁLLÓ SZABÁLYA, 2026-08-18 22:20. Az ütemezett poszt mindig a
 * megengedett ablak TÁVOLI végére megy (a Graph API a +30 napot elutasítja, a
 * +29-et elfogadja, tehát a feltöltés napja + 29 nap), és ha a dátum a 25.
 * napon változatlan, Luca figyelmeztetést kap, majd két óra múlva a poszt
 * TÖRLŐDIK.
 *
 * MIÉRT: sima ütemezéssel a NEM-CSELEKVÉS azt jelentené, hogy a poszt kiteszi
 * magát. A távoli horizont plusz a törlés teszi az ütemezőt piszkozat-dobozzá,
 * amiben a HALLGATÁS NEMET jelent, nem igent. Ez ugyanaz a szabály, amit
 * Balázs a kiküldésre is kimondott: egyelőre semmi nem megy ki nélküle vagy
 * Luca nélkül.
 *
 * EBBŐL KÖVETKEZIK, HOGY AZ „ÜTEMEZVE" NEM NYUGALMI ÁLLAPOT. Ez az egyetlen
 * állapotunk, amiben a semmittevésnek határideje van, és a felület nem
 * mutathatja eseménytelennek: a naptárban KÉT dátum van, az, amikorra ütemezve
 * van, és az, amikor a mi határidőnk lejár rajta.
 *
 * A DÁTUM MOZDÍTÁSA AZ EGYETLEN, AMI „FOGLALKOZOTT VELE"-NEK SZÁMÍT. Egy
 * szövegmódosítás NEM -- ezt Balázs külön megerősítette. Ezért a lejárat az
 * utolsó DÁTUM-mozdítástól számít, nem az utolsó szerkesztéstől: különben egy
 * vesszőhiba javítása újraindítaná a gyújtózsinórt, és a szabály elvesztené az
 * értelmét.
 */
export const SCHEDULE_HORIZON_DAYS = 29;
export const SCHEDULE_WARNING_DAY = 25;
export const SCHEDULE_GRACE_HOURS = 2;

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export interface ScheduledContent {
  /**
   * Amikor az ütemezés a mai alakját kapta: a létrehozás, VAGY az utolsó
   * dátum-mozdítás. Szövegmódosítás nem írja át.
   */
  scheduleAnchoredAt: Date;
}

export type ScheduleStanding =
  /** Van még idő; a `warnAt` mondja meg, mikortól nincs. */
  | { standing: "running"; warnAt: Date; deleteAt: Date }
  /** A figyelmeztetés esedékes, a törlésig még van türelmi idő. */
  | { standing: "warning"; deleteAt: Date }
  /** A türelmi idő is letelt: a poszt törlendő. */
  | { standing: "expired" };

/**
 * HOVÁ ÜTEMEZZÜNK egy ma feltöltött posztot.
 *
 * A +29 nap nem óvatosság, hanem a mért határ: a +30 napot a Graph API
 * elutasítja. A távoli vég választása szándékos -- minél messzebb van, annál
 * több idő marad rá, hogy valaki DÖNTSÖN róla, ahelyett hogy a határidő döntene
 * helyette.
 */
export function scheduleTargetFor(uploadedAt: Date): Date {
  return new Date(uploadedAt.getTime() + SCHEDULE_HORIZON_DAYS * DAY_MS);
}

export function scheduleStanding(
  content: ScheduledContent,
  now: Date,
): ScheduleStanding {
  const warnAt = new Date(
    content.scheduleAnchoredAt.getTime() + SCHEDULE_WARNING_DAY * DAY_MS,
  );
  const deleteAt = new Date(warnAt.getTime() + SCHEDULE_GRACE_HOURS * HOUR_MS);

  // A HATÁR ELÉRÉSE MÁR A KÉSŐBBI ÁLLAPOT. Egy `>` itt azt jelentené, hogy a
  // 25. nap pontos pillanatában még „fut" -- és a figyelmeztetés csak a
  // következő ellenőrzéskor menne ki, ami órákkal odébb lehet. A szabály
  // napokban gondolkodik, nem ezredmásodpercekben.
  if (now.getTime() >= deleteAt.getTime()) return { standing: "expired" };
  if (now.getTime() >= warnAt.getTime())
    return { standing: "warning", deleteAt };
  return { standing: "running", warnAt, deleteAt };
}
