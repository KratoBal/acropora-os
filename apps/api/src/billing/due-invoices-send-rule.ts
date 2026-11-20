/**
 * A LEJÁRÓ SZÁMLÁK HETI LEVELÉNEK KÜLDÉSI SZABÁLYA (Balázs, 2026-11-20 14:52 UTC; acrobot 58230). TISZTA FÜGGVÉNY: nem küld, nem olvas
 * adatbázist, nem ütemez. A döntést adja; a hívó (a 3. szelet ütemezője) hajtja végre.
 *
 * MIÉRT NEM SIMA IDŐPONT: a banki sorok naponta többször, rendszertelenül jönnek (éles mérés, `BankTransaction.createdAt`, utolsó 3 hét:
 * hétfőn az első betöltés 08:15 (11-09) és 09:01 (11-16), előtte nincs friss). Egy fix hétfő 7:00 a HETVÉGI állapotot küldené. Ezért:
 *
 *   - a beállított időpont (alapból hétfő 7:00) csak a LEGKORÁBBI: előtte nem megy levél;
 *   - a levél akkor indul, amikor AZNAP már bejött az első új banki betöltés (a levél a küldéskor frissen számolja a listát, tehát a
 *     párosítás a betöltés UTÁN fut: nincs külön „párosítás lefutott” állapot);
 *   - ha egy beállítható LEGKÉSŐBBI időpontig (alapból 12:00) nem jön betöltés, akkor is kimegy, és a PDF tetején áll, hogy aznap nem
 *     jött új banki adat (`lateNotice`);
 *   - naponta egyszer: ha aznap már ment, nem megy újra.
 *
 * Az idő budapesti fali idő; a nap és a perc az `Intl`-ből jön, tehát az óraátállítás napján is a fali óra dönt.
 */

export interface DueInvoicesMailSettings {
  enabled: boolean;
  /** a hét napja, 1 = hétfő … 7 = vasárnap */
  weekday: number;
  /** `ÓÓ:PP`: a legkorábbi küldési idő */
  earliest: string;
  /** `ÓÓ:PP`: a legkésőbbi küldési idő; a legkorábbinál korábbi érték a legkorábbira esik */
  latest: string;
}

export const DEFAULT_DUE_INVOICES_MAIL_SETTINGS: DueInvoicesMailSettings = {
  enabled: true,
  weekday: 1,
  earliest: "07:00",
  latest: "12:00",
};

export type DueInvoicesMailDecision =
  | {
      action: "SEND";
      /** `FIRST_BANK_LOAD`: aznap bejött új banki betöltés; `LATEST_TIME`: nem jött, a legkésőbbi idő elérkezett */
      reason: "FIRST_BANK_LOAD" | "LATEST_TIME";
      /** igaz, ha aznap nem jött új banki adat: a PDF tetején szerepel */
      lateNotice: boolean;
    }
  | {
      action: "WAIT";
      reason:
        | "DISABLED"
        | "NOT_THE_DAY"
        | "ALREADY_SENT"
        | "BEFORE_EARLIEST"
        | "NO_BANK_LOAD_YET";
    };

const BUDAPEST = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Budapest",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  // `hour12: false` egyes ICU-változatokban h24-et ad (éjfél = "24"); a h23 kiírva rögzíti, hogy az éjfél utáni óra 00 (barracuda 58276)
  hourCycle: "h23",
});
const DAY = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Budapest" });
const WEEKDAYS: Readonly<Record<string, number>> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

/** Egy `ÓÓ:PP` időpont percekben; érvénytelen alakra `null`. */
export function minutesOf(time: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/** A pillanat budapesti napja (`ÉÉÉÉ-HH-NN`), a hét napja (1 = hétfő) és a nap perce. */
export function budapestClock(at: Date): {
  day: string;
  weekday: number;
  minutes: number;
} {
  const parts = Object.fromEntries(
    BUDAPEST.formatToParts(at).map((part) => [part.type, part.value]),
  );
  return {
    day: DAY.format(at),
    weekday: WEEKDAYS[parts.weekday as string] ?? 0,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

export function decideDueInvoicesMail(input: {
  now: Date;
  settings: DueInvoicesMailSettings;
  /** az utolsó küldés budapesti napja, ha volt */
  lastSentDay: string | null;
  /** a legkorábbi banki sor, ami MA (budapesti nap) érkezett; `null`: ma még nem jött új banki adat */
  firstBankLoadToday: Date | null;
}): DueInvoicesMailDecision {
  const { settings } = input;
  if (!settings.enabled) return { action: "WAIT", reason: "DISABLED" };
  const clock = budapestClock(input.now);
  if (clock.weekday !== settings.weekday)
    return { action: "WAIT", reason: "NOT_THE_DAY" };
  if (input.lastSentDay === clock.day)
    return { action: "WAIT", reason: "ALREADY_SENT" };
  const earliest = minutesOf(settings.earliest) ?? 7 * 60;
  // ha a legkésőbbi a legkorábbinál korábbra van állítva, a legkorábbi utáni első ellenőrzés már „elérte” (a legkorábbi előtt úgyis vár)
  const latest = minutesOf(settings.latest) ?? 12 * 60;
  if (clock.minutes < earliest)
    return { action: "WAIT", reason: "BEFORE_EARLIEST" };
  if (input.firstBankLoadToday !== null)
    return { action: "SEND", reason: "FIRST_BANK_LOAD", lateNotice: false };
  if (clock.minutes >= latest)
    return { action: "SEND", reason: "LATEST_TIME", lateNotice: true };
  return { action: "WAIT", reason: "NO_BANK_LOAD_YET" };
}
