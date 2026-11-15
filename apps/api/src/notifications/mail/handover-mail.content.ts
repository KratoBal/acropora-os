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
 * A LEVEL TORZSE: A KEZELO SZOVEGE, ES (HA VAN BEALLITVA PORTAL-CIM) EGY SOR A HIBAJEGY LINKJEVEL.
 *
 * === 2026-11-15: A FENTI "SEMMI MAS" EGY SORRAL BOVULT (Balazs, 2026-10-08, "2 igen") ===
 *
 * A link NEM a letoltes (az tovabbra sincs), hanem a partner-portal MEGLEVO hibajegy-oldala, a konfiguralt
 * `PARTNER_URL`-bol epitve (`partnerTicketLink`). Ures `PARTNER_URL` mellett a level link nelkul megy ki, es a
 * jegy naploja megnevezi, miert maradt ki. Az alabbi tortenet a MEGSZUNT `note` parameterrol szol.
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
export function handoverMailBody(input: {
  message: string;
  /** A hibajegy linkje a partner-portalon (`partnerTicketLink`); ures vagy hianyzo: nem kerul a levelbe. */
  portalLink?: string;
}): string {
  const message = input.message.trim();
  return input.portalLink
    ? `${message}\n\n${handoverMailPortalLinkLine(input.portalLink)}`
    : message;
}

/**
 * A PORTAL-LINK MONDATA (Balazs, 2026-10-08: "2 igen"): a kezelo szovege UTAN all, egy ures sorral elvalasztva, es a
 * kikuldes elott a kezelo LATJA (az elonezet visszaadja). Ez az EGYETLEN dolog, ami a kezelo szoveget kiegesziti,
 * es a kezelo nem tudja kivenni: a hibajegy linkje a vevo sajat portal-felületére visz, a vevo ugyanazt az
 * esemenyt (a lezaras) ott is latja.
 */
export function handoverMailPortalLinkLine(portalLink: string): string {
  return `A hibajegy a partnerportálon is megnézhető: ${portalLink}`;
}
