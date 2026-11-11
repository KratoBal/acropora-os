/**
 * THE LEGAL PART OF THE ORDER CONFIRMATION (commerce-audit-2026-10-27, P0 #2;
 * acrobot 36693, option A).
 *
 * === WHY THE OS HOLDS IT ===
 *
 * The customer must receive the terms (ASZF), the withdrawal information, the
 * model withdrawal form and the company's data on a durable medium, that is in
 * the confirmation itself; the webshop's page does not do that. The Fogyasztóbarát
 * API gives its documents only to a registered domain's browser (a server
 * request gets error 1002, and faking the Referer is forbidden), and the OS
 * renders this mail anyway. So the texts live here, in versioned blocks, and
 * the shop only says WHICH version the customer accepted at checkout (the cart's
 * `aszf_elfogadas.verzio`, carried in the facts as `legal_version`).
 *
 * === THE TEXTS ARE PLACEHOLDERS ON PURPOSE ===
 *
 * Acrobot, 36693: do not copy the Fogyasztóbarát texts now; the blocks carry a
 * marked placeholder, and Balázs loads the real texts at the cut-over (card
 * f6cb0a51). Every placeholder block says so in the mail itself
 * (`WEBSHOP_LEGAL_PLACEHOLDER_MARK`), so a test mail cannot pass for a finished
 * one, and `webshopLegalIsComplete` tells a go-live check whether any is left.
 * The company's data comes from `ACROPORA_COMPANY` (one source for every
 * outgoing document); its tax number is only the eight-digit base there and the
 * company registration number is missing, so the two lines are placeholders too.
 *
 * === A VERSION THE OS DOES NOT KNOW IS REFUSED, NOT GUESSED ===
 *
 * The render answers 422 and the shop holds the mail: a confirmation carrying
 * other terms than the customer accepted would be a wrong mail, and a wrong
 * mail cannot be taken back (the same rule the rest of the renderer follows).
 * A missing version (`null`: a cart with no acceptance record) gets no legal
 * part at all, as before this change: the gap is the shop's to close, not
 * something to paper over with a guessed text.
 */
import { ACROPORA_COMPANY } from "./company.js";

export const WEBSHOP_LEGAL_BLOCK_IDS = [
  "aszf",
  "elallasi-tajekoztato",
  "elallasi-nyilatkozat",
  "adatkezeles",
] as const;
export type WebshopLegalBlockId = (typeof WEBSHOP_LEGAL_BLOCK_IDS)[number];

export interface WebshopLegalBlock {
  readonly id: WebshopLegalBlockId;
  readonly title: string;
  /** The paragraphs of the text; empty while the block is a placeholder. */
  readonly paragraphs: readonly string[];
  readonly placeholder: boolean;
}

export const WEBSHOP_LEGAL_PLACEHOLDER_MARK = "[HELYŐRZŐ]";

const placeholderBlock = (
  id: WebshopLegalBlockId,
  title: string,
): WebshopLegalBlock => ({ id, title, paragraphs: [], placeholder: true });

const blocksOfVersion = (): readonly WebshopLegalBlock[] => [
  placeholderBlock("aszf", "Általános szerződési feltételek"),
  placeholderBlock("elallasi-tajekoztato", "Tájékoztató az elállási jogról"),
  placeholderBlock("elallasi-nyilatkozat", "Elállási nyilatkozat (minta)"),
  placeholderBlock("adatkezeles", "Adatkezelési tájékoztató"),
];

export interface WebshopLegalVersion {
  readonly label: string;
  readonly blocks: readonly WebshopLegalBlock[];
}

/**
 * The versions the shop can name. `unas-shop-2026-09-29` is what the checkout
 * records while the Fogyasztóbarát switch is off (the old shop's terms);
 * `fogyasztobarat-JPNFMVH0` is what it records once the switch is on (commerce
 * `ASZF_VERZIO`: `fogyasztobarat-<shop id>`); `teszt-mod` is what the TEST shop records
 * in test mode. A new version is a new entry,
 * never an edit of an old one: an order keeps the version it was placed under.
 */
export const WEBSHOP_LEGAL_VERSIONS: Readonly<
  Record<string, WebshopLegalVersion>
> = {
  "unas-shop-2026-09-29": {
    label: "a mai bolt feltételei (2026-09-29)",
    blocks: blocksOfVersion(),
  },
  "fogyasztobarat-JPNFMVH0": {
    label: "a Fogyasztóbarát dokumentumai",
    blocks: blocksOfVersion(),
  },
  // The TEST shop's mode (commerce `LEGAL_GATE_MODE=test`, Balázs 2026-11-02):
  // Fogyasztóbarát answers only shop.acropora.hu, so the test shop takes orders
  // without its documents and the record names this version. The blocks are the
  // same marked placeholders, so a test mail cannot pass for a finished one; the
  // live shop never records it (the checkout refuses test mode there).
  "teszt-mod": {
    label:
      "teszt kirakat: a jogi dokumentumok az átálláskor a Fogyasztóbarátból jönnek",
    blocks: blocksOfVersion(),
  },
};

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** The company's lines: what the OS knows, and a marked gap for what it does not. */
function companyLines(): readonly string[] {
  return [
    `Név: ${ACROPORA_COMPANY.name}`,
    `Székhely: ${ACROPORA_COMPANY.address}`,
    `Adószám: ${WEBSHOP_LEGAL_PLACEHOLDER_MARK} (az OS-ben csak a törzsszám áll: ${ACROPORA_COMPANY.taxNumberBase})`,
    `Cégjegyzékszám: ${WEBSHOP_LEGAL_PLACEHOLDER_MARK}`,
    `E-mail: ${ACROPORA_COMPANY.email}`,
    `Telefon: ${ACROPORA_COMPANY.phone}`,
    `Web: ${ACROPORA_COMPANY.web}`,
  ];
}

export type WebshopLegalPart =
  | { readonly ok: true; readonly html: string; readonly text: string }
  | { readonly ok: false; readonly reason: string };

/**
 * The legal part of one confirmation, for the version the customer accepted.
 * `null` (or an empty string) is no part: see the header. An unknown version is
 * a refusal with a one-sentence reason the OS shows next to the held mail.
 */
export function webshopLegalPart(
  version: string | null | undefined,
): WebshopLegalPart | null {
  const key = version?.trim();
  if (!key) return null;
  const known = WEBSHOP_LEGAL_VERSIONS[key];
  if (!known)
    return {
      ok: false,
      reason: `A rendelés jogi tájékoztatójának verziója (${key}) ismeretlen, ezért a visszaigazoló nem küldhető el: a vevő más szöveget kapna, mint amit elfogadott.`,
    };

  const blockHtml = known.blocks.map((block) => {
    const body = block.placeholder
      ? `<p><em>${escapeHtml(
          `${WEBSHOP_LEGAL_PLACEHOLDER_MARK} Ide kerül a(z) „${block.title}” szövege.`,
        )}</em></p>`
      : block.paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join("");
    return `<h3 style="margin:20px 0 6px;font-size:14px;">${escapeHtml(block.title)}</h3>${body}`;
  });
  const company = companyLines();
  const html = [
    '<hr style="margin:28px 0 0;border:0;border-top:1px solid #d1d5db;">',
    '<h2 style="margin:16px 0 4px;font-size:16px;">Jogi tájékoztatók</h2>',
    `<p>A rendeléskor elfogadott feltételek szerint: ${escapeHtml(known.label)}.</p>`,
    ...blockHtml,
    '<h3 style="margin:20px 0 6px;font-size:14px;">Az eladó adatai</h3>',
    `<p>${company.map(escapeHtml).join("<br>")}</p>`,
  ].join("");

  const text = [
    "JOGI TÁJÉKOZTATÓK",
    `A rendeléskor elfogadott feltételek szerint: ${known.label}.`,
    ...known.blocks.map((block) =>
      [
        "",
        block.title.toUpperCase(),
        block.placeholder
          ? `${WEBSHOP_LEGAL_PLACEHOLDER_MARK} Ide kerül a(z) „${block.title}” szövege.`
          : block.paragraphs.join("\n\n"),
      ].join("\n"),
    ),
    "",
    "AZ ELADÓ ADATAI",
    ...company,
  ].join("\n");

  return { ok: true, html, text };
}

/** The blocks of a version that still carry no text, by title. */
const missingBlocks = (known: WebshopLegalVersion): readonly string[] =>
  known.blocks
    .filter((b) => b.placeholder || b.paragraphs.length === 0)
    .map((b) => b.title);

/** The company lines that still carry the mark, by their label ("Adószám"). */
const missingCompanyLines = (): readonly string[] =>
  companyLines()
    .filter((line) => line.includes(WEBSHOP_LEGAL_PLACEHOLDER_MARK))
    .map((line) => line.split(":")[0]!);

/**
 * Whether a version carries real texts in every block, and its company lines
 * carry no gap: the go-live check (card f6cb0a51). False today, on purpose.
 */
export function webshopLegalIsComplete(version: string): boolean {
  const known = WEBSHOP_LEGAL_VERSIONS[version];
  if (!known) return false;
  return (
    missingBlocks(known).length === 0 && missingCompanyLines().length === 0
  );
}

/** The version the TEST shop records (commerce `LEGAL_TEST_MODE_VERSION`). */
export const WEBSHOP_LEGAL_TEST_VERSION = "teszt-mod";

/**
 * WHY AN ORDER CONFIRMATION MUST NOT BE SENT YET, or null when it may (card
 * d3ccef2e, barracuda's re-measurement 2026-11-11, finding 1).
 *
 * The placeholder mark keeps a test mail from passing for a finished one, but
 * nothing stopped a LIVE confirmation from going out with it: the customer
 * would get "[HELYŐRZŐ]" where the terms, the withdrawal information and form,
 * the privacy notice and the company's tax and registration numbers belong.
 * So the render endpoint (the one path a sent mail takes) refuses it, and the
 * shop holds the mail as a permanent failure: it is raised at once on the
 * Levélsablonok page and to acrobot, and it can be put back in the queue once
 * the texts are loaded. The editor's preview does not ask this: it shows the
 * placeholders, as before.
 *
 * KEYED ON THE VERSION, NOT ON THE ENVIRONMENT: `teszt-mod` is recorded only
 * on the test shop (the commerce grants test mode on its host allowlist alone)
 * and its mail already says it is the test shop's, so it keeps sending with the
 * marked placeholders. Every other version is a live one, on any OS.
 *
 * A missing version (`null`) and an unknown one are not this function's: the
 * first gets no legal part (see the header), the second the renderer refuses
 * with its own reason. `isComplete` is a seam for the test of the passing
 * branch, which no version reaches today.
 */
export function webshopLegalSendRefusal(
  version: string | null | undefined,
  isComplete: (version: string) => boolean = webshopLegalIsComplete,
): string | null {
  const key = version?.trim();
  if (!key || key === WEBSHOP_LEGAL_TEST_VERSION) return null;
  const known = WEBSHOP_LEGAL_VERSIONS[key];
  if (!known || isComplete(key)) return null;
  const missing = [...missingBlocks(known), ...missingCompanyLines()];
  return `A rendelés jogi tájékoztatójában (${key}) még helyőrző áll, ezért a visszaigazoló nem küldhető el. Hiányzik: ${missing.join(", ")}. A szövegek betöltése után a levél újra sorba tehető.`;
}
