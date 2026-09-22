/**
 * A HIBAJEGY BELSO LINKJE -- TISZTA FUGGVENYBEN.
 *
 * Balazs kerese, 2026-09-22 19:49:22 UTC (Discord, Acropora OS szal,
 * message_id 1552044155222491207), szo szerint: "Lehet a valtozok koze
 * berakni egy olyat amit ha belerakok a levelbe akkor link latszik a
 * levelben ami a hibajegyre visz?"
 *
 * === MIERT A `WEB_URL`, ES NEM UJ VALTOZO ===
 *
 * Az API mar ismeri ezt a kulcsot: az `app.configuration.ts` a CORS eredetet
 * allitja belole (`process.env.WEB_URL ?? "http://localhost:3000"`), es a
 * `docs/COOLIFY.md` szerint elesben MAR BE VAN allitva. Uj kornyezeti valtozo
 * bevezetese helyett ez ujrahasznositja azt, ami mar all -- ugyanaz a cim,
 * ahonnan a felulet maga is fut.
 *
 * === MIERT URES STRING, NEM HIBA, HA A `WEB_URL` HIANYZIK ===
 *
 * A hianyzo linket a hivo NEM allithatja meg a kuldest -- egy elmaradt link
 * bosszanto, egy elmaradt ertesites munkat tart fel. A `renderMailTemplate`
 * az URES stringet ERVENYES ertekkent kezeli (csak a HIANYZO kulcs szamit
 * "ismeretlennek"), tehat egy ures `jegy_linkje` a sablonban egyszeruen nem
 * ir ki semmit -- a level MEGY, csak link nelkul.
 */
export function internalTicketLink(input: {
  readonly webUrl: string | undefined;
  readonly serviceJobId: string;
}): string {
  const alap = input.webUrl?.trim();
  if (!alap) return "";
  return `${alap.replace(/\/+$/, "")}/szerviz/hibajegyek/${input.serviceJobId}`;
}
