/**
 * A LEVEL SZOVEGE: ELORE KITOLTOTT RESZ PLUSZ EGY ELHAGYHATO SZABAD SZOVEG.
 *
 * Balazs kerese, 2026-09-21 11:37:11 UTC (Discord, fo csatorna, message_id
 * 1551557907982721155), szo szerint: "en azt szeretnem, hogyha elkuldjuk a
 * barmit az ugyfelnek akkor legyen egy beiro mezo ahova be lehet gepelni az
 * uzenetet. nyilvan amit tudunk -cimzett, hibajegy leirasa, szama stb az
 * legyen elore kitoltve es lehet valami egyen szoveg is, de mindenkeppen
 * szeretnek a levelbe szemelyes erintettseget is"
 *
 * EZERT A TORZS NEM EGETHETO A KODBA. Amit tudunk, azt ez a fuggveny rakja
 * ossze; amit EMBER ir, az kivulrol erkezik.
 *
 * ES HA NINCS SZABAD SZOVEG, NEM TALALUNK KI HELYETTE SEMMIT. A hianyzo
 * szemelyes resz hianyzik; egy kitalalt mondat ("Kerem, keressen minket
 * bizalommal") pont azt a szemelyes erintettseget hamisitana meg, amiert a
 * mezo letezik.
 */
import { escapeHtml } from "@acropora/rich-text";

export interface TicketMailContent {
  readonly text: string;
  /**
   * A KERET HTML-IKRE, csak ha az esemeny-resz is HTML (`eventHtml`). Tisztitott
   * toredek: a kodbol jovo reszek escape-elve, a sablon resze mar tisztan erkezik.
   */
  readonly html?: string;
}

/**
 * CSAK A TORZS. A TARGY A SABLONE, es ez nem felosztasi izles: a targyat a
 * `TicketMailTemplate.subject` adja, tehat ha ez a fuggveny is eloallitana
 * egyet, KET helyen allna ugyanaz a szabaly -- es a valodi uton csak az egyik
 * sulne el. (Merve: az elso valtozatomban pontosan ez tortent, es a
 * fejlec-orzot a halott agra tettem.)
 */
export function ticketMailContent(input: {
  recipientName: string;
  jobNumber: string;
  title: string;
  description: string | null;
  /**
   * MI TORTENT. Parameter, nem beegetett mondat: ugyanez a level-osszeallito
   * szolgalja ki a lezart jegy kikuldeset (5247bf3c) is, es ott mas esemeny
   * all. EGY mezo, nem keretrendszer.
   */
  event: string;
  /**
   * UGYANAZ AZ ESEMENY, FORMAZOTTAN -- ha a sablon HTML. Tisztitott toredek
   * (`renderMailBody` kimenete). Hianyaban a level szoveges marad, a mai alakban.
   */
  eventHtml?: string;
  /**
   * AZ EMBER SZAVAI. ELHAGYHATO, es a hianya NEM hiba.
   *
   * acrobot kikotese (2026-09-21): meg nincs eldontve, hogy az alairas-ertesites
   * ember altal inditott legyen-e. Ma automatikus esemeny, es ott nincs ki
   * gepeljen. Elhagyhato parameterkent MIND A KET valasz belefer, es egyik sem
   * kivan ujrairast.
   */
  freeText?: string | null;
}): TicketMailContent {
  const szabad = input.freeText?.trim() || null;
  const leiras = input.description?.trim() || null;

  const sorok = [
    `Kedves ${input.recipientName}!`,
    "",
    input.event,
    "",
    `Hibajegy száma: ${input.jobNumber}`,
    `Tárgya: ${input.title}`,
  ];

  /*
    A LEIRAS CSAK AKKOR KERUL BE, HA VAN. Egy "Leírás: (nincs)" sor tobbet
    allit a semminel: azt mondja, hogy megneztuk es ures, holott a mezo
    egyszeruen nincs kitoltve.
  */
  if (leiras) sorok.push("", "A bejelentés szövege:", leiras);
  if (szabad) sorok.push("", szabad);

  sorok.push("", "Üdvözlettel:", "Acropora Kft.");

  const text = sorok.join("\n");
  if (input.eventHtml === undefined) return { text };

  /*
    A HTML KERET UGYANAZT A SORRENDET KOVETI, MINT A SZOVEGES -- es erre allitas
    all: a HTML szoveges vetulete a fenti `text`. Ha a ketto elcsuszna, a
    levelezo a HTML-t mutatja, a masik alternativa pedig mast mondana.
  */
  const bekezdes = (szoveg: string) =>
    `<p>${escapeHtml(szoveg).replace(/\n/g, "<br>")}</p>`;
  const html = [
    bekezdes(`Kedves ${input.recipientName}!`),
    input.eventHtml,
    bekezdes(`Hibajegy száma: ${input.jobNumber}\nTárgya: ${input.title}`),
    leiras ? bekezdes(`A bejelentés szövege:\n${leiras}`) : "",
    szabad ? bekezdes(szabad) : "",
    bekezdes("Üdvözlettel:\nAcropora Kft."),
  ].join("");
  return { text, html };
}
