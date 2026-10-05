/**
 * ONE WEBSHOP MAIL, FROM ITS TEMPLATE AND THE WEBSHOP'S FACTS.
 *
 * The same steps as the OS's own mails (`renderMailBody`): escaped values,
 * the shared sanitizer, the text form from the clean HTML. On top of them the
 * blocks, inserted after sanitizing (`renderMailTemplateWithBlocks`). The
 * editor's preview runs the same function, so it shows what goes out.
 *
 * There is no fallback text here, by decision (Balazs, 2026-10-05 20:11 UTC):
 * a template that cannot be rendered returns its reason, and the webshop
 * holds the mail and raises it. A wrong mail cannot be taken back.
 */
import {
  plainTextToRichHtml,
  richHtmlToText,
  sanitizeRichHtml,
} from "@acropora/rich-text";
import {
  SHOP_NAME,
  mailTemplateEventVariables,
  renderMailTemplate,
  renderMailTemplateWithBlocks,
  webshopMailContent,
  WEBSHOP_MAIL_KEYS,
  type WebshopMailFacts,
} from "@acropora/types";

import { webshopMailHtmlDocument } from "./webshop-mail.content.js";

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

export function renderWebshopMail(
  template: WebshopTemplateText,
  facts: WebshopMailFacts,
): WebshopMailRender {
  const key = WEBSHOP_MAIL_KEYS[facts.template];
  const { values, blocks } = webshopMailContent(facts);

  /*
    A stored template without HTML is a plain-text save. It goes through the
    same path, turned into paragraphs the way the editor turns it on load.
  */
  const html =
    template.bodyHtml ??
    plainTextToRichHtml(template.body, {
      variables: mailTemplateEventVariables(key).map((x) => x.name),
    });

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

  const body = renderMailTemplateWithBlocks(html, values, blocks, {
    sanitize: (raw) => sanitizeRichHtml(raw),
    toText: (clean) => richHtmlToText(clean),
  });
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
    html: webshopMailHtmlDocument(body.html),
    text: `${body.text}\n\n${SHOP_NAME}`,
  };
}
