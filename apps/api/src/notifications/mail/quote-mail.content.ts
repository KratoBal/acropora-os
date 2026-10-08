/**
 * THE QUOTE MAIL'S BUILT-IN TEXT (#1582 P3). Plain text: the PDF goes as an
 * attachment. The Levelezés page can override it (`QUOTE_SEND`); the send
 * drawer opens with the result, variables already filled in, and can be
 * edited before sending.
 */
export const QUOTE_SEND = "QUOTE_SEND";

export const DEFAULT_QUOTE_SEND_TEMPLATE = {
  subject: "Acropora árajánlat: {{ajanlat_szama}} · {{ajanlat_megnevezese}}",
  body: [
    "Tisztelt {{ajanlat_ugyfele}}!",
    "",
    "Csatoltan küldjük a(z) {{ajanlat_szama}} számú árajánlatunk {{ajanlat_verzioja}}. változatát ({{ajanlat_megnevezese}}).",
    "",
    "Az ajánlat {{ajanlat_ervenyes}} napjáig érvényes.",
    "",
    "Ha kérdése van, válaszoljon erre a levélre.",
    "",
    "Üdvözlettel:",
    "{{kuldo_neve}}",
    "Acropora",
  ].join("\n"),
} as const;
