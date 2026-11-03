/**
 * A SZÁMLÁK TELEFONOS TÍPUSAI (Balázs döntése, 2026-11-03 17:01 UTC, kártya 050e138b): csak olvasásra, a kimenő
 * (kiállított számla, díjbekérő, a külső bizonylatok) és a bejövő számlák listája és adatlapja.
 *
 * SAJÁT MÁSOLATOK, NEM A `@acropora/types` csomagból: az Expo app szándékosan nem húzza be a pnpm munkatér csomagjait
 * (`docs/MOBILE-DEVELOPMENT.md`). RÉSZHALMAZ: csak azok a mezők, amelyeket a képernyők olvasnak. Hogy minden itteni
 * mezőnév a szerver típusában is létezzen, azt a `apps/api/src/mobile/mobile-response-mirror.spec.ts` őrzi: egy
 * elírt mező itt `undefined` lenne a képernyőn, és semmi más nem szólna.
 */

export type BillingDocumentType =
  | "INVOICE"
  | "PROFORMA"
  | "ADVANCE_INVOICE"
  | "DELIVERY_NOTE"
  | "FINAL_INVOICE";

export type BillingDocumentStatus =
  "DRAFT" | "ISSUING" | "ISSUED" | "ISSUE_FAILED";

/** A sor megnyitásának célja; a vázlat (`EDITOR`) telefonon nem nyitható, mert az szerkesztés. */
export type BillingDocumentListTarget = "EDITOR" | "DETAIL" | "EXTERNAL_DETAIL";

export type BillingPaymentState = "PAID" | "PARTIAL" | "UNPAID" | "UNKNOWN";

/** `GET /billing/documents` sora (a közösben `BillingDocumentListItem`). */
export interface OutgoingDocumentListItem {
  id: string;
  documentType: BillingDocumentType;
  documentNumber: string | null;
  customerName: string;
  issueDate: string | null;
  dueDate: string | null;
  grossAmount: string;
  currency: string;
  status: BillingDocumentStatus;
  opens: BillingDocumentListTarget;
  externalKindLabel: string | null;
  paymentState: BillingPaymentState | null;
  cancelled?: boolean;
}

export interface Pagination {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export interface OutgoingDocumentListResponse {
  items: OutgoingDocumentListItem[];
  pagination: Pagination;
}

/** A tétel közös alakja a saját és a külső bizonylaton: a sor neve, mennyiség, egység, bruttó. */
export interface OwnDocumentLine {
  id: string;
  kind: "ITEM" | "DISCOUNT";
  description: string;
  quantity: string;
  unit: string | null;
  grossAmount: string;
}

export interface OwnDocumentCustomer {
  name: string;
  address: string | null;
  taxNumber: string | null;
}

/** `GET /billing/documents/:id` (a közösben `BillingDocumentDetail`). */
export interface OwnDocumentDetail {
  id: string;
  status: BillingDocumentStatus;
  documentNumber: string | null;
  documentType: BillingDocumentType;
  customer: OwnDocumentCustomer | null;
  fulfillmentDate: string | null;
  dueDate: string | null;
  paymentMethod: string | null;
  currency: string;
  lines: OwnDocumentLine[];
  totals: { netAmount: string; vatAmount: string; grossAmount: string };
  issueDate?: string | null;
  pdf?: { available: boolean };
}

export interface ExternalDocumentLine {
  name: string;
  quantity: string;
  unit: string;
  grossAmount: string;
}

/** `GET /billing/external-documents/:id` (a közösben `BillingExternalDocumentDetail`). */
export interface ExternalDocumentDetail {
  id: string;
  pdfAvailable: boolean;
  kindLabel: string;
  documentNumber: string;
  issueDate: string;
  fulfillmentDate: string | null;
  dueDate: string | null;
  paymentMethod: string | null;
  currency: string;
  customer: { name: string; taxNumber: string | null; address: string | null };
  lines: ExternalDocumentLine[];
  totals: { netAmount: string; vatAmount: string; grossAmount: string };
  cancelled: boolean;
  paymentState: BillingPaymentState | null;
}

/** `GET /billing/incoming-documents` sora (a közösben `IncomingDocumentListItem`). */
export interface IncomingDocumentListItem {
  id: string;
  origin: "SZAMLAZZ" | "MAILBOX" | "PURCHASE";
  documentNumber: string;
  kindLabel: string;
  cancelled: boolean;
  supplierName: string;
  issueDate: string;
  dueDate: string | null;
  currency: string;
  grossAmount: string | null;
  paymentState: BillingPaymentState;
  /** A még ellenőrizendő postafiókos sornak nincs adatlapja (a weben is az ellenőrző lap nyílik). */
  review: "TO_REVIEW" | "VERIFIED" | null;
  hasPdf: boolean;
}

export interface IncomingDocumentListResponse {
  items: IncomingDocumentListItem[];
  pagination: Pagination;
}

export interface IncomingDocumentLine {
  name: string;
  quantity: string;
  unit: string;
  grossAmount: string;
}

/** `GET /billing/incoming-documents/:id` (a közösben `IncomingDocumentDetail`). */
export interface IncomingDocumentDetail {
  id: string;
  documentNumber: string;
  kindLabel: string;
  cancelled: boolean;
  issueDate: string;
  fulfillmentDate: string | null;
  dueDate: string | null;
  paymentMethod: string | null;
  currency: string;
  netAmount: string;
  vatAmount: string;
  grossAmount: string;
  paymentState: BillingPaymentState;
  supplier: { name: string; address: string | null; taxNumber: string | null };
  lines: IncomingDocumentLine[];
  hasPdf: boolean;
}
