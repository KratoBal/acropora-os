/**
 * A LEVÉLSABLON SZAVA A JEGY FAJTÁJA SZERINT (Balázs, 2026-11-18; acrobot 55810): a szerződésből keletkező karbantartási lap nem hibajegy, a
 * levelében sem lehet az. A levélsablonokat a vezető szerkeszti (a `ticket-mail.service.ts` alapértelmezéseivel együtt egy szöveg), ezért MAINTENANCE
 * jegynél a sablon SZÖVEGÉBEN (tárgy, törzs, HTML-törzs) cseréljük a "hibajegy" szót és ragozott alakjait "karbantartási lap" megfelelőjükre, a
 * behelyettesítés ELŐTT: a behelyettesített értékek (a jegy címe, a link) így érintetlenek. A nagy kezdőbetű megmarad ("Hibajegy:" -> "Karbantartási
 * lap:"); egy másik szó része ("hibajegykezelő") nem változik; a hibajegy (REPAIR) szövege soha.
 */
const FORMS: Readonly<Record<string, string>> = {
  "": "karbantartási lap",
  hez: "karbantartási laphoz",
  et: "karbantartási lapot",
  ről: "karbantartási lapról",
  en: "karbantartási lapon",
  ben: "karbantartási lapban",
  nek: "karbantartási lapnak",
  re: "karbantartási lapra",
  ig: "karbantartási lapig",
  ként: "karbantartási lapként",
  e: "karbantartási lapja",
  ét: "karbantartási lapját",
  ek: "karbantartási lapok",
  eket: "karbantartási lapokat",
  ekre: "karbantartási lapokra",
  ekről: "karbantartási lapokról",
  ekhez: "karbantartási lapokhoz",
  // "hibajeggyel": a -val/-vel hasonul (g + vel -> ggyel), ezért külön alak, nem rag
  gyel: "karbantartási lappal",
};

export function ticketTemplateWording(
  text: string,
  kind: "REPAIR" | "MAINTENANCE" | undefined,
): string {
  if (kind !== "MAINTENANCE") return text;
  return text.replace(
    /(?<![\p{L}/._-])([Hh])ibajeg(?:y(ekről|ekhez|eket|ekre|hez|ként|et|ről|en|ben|nek|re|ig|ét|ek|e)?|(gyel))(?![\p{L}/_-])/gu,
    (
      _match,
      first: string,
      suffix: string | undefined,
      assimilated: string | undefined,
    ) => {
      const form = FORMS[assimilated ?? suffix ?? ""]!;
      return first === "H" ? form[0]!.toUpperCase() + form.slice(1) : form;
    },
  );
}

/** A teljes sablon (tárgy, szöveg, HTML-törzs) a jegy fajtája szerinti szóval; a többi mező érintetlen. */
export function ticketTemplateForKind<
  T extends { subject: string; body: string; bodyHtml?: string | null },
>(template: T, kind: "REPAIR" | "MAINTENANCE" | undefined): T {
  if (kind !== "MAINTENANCE") return template;
  return {
    ...template,
    subject: ticketTemplateWording(template.subject, kind),
    body: ticketTemplateWording(template.body, kind),
    ...(template.bodyHtml
      ? { bodyHtml: ticketTemplateWording(template.bodyHtml, kind) }
      : {}),
  };
}
