/**
 * A MUNKALAP BELSO LINKJE -- UGYANAZ A MINTA, MINT `internalTicketLink`.
 *
 * A `WEB_URL` UJRAHASZNOSITASA, ugyanazon okbol: az API mar ismeri ezt a
 * kulcsot (lasd `ticket-link.ts` fejlecet), es hianyzo link nem allithatja
 * meg a kuldest -- a `renderMailTemplate` az ures stringet ervenyes
 * ertekkent kezeli.
 */
export function internalWorksheetLink(input: {
  readonly webUrl: string | undefined;
  readonly worksheetId: string;
}): string {
  const alap = input.webUrl?.trim();
  if (!alap) return "";
  return `${alap.replace(/\/+$/, "")}/szerviz/munkalapok/${input.worksheetId}`;
}
