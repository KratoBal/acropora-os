/**
 * A FORMAZOTT SZOVEG SIMA SZOVEGES VETULETE.
 *
 * Ez lesz a level `text/plain` resze a HTML mellett. Nem kulon irt szoveg,
 * hanem a HTML-bol keszul, tehat a ket alternativa nem mondhat mast.
 *
 * === MIERT SAJAT, ES NEM EGY KESZ KONVERTER ===
 *
 * A bemenetet eloszor a `sanitizeRichHtml` tisztitja, tehat itt csak a
 * `RICH_TEXT_ALLOWED_TAGS` tizenot tagje fordulhat elo, jol formazottan. Erre
 * egy tokenizalo eleg; egy altalanos HTML-konverter uj fuggoseg lenne olyan
 * esetekre, amik a tisztitas utan nem letezhetnek.
 */
import { sanitizeRichHtml, type SanitizeRichHtmlOptions } from "./sanitize.js";

const ENTITASOK: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function entitasFeloldas(szoveg: string): string {
  return szoveg.replace(
    /&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g,
    (egesz, kod: string) => {
      if (kod.startsWith("#x"))
        return String.fromCodePoint(Number.parseInt(kod.slice(2), 16));
      if (kod.startsWith("#"))
        return String.fromCodePoint(Number.parseInt(kod.slice(1), 10));
      return ENTITASOK[kod] ?? egesz;
    },
  );
}

const BLOKK = new Set(["p", "h2", "h3", "blockquote", "ul", "ol", "hr"]);
const TOKEN = /<(\/?)([a-zA-Z0-9]+)([^>]*)>|([^<]+)/g;

interface Lista {
  readonly szamozott: boolean;
  sorszam: number;
}

/**
 * A BLOKKOK KOZOTT EGY URES SOR, A `<br>` EGY SORTORES.
 *
 * Ez pontosan a `plainTextToRichHtml` forditottja: az ures sor mentén bekezdes
 * lesz, az egyes sortoresbol `<br>`. A ket fuggveny oda-vissza utja a mai
 * szoveges sablonokat karakterre visszaadja, es erre allitas all -- kulonben az
 * atallas csendben atirna a meglevo leveleket.
 *
 * A LINK: `szoveg (cim)`, kiveve ha a szoveg maga a cim. A sima szoveges
 * levelben a link-jeloles elveszne, a cim nem.
 */
export function richHtmlToText(
  html: string,
  options: SanitizeRichHtmlOptions = {},
): string {
  const tiszta = sanitizeRichHtml(html, options);
  const blokkok: string[] = [];
  let aktualis = "";
  const listak: Lista[] = [];
  const linkek: { cim: string | null; kezdet: number }[] = [];

  const lezar = () => {
    const sor = aktualis.replace(/[ \t]+\n/g, "\n").trim();
    if (sor) blokkok.push(sor);
    aktualis = "";
  };

  for (const m of tiszta.matchAll(TOKEN)) {
    const [, zaro, nyersTag, attrs, szoveg] = m;
    if (szoveg !== undefined) {
      /*
        A HTML-BEN A SORTORES ES A TOBB SZOKOZ EGY SZOKOZ -- a bongeszo is igy
        jeleniti meg. A nem tordelo szokoz (`&nbsp;` vagy nyers U+00A0)
        nincs a mintaban, tehat megmarad.
      */
      aktualis += entitasFeloldas(szoveg.replace(/[ \t\n\r\f]+/g, " "));
      continue;
    }
    const tag = (nyersTag as string).toLowerCase();
    if (tag === "br") {
      aktualis += "\n";
      continue;
    }
    if (tag === "hr") {
      lezar();
      blokkok.push("----------");
      continue;
    }
    if (tag === "a") {
      if (!zaro) {
        const href = /href="([^"]*)"/.exec(attrs ?? "");
        linkek.push({
          cim: href ? entitasFeloldas(href[1] as string) : null,
          kezdet: aktualis.length,
        });
      } else {
        const link = linkek.pop();
        const felirat = link ? aktualis.slice(link.kezdet).trim() : "";
        if (link?.cim && link.cim !== felirat) aktualis += ` (${link.cim})`;
      }
      continue;
    }
    /*
      EGY LISTA EGY BLOKK, A BEAGYAZOTT LISTAVAL EGYUTT. Csak a legkulso lista
      nyit es zar blokkot; a belso csak a behuzast noveli.
    */
    if (tag === "ul" || tag === "ol") {
      if (!zaro) {
        if (listak.length === 0) lezar();
        listak.push({ szamozott: tag === "ol", sorszam: 0 });
      } else {
        listak.pop();
        if (listak.length === 0) lezar();
      }
      continue;
    }
    if (tag === "li") {
      if (!zaro) {
        const lista = listak[listak.length - 1];
        const behuzas = "  ".repeat(Math.max(0, listak.length - 1));
        if (aktualis.trim()) aktualis += "\n";
        if (lista) lista.sorszam += 1;
        aktualis += `${behuzas}${lista?.szamozott ? `${lista.sorszam}.` : "-"} `;
      }
      continue;
    }
    /*
      A LISTAELEMEN BELULI BEKEZDES NEM BLOKK. A TipTap minden listaelem
      szoveget `<p>`-be teszi (`<li><p>tej</p></li>`); ha az itt lezarna, a
      jel (`- `) es a szoveg ket kulon bekezdesbe esne.
    */
    if (BLOKK.has(tag)) {
      if (listak.length === 0) lezar();
      continue;
    }
    // strong, em, u, s, span: a szovegben nincs nyomuk.
  }
  lezar();
  return blokkok.join("\n\n");
}
