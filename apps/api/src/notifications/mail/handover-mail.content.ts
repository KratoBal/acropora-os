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
 * A LEVEL TORZSE: A KEZELO SZOVEGE, ES AMI MELLE KERUL.
 *
 * A `note` a meret-kapu mondata, ha a csomag nem fert ra. `null`, ha ratett.
 *
 * A KEZELO SZOVEGE ELOL ALL, es ez szandekos: a vevo azt olvassa el eloszor,
 * amit EMBER irt neki. A rendszer mondata utana jon, ures sorral elvalasztva --
 * kulonben a ket hang osszefolyik, es a vevo nem tudja, melyik melyik.
 */
export function handoverMailBody(input: {
  message: string;
  note: string | null;
}): string {
  const reszek = [input.message.trim()];
  if (input.note) reszek.push(input.note);
  return reszek.join("\n\n");
}
