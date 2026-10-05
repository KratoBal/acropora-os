/**
 * ONE WEBSHOP MAIL, FROM ITS TEMPLATE AND THE WEBSHOP'S FACTS.
 *
 * The same steps as the OS's own mails (`renderMailBody`, API): escaped
 * values, the shared sanitizer, the text form from the clean HTML. On top of
 * them the blocks, inserted after sanitizing (`renderMailTemplateWithBlocks`),
 * and the webshop's frame.
 *
 * ONE FUNCTION, TWO CALLERS: the render endpoint and the editor's preview.
 * The sanitizer and the e-mail styling live in `@acropora/rich-text`, which
 * this package does not depend on, so both callers pass the same four
 * functions from it (`webshopMailSteps` in each).
 *
 * There is no fallback text, by decision (Balazs, 2026-10-05 20:11 UTC): a
 * template that cannot be rendered returns its reason, and the webshop holds
 * the mail and raises it. A wrong mail cannot be taken back.
 */
import {
  renderMailTemplateWithBlocks,
  type MailRenderSteps,
} from "./mail-blocks.js";
import {
  mailTemplateEventVariables,
  renderMailTemplate,
} from "./mail-template.js";
import {
  SHOP_NAME,
  WEBSHOP_MAIL_KEYS,
  webshopMailContent,
  type WebshopMailFacts,
} from "./webshop-mail.js";

export interface WebshopRenderSteps extends MailRenderSteps {
  /** A plain-text template's paragraphs, as the editor makes them on load. */
  readonly plainToHtml: (text: string, variables: readonly string[]) => string;
  /** The button and alignment styles of a sent mail (`richHtmlForEmail`). */
  readonly forEmail: (clean: string) => string;
}

export interface WebshopTemplateText {
  readonly subject: string;
  readonly body: string;
  readonly bodyHtml?: string | null;
}

export type WebshopMailRender =
  | {
      readonly ok: true;
      readonly subject: string;
      readonly html: string;
      readonly text: string;
    }
  | { readonly ok: false; readonly reason: string };

const names = (list: readonly string[]) =>
  list.map((n) => `{{${n}}}`).join(", ");

/**
 * THE WEBSHOP MAIL'S DOCUMENT: the OS mails' font, size and colour, and the
 * shop's name at the foot, as the webshop's own frame has it today. The
 * webshop sends it unchanged.
 */
export function webshopMailDocument(fragment: string): string {
  return [
    "<!DOCTYPE html>",
    '<html lang="hu"><head><meta charset="utf-8"></head>',
    '<body style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#1f2937;">',
    fragment,
    `<p style="margin-top:24px;color:#6b7280;font-size:12px;">${SHOP_NAME}</p>`,
    "</body></html>",
  ].join("\n");
}

export function renderWebshopMail(
  template: WebshopTemplateText,
  facts: WebshopMailFacts,
  steps: WebshopRenderSteps,
): WebshopMailRender {
  const key = WEBSHOP_MAIL_KEYS[facts.template];
  const { values, blocks } = webshopMailContent(facts);

  const html =
    template.bodyHtml ??
    steps.plainToHtml(
      template.body,
      mailTemplateEventVariables(key).map((x) => x.name),
    );

  /*
    A subject is a header line: a value with a line break (`kovetkezo_lepes`)
    must not open a new header in the webshop's mail. Blocks are not values,
    so a block in the subject is reported as unknown.
  */
  const subject = renderMailTemplate(template.subject, values);
  if (!subject.ok)
    return {
      ok: false,
      reason: `A(z) ${key} sablon tárgyában ismeretlen változó áll: ${names(subject.unknown)}.`,
    };

  const body = renderMailTemplateWithBlocks(html, values, blocks, steps);
  if (!body.ok)
    return {
      ok: false,
      reason: body.misplaced.length
        ? `A(z) ${key} sablonban a blokk nem külön bekezdésben áll: ${names(body.misplaced)}.`
        : `A(z) ${key} sablonban ismeretlen változó áll: ${names(body.unknown)}.`,
    };

  return {
    ok: true,
    subject: subject.text.replace(/[\r\n]+/g, " ").trim(),
    html: webshopMailDocument(steps.forEmail(body.html)),
    text: `${body.text}\n\n${SHOP_NAME}`,
  };
}
