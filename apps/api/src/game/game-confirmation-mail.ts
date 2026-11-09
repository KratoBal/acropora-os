import {
  escapeHtml,
  richHtmlToText,
  sanitizeRichHtml,
} from "@acropora/rich-text";

/**
 * A MEGEROSITO LEVEL TORZSE (acrobot, 2026-11-06 00:52): az "email" profil szerinti formazott level, a tobbi Acropora-level
 * Figma-keretben. NEM sajat sablon-dokumentum: a keretet (`mailHtmlDocument`) a MIME-epito adja, a gombot (`data-cta`)
 * a `richHtmlForEmail` irja inline stilusra, es a kuldo kapuja valtozatlan (acrobot: a kuldo egyetlen kapuja egy
 * levelstilus miatt nem szelesedik). A szoveges alternativa ugyanabbol a tiszta HTML-bol keszul (`richHtmlToText`), tehat
 * a kettő nem mondhat mast.
 *
 * AZ ERTEKEK ESCAPE-ELVE MENNEK A HTML-BE, majd a tisztito fut (a kuldo kapuja ugyanezt a sorrendet varja: a tisztitott
 * torzs a sajat kimenetén valtozatlan). A link cime a tokenbol es a JATEK_PUBLIC_URL-bol all.
 */
export interface ConfirmationMailInput {
  /** A megerosito link (JATEK_PUBLIC_URL + token). */
  readonly link: string;
  /** A heti kerdes szovege; ha nincs, a bekezdes kimarad. */
  readonly prompt?: string | null;
  /**
   * A VALASZTOS KERDES FELIRATA, amit a jatekos valasztott: a MI szovegunk (az admin allitotta be). A SZABAD SZOVEGES
   * VALASZ SOHA NEM KERUL A LEVELBE (barracuda, #2263 review): a beadas barmely cimre mehet, tehat egy ilyen valasz
   * szovege egy idegen postafiokjaba erkezne az Acropora feladojarol, a sajat arculatunkban. Szurot (hossz, link, @)
   * probaltam eloszor, es a csupasz domain (`nyeremeny-acropora.hu/atvetel`), a telefonszam es a rovid felhivas atment
   * rajta, a levelezok pedig kattinthatova teszik. Ami nem a mi szovegunk, az nem megy ki: ezert a mezo neve nem
   * `answer`, hogy egy szabad valaszt veletlenul se lehessen ide adni.
   */
  readonly choiceLabel?: string | null;
  /** A kerdes zarasa: a megerosites eddig ervenyes. */
  readonly closesAt?: Date | null;
}

const BUDAPEST = "Europe/Budapest";

/** A zárás időpontja a levélben: budapesti idő, "2026. november 13., 23:59". */
export function closingForMail(closesAt: Date): string {
  const nap = new Intl.DateTimeFormat("hu-HU", {
    timeZone: BUDAPEST,
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(closesAt);
  const ora = new Intl.DateTimeFormat("hu-HU", {
    timeZone: BUDAPEST,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(closesAt);
  return `${nap}, ${ora}`;
}

export const CONFIRMATION_SUBJECT =
  "Erősítsd meg a részvételed: Acropora karácsonyi nyereményjáték";

/**
 * A KORÁBBI TÁRGYAK, amikkel a megerősítő levél már kiment a ticket@ postafiókból (a játék saját Brevo-küldője előtt, és a
 * tárgy átírása előtt: Balázs, 2026-11-06). Az adattörlés a küldő postafiókban a tárgy alapján keresi az elküldött
 * példányokat, ezért a régi tárgyú levelek (a próbák) is a keresésben maradnak.
 */
export const LEGACY_CONFIRMATION_SUBJECTS: readonly string[] = [
  "Erősítsd meg a játékodat: Acropora karácsonyi nyereményjáték",
];
export const CONFIRMATION_BUTTON = "Megerősítem a részvételem";

/**
 * A PRÓBALEVÉL TOKENJÉNEK ELŐTAGJA (acrobot 44553): az admin "Próbalevél küldése" gombja ezzel kezdődő tokent tesz a linkbe, és a
 * játék /megerosites oldala ezt felismeri ("Ez próbalevél volt: a link működik."). A PONT SZÁNDÉKOS: a valódi token
 * base64url (A-Z a-z 0-9 - _), abban nincs pont, tehát egy valódi token soha nem kezdődhet így. Az előtagot a játék appja is
 * ismeri (apps/jatek/src/lib/proba-token.ts); az api egyik specje a kettőt összeveti.
 */
export const TEST_TOKEN_PREFIX = "proba.";

/** A tiszta HTML-torzs és a szöveges vetülete; a küldő mindkettőt viszi (`html` + `text`). */
export function renderConfirmationMail(input: ConfirmationMailInput): {
  html: string;
  text: string;
} {
  const kerdes = input.prompt?.trim();
  const valasz = input.choiceLabel?.trim() || null;
  const nyers = [
    "<h2>Acropora karácsonyi nyereményjáték</h2>",
    "<p>Szia!</p>",
    "<p>Köszönjük, hogy játszol az Acropora karácsonyi nyereményjátékán. Kérünk, hogy erősítsd meg részvételed:</p>",
    ...(kerdes
      ? [`<p>A heti kérdés: <strong>${escapeHtml(kerdes)}</strong></p>`]
      : []),
    ...(valasz
      ? [`<p>A beküldött válaszod: <strong>${escapeHtml(valasz)}</strong></p>`]
      : []),
    `<p data-align="center" data-cta=""><a href="${escapeHtml(input.link)}">${CONFIRMATION_BUTTON}</a></p>`,
    ...(input.closesAt
      ? [
          `<p>Megerősíteni eddig az időpontig tudsz: <strong>${escapeHtml(closingForMail(input.closesAt))}</strong> (budapesti idő).</p>`,
        ]
      : []),
    `<p>Ha a gomb nem működik, másold be ezt a címet a böngészőbe: <a href="${escapeHtml(input.link)}">${escapeHtml(input.link)}</a></p>`,
    "<p>Ha nem te küldted be ezt a választ, nincs teendőd: megerősítés nélkül a beküldés nem számít.</p>",
    "<p>Acropora</p>",
  ].join("");
  const html = sanitizeRichHtml(nyers);
  return { html, text: richHtmlToText(html) };
}
