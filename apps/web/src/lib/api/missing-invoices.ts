import type {
  BankStatementImportResult,
  InvoiceCollectionSuggestionsResponse,
  MissingInvoiceJevSuggestion,
} from "@acropora/types";
import type {
  MissingInvoiceItemDetail,
  MissingInvoiceMonthDetail,
  MissingInvoiceMonthsResponse,
} from "@/components/finance/missing-invoices/missing-invoices-wire";
import type {
  ChargeCategory,
  ChargeTab,
} from "@/components/finance/missing-invoices/missing-invoices-model";

import { API_PREFIX } from "./api-prefix";
import { ApiError, apiAuthHeaders, apiRequest } from "./client";

/** Egy letöltött export: a fájl és a szerver adta név. */
export interface MissingInvoicesExport {
  blob: Blob;
  fileName: string;
}

/**
 * Az export válasza fájl, nem JSON. Hibánál a szerver mondata megy tovább (a
 * hónap alakja, jog), és ha a törzs nem JSON (proxy-hiba), az általános mondat.
 * A fájl neve a Content-Disposition fejlécből jön, ha nincs, a tartalék.
 */
async function readExport(
  response: Response,
  fallbackName: string,
  fallbackMessage: string,
): Promise<MissingInvoicesExport> {
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
    throw new ApiError(message ?? fallbackMessage, response.status);
  }
  // \x22 = idézőjel: a nyers `"` egy regex-literálban az útvonal-őr maszkolóját
  // string-módba viszi, és a fájl többi hívása eltűnik előle.
  const named = /filename=\x22([^\x22]+)\x22/.exec(
    response.headers.get("Content-Disposition") ?? "",
  );
  return { blob: await response.blob(), fileName: named?.[1] ?? fallbackName };
}

/**
 * A HIÁNYZÓ SZÁMLÁK VÉGPONTJAI (nautilus szerződése,
 * agents/nautilus/megosztas/hianyzo-szamlak-vegpontok.md). Olvasás
 * `finance.view`, minden módosítás `finance.manage`, és a frissített tételt
 * adja vissza (nautilus #1295, #1297, #1303, #1305). Az exportok fájlt adnak
 * (nautilus #1308), `finance.manage` joggal.
 */
const base = "/missing-invoices";

export interface MonthQuery {
  tab: ChargeTab;
  q: string;
  category: ChargeCategory | "";
  accountId: string;
  page: number;
  pageSize: number;
}

function monthQueryString(query: MonthQuery): string {
  const params = new URLSearchParams({
    tab: query.tab,
    page: String(query.page),
    pageSize: String(query.pageSize),
  });
  if (query.q) params.set("q", query.q);
  if (query.category) params.set("category", query.category);
  if (query.accountId) params.set("accountId", query.accountId);
  return params.toString();
}

export const missingInvoicesApi = {
  /**
   * A JEV JAVASLATAI A BEGYŰJTÉSBŐL (levél-válogatás, 4. szelet; acrobot 25803):
   * a döntésre váró bejövő-számla javaslatok. Elfogadva jelölt lesz, elvetve
   * törlődik.
   */
  suggestions(token: string, signal?: AbortSignal) {
    return apiRequest<InvoiceCollectionSuggestionsResponse>(
      `${base}/suggestions`,
      token,
      { signal },
    );
  },
  async suggestionFile(
    token: string,
    id: string,
  ): Promise<MissingInvoicesExport> {
    const response = await fetch(
      `${API_PREFIX}${base}/suggestions/${encodeURIComponent(id)}/file`,
      { credentials: "same-origin", headers: apiAuthHeaders(token) },
    );
    return readExport(response, "javaslat.pdf", "A PDF nem tölthető be.");
  },
  acceptSuggestion(token: string, id: string) {
    return apiRequest<void>(
      `${base}/suggestions/${encodeURIComponent(id)}/accept`,
      token,
      { method: "POST" },
    );
  },
  rejectSuggestion(token: string, id: string) {
    return apiRequest<void>(
      `${base}/suggestions/${encodeURIComponent(id)}/reject`,
      token,
      { method: "POST" },
    );
  },
  months(token: string, signal?: AbortSignal) {
    return apiRequest<MissingInvoiceMonthsResponse>(`${base}/months`, token, {
      signal,
    });
  },
  month(token: string, month: string, query: MonthQuery, signal?: AbortSignal) {
    return apiRequest<MissingInvoiceMonthDetail>(
      `${base}/months/${encodeURIComponent(month)}?${monthQueryString(query)}`,
      token,
      { signal },
    );
  },
  item(token: string, id: string, signal?: AbortSignal) {
    return apiRequest<MissingInvoiceItemDetail>(
      `${base}/items/${encodeURIComponent(id)}`,
      token,
      { signal },
    );
  },
  /**
   * A JEV PÁROSÍTÁSI JAVASLATA (nautilus #1324 végpontja; a #1324 óta nem volt
   * hívója). Árnyék-módban és kikapcsolva a `documentId` mindig `null`.
   */
  jevSuggestion(token: string, id: string, signal?: AbortSignal) {
    return apiRequest<MissingInvoiceJevSuggestion>(
      `${base}/items/${encodeURIComponent(id)}/jev-suggestion`,
      token,
      { signal },
    );
  },
  /**
   * KÉZI PÁROSÍTÁS. A törzs csak a dokumentum (nautilus #1303); ha a számlát
   * már egy másik terheléshez párosították kézzel, a szerver 409-et ad egy
   * kiírható mondattal.
   */
  match(token: string, id: string, documentId: string) {
    return apiRequest<MissingInvoiceItemDetail>(
      `${base}/items/${encodeURIComponent(id)}/match`,
      token,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId }),
      },
    );
  },
  unmatch(token: string, id: string) {
    return apiRequest<MissingInvoiceItemDetail>(
      `${base}/items/${encodeURIComponent(id)}/match`,
      token,
      { method: "DELETE" },
    );
  },
  comment(token: string, id: string, comment: string | null) {
    return apiRequest<MissingInvoiceItemDetail>(
      `${base}/items/${encodeURIComponent(id)}/comment`,
      token,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment }),
      },
    );
  },
  category(token: string, id: string, category: ChargeCategory | null) {
    return apiRequest<MissingInvoiceItemDetail>(
      `${base}/items/${encodeURIComponent(id)}/category`,
      token,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category }),
      },
    );
  },
  paperOriginal(token: string, id: string, marked: boolean) {
    return apiRequest<MissingInvoiceItemDetail>(
      `${base}/items/${encodeURIComponent(id)}/paper-original`,
      token,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ marked }),
      },
    );
  },
  /**
   * A VEVŐ KÉZI JELÖLÉSE (acrobot 25633): a beszkennelt számla vevője nem
   * olvasható, a kezelő mondja meg. Csak a nem ellenőrizhető vagy már kézzel
   * jelölt vevőjű párosított számlán; máshol a szerver 409-cel elutasítja.
   */
  markPayee(
    token: string,
    id: string,
    documentId: string,
    payee: "COMPANY" | "NOT_COMPANY",
  ) {
    return apiRequest<MissingInvoiceItemDetail>(
      `${base}/items/${encodeURIComponent(id)}/documents/${encodeURIComponent(documentId)}/payee`,
      token,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payee }),
      },
    );
  },
  /**
   * SZÁMLA FELTÖLTÉSE A DRAWERBŐL (nautilus #1305): a PDF a postafiókkal közös
   * helyre kerül, a bevételezési láncba nem, és ugyanabban a lépésben párosul
   * a terheléshez. Ami nem PDF, azt a szerver elutasítja.
   */
  uploadDocument(
    token: string,
    id: string,
    file: File,
    kind: "INVOICE" | "PREMIUM_NOTICE",
  ) {
    const form = new FormData();
    form.append("file", file);
    form.append("kind", kind);
    return apiRequest<MissingInvoiceItemDetail>(
      `${base}/items/${encodeURIComponent(id)}/documents`,
      token,
      { method: "POST", body: form },
    );
  },
  /** A hiánylista (xlsx) a hónap Hiányzik fülének tételeivel (nautilus #1308). */
  async missingXlsx(
    token: string,
    month: string,
  ): Promise<MissingInvoicesExport> {
    const response = await fetch(
      `${API_PREFIX}${base}/months/${encodeURIComponent(month)}/missing.xlsx`,
      { credentials: "same-origin", headers: apiAuthHeaders(token) },
    );
    return readExport(
      response,
      `hianyzo-szamlak-${month}.xlsx`,
      "A hiánylista nem tölthető le.",
    );
  },
  /**
   * A könyvelői csomag (PDF): a hónap Megvan-számláinak eredetijei egyben
   * (nautilus #1308).
   */
  async accountantPackage(
    token: string,
    month: string,
  ): Promise<MissingInvoicesExport> {
    const response = await fetch(
      `${API_PREFIX}${base}/months/${encodeURIComponent(month)}/accountant-package.pdf`,
      { credentials: "same-origin", headers: apiAuthHeaders(token) },
    );
    return readExport(
      response,
      `konyveloi-csomag-${month}.pdf`,
      "A könyvelői csomag nem tölthető le.",
    );
  },
  uploadStatement(token: string, file: File) {
    const form = new FormData();
    form.append("file", file);
    return apiRequest<BankStatementImportResult>(
      `${base}/bank-statements`,
      token,
      {
        method: "POST",
        body: form,
      },
    );
  },
};
