/**
 * A storefront sales channel azonosítója, KÖRNYEZETENKÉNT.
 *
 * Azonosító és nem név, mert a név átnevezhető: egy név-alapú feloldás egy nap
 * csendben megszűnne találni, és a hiba akkor derülne ki, amikor egy termék nem
 * jelenik meg a boltban. Az azonosító stabil, és egy hívást is megspórol
 * vetítésenként.
 *
 * **KÖRNYEZETENKÉNTI ÉRTÉK, és ez nem konfigurációs részlet.** A stage
 * csatornája nem létezik az élesen. Ha a beállítás átöröklődik egyik
 * környezetből a másikba, a vetítés egy olyan azonosítóra írna, ami ott nem
 * létezik - és a Medusa ezt VISSZAUTASÍTJA, tehát a hiba hangos. Ez a jó
 * kimenetel: az azonosító nem "majdnem jó" lesz máshol, hanem érvénytelen.
 *
 * Az érték NEM titok: belső azonosító, nem hitelesítő adat. Beállításban
 * tárolható és naplózható, és a jelentés ki is írja, hogy melyikre írtunk.
 */
export const MEDUSA_STOREFRONT_SALES_CHANNEL_ENV =
  "MEDUSA_STOREFRONT_SALES_CHANNEL_ID";

/**
 * A beállított azonosító, vagy `null`, ha hiányzik.
 *
 * A `null` jelentése "ne csinálj semmit", nem "kösd le a csatornáról". A
 * különbség a hívóé, és a szolgáltatás meg is áll rajta - lásd a
 * `sales-channel-not-configured` okot.
 */
export function storefrontSalesChannelId(
  environment: NodeJS.ProcessEnv = process.env,
): string | null {
  const value = environment[MEDUSA_STOREFRONT_SALES_CHANNEL_ENV]?.trim();
  return value ? value : null;
}
