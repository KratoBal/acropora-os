import type {
  BillingDocumentDetail,
  BillingDocumentDraftInput,
  BillingDocumentEmailInput,
  BillingDocumentListResponse,
  BillingExternalDocumentDetail,
  IncomingDocumentDetail,
  IncomingDocumentListResponse,
  MailTemplateVariable,
  ReceiptsResponse,
} from "@acropora/types";

import { API_PREFIX } from "./api-prefix";
import { ApiError, apiAuthHeaders, apiRequest } from "./client";

/** `GET /billing/documents/:id/email-draft` válasza (nautilus #1293). */
export interface BillingEmailTemplateDraft {
  /** `stored`: a Levelezés oldalon átírt szöveg; `default`: az alapszöveg. */
  source: "stored" | "default";
  subject: string;
  body: string;
  /**
   * A formázott törzs, ha a Levelezés oldalon formázottként mentették
   * (nautilus #1301); `null`: a sablon szöveges, a fiók alakítja formázottá.
   */
  bodyHtml: string | null;
  variables: readonly MailTemplateVariable[];
}

/**
 * EGY PDF-VÁLASZ BLOBKÉNT. A hiba szövege a szerveré, ha ad (nautilus #1283:
 * vázlat, vagy nincs PDF), mert az kiírható; különben a tartalék.
 *
 * Az útvonal SZÁNDÉKOSAN a hívó `fetch`-jében áll, literálként: az útvonal-őr
 * (`mobile-api-routes.spec`) csak a hívás helyén álló szöveget látja.
 */
async function pdfBlob(response: Response, fallback: string): Promise<Blob> {
  if (!response.ok) {
    let message: string | undefined;
    try {
      const payload = (await response.json()) as {
        message?: string | string[];
      };
      message = Array.isArray(payload.message)
        ? payload.message.join("\n")
        : payload.message;
    } catch {
      message = undefined;
    }
    throw new ApiError(message ?? fallback, response.status);
  }
  return response.blob();
}

export const billingDocumentsApi = {
  list(token: string, query: URLSearchParams, signal?: AbortSignal) {
    return apiRequest<BillingDocumentListResponse>(
      `/billing/documents?${query}`,
      token,
      { signal },
    );
  },
  /**
   * A HIVATALOS PDF, ahogy a Számlázz.hu visszaadta és eltároltuk. A szerver
   * soha nem gyárt "hasonló" PDF-et; vázlatnál és PDF nélkül 409-et ad.
   */
  async pdf(token: string, id: string): Promise<Blob> {
    const response = await fetch(
      `${API_PREFIX}/billing/documents/${encodeURIComponent(id)}/pdf`,
      { credentials: "same-origin", headers: apiAuthHeaders(token) },
    );
    return pdfBlob(response, "A bizonylat PDF-je nem tölthető le.");
  },
  /** A Számlázz.hu-ból kapott bejövő számlák (a Számlázás „Bejövő” nézete). */
  incomingList(token: string, query: URLSearchParams, signal?: AbortSignal) {
    return apiRequest<IncomingDocumentListResponse>(
      `/billing/incoming-documents?${query}`,
      token,
      { signal },
    );
  },
  incomingDetail(token: string, id: string, signal?: AbortSignal) {
    return apiRequest<IncomingDocumentDetail>(
      `/billing/incoming-documents/${encodeURIComponent(id)}`,
      token,
      { signal },
    );
  },
  /** CSAK ott, ahol a Számlázz.hu valódi PDF-et küldött (`hasPdf`); máshol 404. */
  async incomingPdf(token: string, id: string): Promise<Blob> {
    const response = await fetch(
      `${API_PREFIX}/billing/incoming-documents/${encodeURIComponent(id)}/pdf`,
      { credentials: "same-origin", headers: apiAuthHeaders(token) },
    );
    return pdfBlob(response, "A számla PDF-je nem tölthető le.");
  },
  /** A nyugták: a C szeletig csak a beérkezett darabszám. */
  receipts(token: string, signal?: AbortSignal) {
    return apiRequest<ReceiptsResponse>(`/billing/receipts`, token, {
      signal,
    });
  },
  /**
   * A KIKÜLDŐ FIÓK KIINDULÓ SZÖVEGE (nautilus #1293): a Levelezés oldal
   * `BILLING_DOCUMENT_MANUAL` sablonja, ahogy átírták, vagy az alapszövege;
   * nyers, `{{név}}` alakú változókkal. `billing.resend` jog kell hozzá.
   */
  /**
   * UGYANAZ A SABLON, BIZONYLAT NÉLKÜL (nautilus #1300): egy még nem mentett
   * új számla fiókja is a Levelezés oldalon beállított szövegből induljon
   * (Balázs a stage-en, acrobot 25337). `billing.resend` jog kell hozzá.
   */
  templateDraft(token: string, signal?: AbortSignal) {
    return apiRequest<BillingEmailTemplateDraft>(
      `/billing/email-draft`,
      token,
      {
        signal,
      },
    );
  },
  emailDraft(token: string, id: string, signal?: AbortSignal) {
    return apiRequest<BillingEmailTemplateDraft>(
      `/billing/documents/${encodeURIComponent(id)}/email-draft`,
      token,
      { signal },
    );
  },
  /**
   * Kiküldés, hiba utáni újrapróbálás vagy újraküldés (nautilus #1288). SOHA
   * nem állít ki új bizonylatot; ugyanazzal a `requestId`-val egy kézbesítés.
   */
  email(token: string, id: string, input: BillingDocumentEmailInput) {
    return apiRequest<BillingDocumentDetail>(
      `/billing/documents/${encodeURIComponent(id)}/email`,
      token,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
    );
  },
  /**
   * A külső bizonylat eltárolt PDF-je (az OTP eBIZ-ből jöttnél a szinkron
   * tölti le); ahol nincs, 404.
   */
  async externalPdf(token: string, id: string): Promise<Blob> {
    const response = await fetch(
      `${API_PREFIX}/billing/external-documents/${encodeURIComponent(id)}/pdf`,
      { credentials: "same-origin", headers: apiAuthHeaders(token) },
    );
    return pdfBlob(response, "A számla PDF-je nem tölthető le.");
  },
  /** A Számlázz.hu-ból kapott külső bizonylat, csak olvasásra (acrobot 25812). */
  externalDetail(token: string, id: string, signal?: AbortSignal) {
    return apiRequest<BillingExternalDocumentDetail>(
      `/billing/external-documents/${encodeURIComponent(id)}`,
      token,
      { signal },
    );
  },
  detail(token: string, id: string, signal?: AbortSignal) {
    return apiRequest<BillingDocumentDetail>(
      `/billing/documents/${encodeURIComponent(id)}`,
      token,
      { signal },
    );
  },
  create(token: string, input: BillingDocumentDraftInput) {
    return apiRequest<BillingDocumentDetail>("/billing/documents", token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  },
  /**
   * A VALÓDI KIÁLLÍTÁS (#1279, nautilus). Valódi Számlázz.hu-bizonylatot hoz
   * létre; a szerver kapcsolója (`BILLING_ISSUE_ENABLED`) nélkül elutasítja,
   * hívás előtt. Az ütközés-őr ugyanaz, mint a mentésnél.
   */
  issue(token: string, id: string, expectedUpdatedAt: string) {
    return apiRequest<BillingDocumentDetail>(
      `/billing/documents/${encodeURIComponent(id)}/issue`,
      token,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedUpdatedAt }),
      },
    );
  },
  update(token: string, id: string, input: BillingDocumentDraftInput) {
    return apiRequest<BillingDocumentDetail>(
      `/billing/documents/${encodeURIComponent(id)}`,
      token,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
    );
  },
};
