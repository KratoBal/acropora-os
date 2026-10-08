/**
 * A CÉG SAJÁT AZONOSSÁGA, EGY HELYEN (Hiányzó számlák, brief 4. pont: „Ne szórd
 * szét a 23916229 adószámot több fájlban hardcode-olva”). Egy számla csak akkor
 * számít megtaláltnak, ha erre a cégre szól.
 */
export const ACROPORA_COMPANY = {
  name: "Acropora Kft.",
  /** Az adószám törzsszáma (az első nyolc számjegy). */
  taxNumberBase: "23916229",
  /** A székhely, ahogy a kimenő dokumentumokon áll (Balázs, 2026-10-08). */
  address: "1106 Budapest, Pesti Gábor utca 35",
  phone: "+36-20-2676801",
  email: "info@acropora.hu",
  web: "www.acropora.hu",
} as const;

/**
 * THE SERVICE CONTACT (Balázs, 2026-10-08 08:11, acrobot 28093): the worksheet
 * and the service job PDFs keep the service number and the fault-report
 * address; every other document carries the office's (`ACROPORA_COMPANY`).
 */
export const ACROPORA_SERVICE_CONTACT = {
  phone: "+36-30-982-3634",
  faultReportEmail: "ticket@acropora.hu",
} as const;

/** Which contact a document's footer carries. */
export type DocumentFooterKind = "SERVICE" | "OFFICE";

/**
 * THE FOOTER OF A BRANDED PDF, by kind. SERVICE is the line the worksheet and
 * the service job have always had; OFFICE is the company's line, as on the
 * quote (without its document reference).
 */
export function documentFooterLine(kind: DocumentFooterKind): string {
  const c = ACROPORA_COMPANY;
  return kind === "SERVICE"
    ? `${c.name} · ${c.address} · ${c.email} · hibabejelentés: ${ACROPORA_SERVICE_CONTACT.faultReportEmail} · ${ACROPORA_SERVICE_CONTACT.phone}`
    : `${c.name} · ${c.address} · Tel: ${c.phone} · e-mail: ${c.email} · ${c.web}`;
}

/**
 * A KIMENŐ AJÁNLAT LÁBLÉCE, Balázs szavaival (2026-10-08 08:14): a cégadat,
 * utána a dokumentum azonosítója.
 */
export function acroporaFooterLine(documentRef: string): string {
  const c = ACROPORA_COMPANY;
  return `${c.name} ${c.address} Tel: ${c.phone} e-mail: ${c.email} ${c.web} · ${documentRef}`;
}
