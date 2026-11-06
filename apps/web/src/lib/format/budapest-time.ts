/**
 * A BUDAPESTI FALI IDŐ MINT PILLANAT. Az űrlap egy napot és egy óra:percet kér ("2026-11-07", "21:00"), és az a boltban
 * érvényes budapesti idő, bármilyen időzónájú gépről nyitják az oldalt: a böngésző saját zónája (`new Date("...T21:00")`)
 * csak véletlenül egyezik vele. A válasz a szerver felé menő ISO pillanat (UTC).
 *
 * A NYÁRI IDŐSZÁMÍTÁS HATÁRÁN: a kimaradó óra (tavasszal 02:00-03:00) a következő órára esik, az ismétlődő óra (ősszel
 * 02:00-03:00) az első előfordulására. Egy nyitási vagy zárási időpont ritkán esik oda, de nem téved el.
 */
const ZONE = "Europe/Budapest";

/** A zóna eltolása (ms) az adott UTC pillanatban: a fali idő UTC-ként olvasva, mínusz a pillanat. */
function zoneOffsetMs(utc: number): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: ZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utc));
  const get = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value);
  const wall = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return wall - Math.floor(utc / 1000) * 1000;
}

/** Egy pillanat budapesti napja (`YYYY-MM-DD`) és órája:perce (`HH:MM`): a `budapestInstant` párja, a szerkesztő űrlap előtöltéséhez. */
export function budapestParts(
  iso: string,
): { day: string; time: string } | null {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: ZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(at);
  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    day: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
  };
}

/** `day` = `YYYY-MM-DD`, `time` = `HH:MM`; `null`, ha bármelyik nem ilyen alakú vagy nem létező. */
export function budapestInstant(day: string, time: string): string | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  const t = /^(\d{2}):(\d{2})$/.exec(time);
  if (!d || !t) return null;
  const [year, month, date] = [Number(d[1]), Number(d[2]), Number(d[3])];
  const [hour, minute] = [Number(t[1]), Number(t[2])];
  if (hour > 23 || minute > 59) return null;
  const wall = Date.UTC(year, month - 1, date, hour, minute);
  const check = new Date(wall);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== date
  )
    return null;
  // az eltolás a kiinduló pillanaton, majd egyszer a kapott pillanaton: a nyári időszámítás határán ez dönt
  const first = wall - zoneOffsetMs(wall);
  return new Date(wall - zoneOffsetMs(first)).toISOString();
}
