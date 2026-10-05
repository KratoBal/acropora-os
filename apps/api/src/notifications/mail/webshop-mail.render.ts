/**
 * The webshop mail renderer (`@acropora/types`) bound to the shared sanitizer
 * and e-mail styling. The editor's preview binds the same four functions.
 */
import {
  plainTextToRichHtml,
  richHtmlForEmail,
  richHtmlToText,
  sanitizeRichHtml,
} from "@acropora/rich-text";
import {
  renderWebshopMail as render,
  type WebshopMailFacts,
  type WebshopMailRender,
  type WebshopRenderSteps,
  type WebshopTemplateText,
} from "@acropora/types";

export const webshopMailSteps: WebshopRenderSteps = {
  sanitize: (raw) => sanitizeRichHtml(raw),
  toText: (clean) => richHtmlToText(clean),
  plainToHtml: (text, variables) => plainTextToRichHtml(text, { variables }),
  forEmail: richHtmlForEmail,
};

export function renderWebshopMail(
  template: WebshopTemplateText,
  facts: WebshopMailFacts,
): WebshopMailRender {
  return render(template, facts, webshopMailSteps);
}
