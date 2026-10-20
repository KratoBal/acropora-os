/** Egy időpont a bolti időzónában, ahogy a kolléga a vevőnek felolvassa. */
export function formatMoment(iso: string): string {
  return new Intl.DateTimeFormat("hu-HU", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Europe/Budapest",
  }).format(new Date(iso));
}
