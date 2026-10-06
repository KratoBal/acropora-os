/**
 * BLOCK VARIABLES: A FIXED, SYSTEM-BUILT PIECE OF A MAIL.
 *
 * Balazs's decision for the webshop mails (2026-10-05 20:11 UTC): the editor
 * may move a block, but not change what is inside it. The item list, the
 * pickup point or the "pay on delivery" box is built by the system from the
 * order, so it always matches the order.
 *
 * === WHY A BLOCK IS INSERTED AFTER SANITIZING ===
 *
 * A value goes through `renderMailTemplateHtml`, which escapes it: a value is
 * text, never markup. A block IS markup (a list, a styled box, a logo), and
 * part of that markup is exactly what the sanitizer removes from edited text
 * (`style`, external `img`). So the order is:
 *
 *   1. the block's paragraph becomes a one-time marker
 *   2. values are substituted, escaped           (`renderMailTemplateHtml`)
 *   3. the edited HTML is sanitized              (caller's `sanitize`)
 *   4. the plain text is made from the clean HTML (caller's `toText`)
 *   5. the marker is replaced by the block, in the HTML and in the text
 *
 * The block's markup never passes through the editor and never comes from the
 * caller's data: the builders escape every value they put into it.
 *
 * === A BLOCK STANDS ALONE IN ITS PARAGRAPH ===
 *
 * A block is block-level markup, and `<p>text <ul>…</ul></p>` is broken HTML
 * that mail clients repair differently. So a block may only stand as the only
 * content of a paragraph. Anything else is refused on save
 * (`misplacedBlockVariables`) and again at render time.
 */
import {
  renderMailTemplateHtml,
  type MailTemplateValues,
} from "./mail-template.js";

/** A built block: its markup and its plain-text form, said the same way. */
export interface MailBlock {
  readonly html: string;
  readonly text: string;
}

/**
 * The blocks of one mail. `null` means "not in this mail" (a home delivery
 * has no pickup point): the block's paragraph disappears, without a gap.
 */
export type MailBlocks = Readonly<Record<string, MailBlock | null>>;

/** The two steps the caller owns: the shared sanitizer and the text form. */
export interface MailRenderSteps {
  readonly sanitize: (html: string) => string;
  readonly toText: (html: string) => string;
}

export type MailBlockRender =
  | { readonly ok: true; readonly html: string; readonly text: string }
  | {
      readonly ok: false;
      /** Variables the template uses and the values do not give. */
      readonly unknown: readonly string[];
      /** Blocks that do not stand alone in their paragraph. */
      readonly misplaced: readonly string[];
    };

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The paragraph that holds only this block, as the editor stores it
 * (`<span data-variable="name">{{name}}</span>`) or typed by hand.
 */
function aloneParagraph(name: string): RegExp {
  const n = escapeRegExp(name);
  return new RegExp(
    `<p(?:\\s[^>]*)?>\\s*(?:<span data-variable="${n}">\\s*)?\\{\\{\\s*${n}\\s*\\}\\}(?:\\s*</span>)?\\s*</p>`,
    "g",
  );
}

function anyPlaceholder(name: string): RegExp {
  return new RegExp(`\\{\\{\\s*${escapeRegExp(name)}\\s*\\}\\}`, "g");
}

/**
 * The blocks this template uses outside a paragraph of their own. The editor
 * and the save endpoint ask this, so the mistake shows up while editing, not
 * when the mail would go out.
 */
export function misplacedBlockVariables(
  html: string,
  blockNames: readonly string[],
): readonly string[] {
  return blockNames.filter((name) =>
    anyPlaceholder(name).test(html.replace(aloneParagraph(name), "")),
  );
}

/** A marker no value can contain: random per render, letters and digits. */
function newNonce(): string {
  return globalThis.crypto.randomUUID().replace(/-/g, "");
}

/**
 * Renders an HTML template with values AND blocks. Values are escaped text,
 * blocks are system-built markup inserted after sanitizing.
 *
 * Nothing is rendered when a variable is unknown or a block is misplaced,
 * for the reason `renderMailTemplate` gives: a mail that does not go out can
 * be sent later, a wrong one cannot be taken back.
 */
export function renderMailTemplateWithBlocks(
  template: string,
  values: MailTemplateValues,
  blocks: MailBlocks,
  steps: MailRenderSteps,
  nonce: string = newNonce(),
): MailBlockRender {
  const names = Object.keys(blocks);
  const misplaced = misplacedBlockVariables(template, names);

  const markers = new Map<string, string>();
  let marked = template;
  names.forEach((name, i) => {
    const marker = `ACROPORABLOCK${nonce}N${i}X`;
    markers.set(marker, name);
    marked = marked.replace(aloneParagraph(name), `<p>${marker}</p>`);
  });

  /*
    Misplaced block placeholders are still in `marked`. They are neither
    values nor markers, so the value step reports them as unknown; they are
    reported as misplaced instead, which names the actual fix.
  */
  const substituted = renderMailTemplateHtml(marked, {
    ...values,
    ...Object.fromEntries(misplaced.map((name) => [name, ""])),
  });
  const unknown = substituted.ok ? [] : substituted.unknown;
  if (!substituted.ok || misplaced.length)
    return { ok: false, unknown, misplaced };

  /*
    A conditional sentence is a value that may be empty. Standing alone in its
    paragraph, an empty one would leave an empty line in the mail; the
    paragraph goes with it. Only empty ones: a paragraph with any text stays.
  */
  const clean = steps
    .sanitize(substituted.text)
    .replace(
      /<p(?:\s[^>]*)?>(?:\s|<br>|<span data-variable="[^"]*">\s*<\/span>)*<\/p>/g,
      "",
    );
  const text = steps.toText(clean);

  let html = clean;
  for (const [marker, name] of markers) {
    const block = blocks[name] ?? null;
    html = html
      .split(`<p>${marker}</p>`)
      .join(block && block.html ? block.html : "");
  }
  const paragraphs = text
    .split("\n\n")
    .map((paragraph) => {
      const name = markers.get(paragraph.trim());
      if (name === undefined) return paragraph;
      return blocks[name]?.text ?? "";
    })
    .filter((paragraph) => paragraph !== "");
  return { ok: true, html, text: paragraphs.join("\n\n") };
}
