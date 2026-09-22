/**
 * MIT MOND A PUSH, AMIKOR UGYFEL NYIT HIBAJEGYET.
 *
 * Balazs valasza, 2026-09-22, szo szerint: „Új hibajegyet nyitott egy ügyfél ez
 * jó, de ha lehet akkro az még jobb lenne, higy Új hibajegyet nyitott a
 * 'ugyfelkod'. pl FANK"
 *
 * A „HA LEHET" A FELTETEL, ES VALODI: az ugyfelkod (`Customer.
 * worksheetPartnerCode`, merve 2026-09-22) NULLAZHATO a semaban. Van olyan
 * ugyfel, akinek nincs -- annal a bovebb mondat nem allithato elo.
 *
 * === A HARMADIK ALAK, AMI TILOS ===
 *
 *     "Új hibajegyet nyitott a FANK"      a kert alak
 *     "Új hibajegyet nyitott egy ügyfél"  a visszaeses, ha nincs kod
 *     "Új hibajegyet nyitott a "          EZ SOSEM MEHET KI
 *
 * A harmadik rosszabb mind a kettonel: befejezetlen mondat a zarolt kepernyon,
 * es a szerelo azt hiszi, valami elveszett. Ezert nem helyorzo-behelyettesites
 * ez a fuggveny, hanem KET AG.
 *
 * === AMIT NEM EZ A FUGGVENY DONT EL ===
 *
 * A csupa szokozbol allo kod ugyanugy ures, mint a `null` -- a `trim()` ezert
 * itt all, nem a hivoban: egy hivo, aki elfelejti, pont a tiltott harmadik
 * alakot allitana elo.
 */
export function serviceJobOpenedPushTitle(
  partnerCode: string | null | undefined,
): string {
  const kod = partnerCode?.trim() ?? "";
  return kod.length > 0
    ? `Új hibajegyet nyitott a ${kod}`
    : "Új hibajegyet nyitott egy ügyfél";
}
