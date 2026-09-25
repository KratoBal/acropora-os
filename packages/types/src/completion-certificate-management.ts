/**
 * A TELJESÍTÉSI IGAZOLÁS A PARTNER PORTÁLON -- KÜLÖN, SZŰKEBB ALAK, NEM A
 * BELSŐ `CompletionCertificate` MÁSOLATA.
 *
 * Ugyanaz az indok, mint `maintenance-order-management.ts` fejlécében: a
 * belső válasz árat hordoz, a portál felé az SOHA nem mehet ki.
 *
 * AZ IGAZOLÁSNAK NINCS ÁLLAPOTA (lásd a séma `CompletionCertificate`
 * fejlécét) -- csak a kiállítás ténye és az aláírt példány megléte/hiánya
 * számít, ugyanúgy, ahogy a Figma terv is mutatja: "Aláírt példány" oszlop
 * jelvény helyett sima szöveggel.
 */

export type CompletionCertificateDocumentContentType = "application/pdf";

export interface CompletionCertificateDocumentSummary {
  id: string;
  type: "GENERATED_FORM" | "SIGNED_FORM";
  fileName: string;
  contentType: CompletionCertificateDocumentContentType;
  sizeBytes: number;
  createdAt: string;
}

/** Egy sor, ár nélkül. */
export interface CompletionCertificatePartnerItem {
  id: string;
  description: string;
  /** DECIMAL, STRING ALAKBAN -- ugyanaz a minta, mint a megrendelőlap tételénél. */
  quantity: string;
}

export interface CompletionCertificatePartnerSummary {
  id: string;
  number: string;
  issuedAt: string;
  issuedByName: string | null;
  /**
   * A HELYSZÍN -- a `ServiceJob.departmentId` közvetlen mezője, ugyanaz a
   * tengely, amit a hibajegy és a munkalap portál-láthatósága is használ.
   * Itt (a `MaintenanceOrder`-rel ellentétben) MINDIG van érték, mert a
   * `ServiceJob.departmentId` a sémán kötelező.
   */
  departmentName: string;
  hasSignedDocument: boolean;
}

export interface CompletionCertificatePartnerListResponse {
  items: CompletionCertificatePartnerSummary[];
}

export interface CompletionCertificatePartnerDetail extends CompletionCertificatePartnerSummary {
  items: CompletionCertificatePartnerItem[];
  documents: CompletionCertificateDocumentSummary[];
  /** Ugyanaz a minta, mint a `MaintenanceOrderPartnerDetail.canUploadSigned`-nél. */
  canUploadSigned: boolean;
}
