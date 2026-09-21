/**
 * A LEZART HIBAJEGY LEVELENEK SZOVEGE -- TISZTA FUGGVENYBEN.
 *
 * === MIERT NEM SABLONBOL, HOLOTT VAN SABLON-TABLANK ===
 *
 * A `TicketMailTemplate` az AUTOMATIKUS ertesitesek szovegét tartja (Balazs:
 * "legyenek valtozok amiket be tudok illeszteni"). EZ MAS UT: itt a KEZELO
 * gepeli a targyat es a torzset, ugyanabban a percben, amikor kikuldi.
 *
 * Balazs specje szo szerint: "egy targy mezo ahova automatikusan bekerul a
 * hibajegy szama egy olyan szovegbe pl: A xyszamu hibajegyet lezartuk. Ez alatt
 * egy uzenet mezo ahova uzenetet tudok irni ami a level torzse lesz."
 *
 * Vagyis a targy ELOTOLTOTT, nem generalt: a kezelo atirhatja. Ez a fuggveny
 * azt adja, ami a mezoben MEGJELENIK, nem azt, ami elmegy.
 */

/**
 * AZ ELOTOLTOTT TARGY.
 *
 * A jegyszam a MONDATBAN all, nem elotagkent. Balazs peldaja igy szol, es a
 * kulonbseg nem stilus: egy `[HJ-2026-001]` elotag a vevo postafiokjaban
 * rendszer-uzenetnek latszik, a mondat pedig annak, ami -- egy ertesites.
 */
export function handoverMailDefaultSubject(jobNumber: string): string {
  return `A ${jobNumber} számú hibajegyet lezártuk.`;
}

/**
 * A LEVEL TORZSE: A KEZELO SZOVEGE, ES SEMMI MAS.
 *
 * === ITT ALLT EGY `note` PARAMETER, ES ELKERULT ===
 *
 * A meret-kapu link-visszaesesenek szantam: ha a csomag nem fer ra, a rendszer
 * mondata kerult volna a kezelo szovege ala. Ket dolog szuntette meg:
 *
 *   1. MERVE (2026-09-22): NINCS link, amit a levelbe tehetnenk. A letoltes
 *      hitelesitett vegpont, a partner-portal nem hivja (nulla hivas,
 *      kontrollal), es alairt vagy publikus ut nincs.
 *   2. acrobot dontese (2026-09-22 00:57): "NEM MEGY KI OLYAN LINK A VEVONEK,
 *      AMIT NEM ELLENORIZTUNK." A kuldes elott meg kell gyozodni arrol, hogy a
 *      cel TENYLEG felold; ha nem, a kuldes NEM indul, es a nyom NEVESITETT
 *      okot kap.
 *
 * Egy parameter, amit az egyetlen hivohely mindig `null`-ra allit, nem
 * rugalmassag: az az UT, amin egy jovobeli link ELLENORZES NELKUL becsuszhat.
 *
 * === A FELTETEL, AMI EZT UJRA ELOVESZI ===
 *
 * Ha valaha link kerul a levelbe, akkor acrobot fenti dontese MAR AKKOR is all,
 * es a kuldes-ut feladata, hogy a cel feloldasat ELLENORIZZE -- fuggetlenul
 * attol, hogy az elettartamrol (orak, napok, a jegy lezarasaig) Balazs mit
 * dont. A ket kerdes kulon all.
 */
export function handoverMailBody(input: { message: string }): string {
  return input.message.trim();
}
