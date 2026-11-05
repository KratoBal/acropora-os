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
  /** A beadott valasz, megjeleniteshez (`answerForMail` szuri); ha nincs, a bekezdes kimarad. */
  readonly answer?: string | null;
  /** A kerdes zarasa: a megerosites eddig ervenyes. */
  readonly closesAt?: Date | null;
}

const MAX_ANSWER_CHARS = 120;

/**
 * A BEADOTT VALASZ, AMIT A LEVELBE ENGEDUNK. A beküldő egy ISMERETLEN címre is küldhet beadást, tehát a válasz szövege
 * az Acropora feladójáról egy idegennek érkezik: egy hosszú vagy linket tartalmazó "válasz" ezen a csatornán átmenne
 * (és a sima szöveges levélben a levelezők a linket kattinthatóvá teszik). Ezért csak a RÖVID, link- és címmentes válasz
 * kerül a levélbe; minden más esetben a válasz nem idézett, a levél többi része változatlan. A szóközök egyre vannak
 * húzva, a vezérlőkarakterek kiesnek.
 */
export function answerForMail(
  answer: string | null | undefined,
): string | null {
  if (typeof answer !== "string") return null;
  // eslint-disable-next-line no-control-regex
  const tiszta = answer
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (tiszta === "" || tiszta.length > MAX_ANSWER_CHARS) return null;
  if (/:\/\/|www\.|@|[<>]/i.test(tiszta)) return null;
  return tiszta;
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
  "Erősítsd meg a játékodat: Acropora karácsonyi nyereményjáték";
export const CONFIRMATION_BUTTON = "Megerősítem a részvételem";

/** A tiszta HTML-torzs és a szöveges vetülete; a küldő mindkettőt viszi (`html` + `text`). */
export function renderConfirmationMail(input: ConfirmationMailInput): {
  html: string;
  text: string;
} {
  const kerdes = input.prompt?.trim();
  const valasz = answerForMail(input.answer);
  const nyers = [
    "<h2>Acropora karácsonyi nyereményjáték</h2>",
    "<p>Szia!</p>",
    "<p>Köszönjük, hogy játszol az Acropora karácsonyi nyereményjátékán. A játékod akkor érvényes, ha megerősíted.</p>",
    ...(kerdes
      ? [`<p>A heti kérdés: <strong>${escapeHtml(kerdes)}</strong></p>`]
      : []),
    ...(valasz
      ? [`<p>A beküldött válaszod: <strong>${escapeHtml(valasz)}</strong></p>`]
      : []),
    `<p data-align="center" data-cta=""><a href="${escapeHtml(input.link)}">${CONFIRMATION_BUTTON}</a></p>`,
    ...(input.closesAt
      ? [
          `<p>A megerősítés a kérdés zárásáig érvényes: <strong>${escapeHtml(closingForMail(input.closesAt))}</strong> (budapesti idő).</p>`,
        ]
      : []),
    `<p>Ha a gomb nem működik, másold be ezt a címet a böngészőbe: <a href="${escapeHtml(input.link)}">${escapeHtml(input.link)}</a></p>`,
    "<p>Ha nem te küldted be ezt a választ, nincs teendőd: megerősítés nélkül a beküldés nem számít.</p>",
    "<p>Acropora</p>",
  ].join("");
  const html = sanitizeRichHtml(nyers);
  return { html, text: richHtmlToText(html) };
}
