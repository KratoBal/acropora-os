/**
 * A LEVEL-SABLON BEHELYETTESITESE -- KULSO SZOVEG, TEHAT OVATOSAN.
 *
 * Balazs kerese, 2026-09-21 11:39:56 UTC (Discord, fo csatorna, message_id
 * 1551558600474886145), szo szerint: "igy jo es ha lehet akkor legyenek
 * valtozok amiket be tudok illeszteni a level torzsebe".
 *
 * === A VALTOZOK LISTAJA EXPORTALT ADAT, NEM A DOKUMENTACIOBAN ALL ===
 *
 * acrobot elso kikotese, es szerinte a negy kozul a legfontosabb: a szotar
 * latszodjon a szerkeszto mellett. Egy behelyettesito nyelv, aminek a szotara
 * nincs kiirva, hasznalhatatlan -- senki nem fogja kitalalni, hogy
 * `{{jegyszam}}` vagy `{{jegy_szama}}` a helyes alak.
 *
 * EZERT A LISTA KOD, NEM KOMMENT: a felulet ugyanezt a tombot kapja meg a
 * vegponton at, tehat a szotar es a motor NEM TUD ELCSUSZNI egymastol. Ha
 * kezzel irt lista allna a feluleten, az elso uj valtozonal ketté valna.
 */

export interface MailTemplateVariable {
  /** A sablonban igy kell leirni, `{{` es `}}` kozott. */
  readonly name: string;
  /** Mit tesz a helyere, emberi szoval -- ez megy ki a szerkeszto melle. */
  readonly description: string;
}

/**
 * AMI A KULDES PILLANATABAN RENDELKEZESRE ALL -- ES NEM TOBB.
 *
 * acrobot kikotese: "merd le, mi all rendelkezesre a kuldes pillanataban, es
 * NE igerj tobbet". Ez a negy mezo a hibajegy sorabol es a nyito User sorabol
 * jon, mind a ketto a kezunkben van a kuldeskor. Amit NEM veszek fel: a
 * munkalap adatai (a jegy alatt tobb lap is allhat, tehat egy `{{munkalap}}`
 * valtozo nem lenne egyertelmu) es a partner kapcsolattartoja (ma nincs ilyen
 * mezo).
 */
export const MAIL_TEMPLATE_VARIABLES: readonly MailTemplateVariable[] = [
  { name: "cimzett", description: "A hibajegy nyitójának neve." },
  { name: "jegyszam", description: "A hibajegy száma, például HJ-2026-001." },
  { name: "jegy_targya", description: "A hibajegy címe." },
  {
    name: "jegy_leirasa",
    description: "A bejelentés szövege. Üres, ha nincs kitöltve.",
  },
] as const;

export type MailTemplateValues = Readonly<Record<string, string>>;

export type MailTemplateRender =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly unknown: readonly string[] };

const HELY = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/**
 * ISMERETLEN VALTOZONAL NEM RENDERELUNK -- SE URESET, SE NYERS `{{...}}`-T.
 *
 * acrobot masodik kikotese, es az indoka a sajat lapomon is all: egy elgepelt
 * mezonevtol a mondat ERTELMES MARAD, csak mast mond. Ez a behelyettesites
 * legalattomosabb alakja: nem csonkit, hanem MODOSIT, es a hossz sem arulja el.
 *
 *   ures stringgel      "Kedves !" -- a vevo latja, mi meg nem tudjuk meg soha
 *   nyers `{{izé}}`-vel a vevo latja a belso mezonevunket
 *   NEM RENDERELUNK     a kuldes megnevezett okkal kimarad, es a naplo megmondja
 *
 * A harmadik a helyes: a nem kikuldott level POTOLHATO, a kikuldott nem.
 * MINDEN ismeretlen nevet osszegyujtunk, nem csak az elsot -- kulonben a
 * szerkeszto egyesevel, ujrakuldesenkent tudna meg, hany elgepelese van.
 */
export function renderMailTemplate(
  template: string,
  values: MailTemplateValues,
): MailTemplateRender {
  const ismeretlen: string[] = [];
  const text = template.replace(HELY, (_egesz, nev: string) => {
    if (!Object.prototype.hasOwnProperty.call(values, nev)) {
      ismeretlen.push(nev);
      return "";
    }
    return values[nev] ?? "";
  });
  return ismeretlen.length
    ? { ok: false, unknown: [...new Set(ismeretlen)] }
    : { ok: true, text };
}

/**
 * A SABLON ALLITASA A SZERKESZTESKOR -- HOGY A HIBA OTT DERULJON KI.
 *
 * Ugyanaz a motor, de a kimenete a SZERKESZTONEK szol, nem a vevonek. Enelkul
 * egy elgepelt mezonev csak a kovetkezo valodi kuldeskor bukna ki, amikor mar
 * senki nem emlekszik ra, hogy a sablont atirtak.
 */
export function unknownTemplateVariables(template: string): readonly string[] {
  const ismertek = new Set(MAIL_TEMPLATE_VARIABLES.map((v) => v.name));
  const talalt = [...template.matchAll(HELY)].map((m) => m[1] as string);
  return [...new Set(talalt.filter((n) => !ismertek.has(n)))];
}
