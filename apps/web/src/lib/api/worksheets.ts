import type {
  CreateWorksheetDepartmentInput,
  CreateWorksheetInput,
  SetWorksheetAssigneesInput,
  SignWorksheetVersionInput,
  UpdateWorksheetDraftInput,
  WorksheetAssignableUserListResponse,
  WorksheetAttachableListResponse,
  WorksheetSelectablePartnerListResponse,
  WorksheetDepartmentListResponse,
  WorksheetDepartmentSummary,
  WorksheetDetail,
  WorksheetDocumentListResponse,
  WorksheetEntryListResponse,
  WorksheetListResponse,
  WorksheetSignerListResponse,
} from "@acropora/types";

import { apiAuthHeaders, apiRequest } from "./client";
import { API_PREFIX } from "./api-prefix";

const base = "/service/worksheets";

function worksheetPath(id: string, suffix = "") {
  return `${base}/${encodeURIComponent(id)}${suffix}`;
}

export const worksheetsApi = {
  list(token: string, query: URLSearchParams, signal?: AbortSignal) {
    return apiRequest<WorksheetListResponse>(`${base}?${query}`, token, {
      signal,
    });
  },
  detail(token: string, id: string, signal?: AbortSignal) {
    return apiRequest<WorksheetDetail>(worksheetPath(id), token, { signal });
  },
  /** A lapok, amik alatt meg nincs hibajegy. A hibajegy felulete keri. */
  attachable(token: string, customerId: string, signal?: AbortSignal) {
    return apiRequest<WorksheetAttachableListResponse>(
      `${base}/attachable?customerId=${encodeURIComponent(customerId)}`,
      token,
      { signal },
    );
  },
  selectablePartners(token: string, signal?: AbortSignal) {
    return apiRequest<WorksheetSelectablePartnerListResponse>(
      `${base}/selectable-partners`,
      token,
      { signal },
    );
  },
  assignableUsers(token: string, signal?: AbortSignal) {
    return apiRequest<WorksheetAssignableUserListResponse>(
      `${base}/assignable-users`,
      token,
      { signal },
    );
  },
  departments(token: string, customerId: string, signal?: AbortSignal) {
    return apiRequest<WorksheetDepartmentListResponse>(
      `${base}/customers/${encodeURIComponent(customerId)}/departments`,
      token,
      { signal },
    );
  },
  createDepartment(
    token: string,
    customerId: string,
    input: CreateWorksheetDepartmentInput,
  ) {
    return apiRequest<WorksheetDepartmentSummary>(
      `${base}/customers/${encodeURIComponent(customerId)}/departments`,
      token,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
    );
  },
  create(token: string, input: CreateWorksheetInput) {
    return apiRequest<WorksheetDetail>(base, token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  },
  updateDraft(token: string, id: string, input: UpdateWorksheetDraftInput) {
    return apiRequest<WorksheetDetail>(worksheetPath(id), token, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  },
  setAssignees(token: string, id: string, input: SetWorksheetAssigneesInput) {
    return apiRequest<WorksheetDetail>(worksheetPath(id, "/assignees"), token, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  },
  /**
   * A LAP ESZKOZEI, TELJES LISTAKENT.
   *
   * `PUT`, ugyanabbol az okbol, amiert a felelosoknel: a bekuldott lista a lap
   * eszkozeinek TELJES allapota, nem hozzaadas.
   *
   * HELYSZIN NINCS A TORZSBEN, ES EZ ELTER A HIBAJEGYTOL: a lap helyszine a
   * felvitelkor eldolt es nincs ut, ami megvaltoztatna -- a szerver a lap SAJAT
   * helyszinere ellenoriz.
   */
  setAssets(token: string, id: string, input: { assetIds: string[] }) {
    return apiRequest<WorksheetDetail>(worksheetPath(id, "/assets"), token, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  },
  /**
   * A LAP CSATOLMANYAI -- KULON HIVAS, NEM A RESZLETLAP RESZE.
   *
   * Ugyanaz az indok, ami a hibajegynel: a csatolmany nem a lap TARTALMA,
   * hanem allomany rajta. Kulon hivas mellett a lista frissitheto feltoltes
   * utan anelkul, hogy a teljes lapot (es vele a naplot) ujra le kellene kerni.
   */
  documents(token: string, id: string, signal?: AbortSignal) {
    return apiRequest<WorksheetDocumentListResponse>(
      worksheetPath(id, "/documents"),
      token,
      { signal },
    );
  },
  /**
   * LETOLTES. NYERS `fetch`, NEM `apiRequest`: a valasz BAJT, nem JSON.
   *
   * A CIM ITT KIIRVA ALL, NEM a `worksheetPath` helperrel osszerakva -- es ez
   * MERT megkotes, nem stilus. A repo hasonlosag-meroje
   * (`mobile-api-routes.spec.ts`) a kliens-fajlokbol olvassa ki a hivott
   * cimeket, es a helper-hivast egy sablonon BELUL nem tudja feloldani. A
   * hibajegy es az eszkoz oldali letoltes ugyanezt az alakot hasznalja, es a
   * sajat kommentjuk ugyanezt mondja ki.
   */
  async downloadDocument(token: string, id: string, documentId: string) {
    const response = await fetch(
      `${API_PREFIX}/service/worksheets/${encodeURIComponent(id)}/documents/${encodeURIComponent(documentId)}`,
      { credentials: "same-origin", headers: apiAuthHeaders(token) },
    );
    if (!response.ok) throw new Error("A csatolmány nem tölthető le.");
    return response.blob();
  },
  close(token: string, id: string) {
    return apiRequest<WorksheetDetail>(worksheetPath(id, "/close"), token, {
      method: "POST",
    });
  },
  continueFrom(token: string, id: string) {
    return apiRequest<WorksheetDetail>(`${worksheetPath(id)}/continue`, token, {
      method: "POST",
    });
  },
  /**
   * A MUNKALAP MUNKANAPLOJA.
   *
   * A `canEdit` es az `editRefusal` A SZERVERTOL JON, es a felulet NEM szamolja
   * ujra. A szabaly (a lap keszitoje vagy a hibajegy letrehozoja szerkeszthet)
   * jogosultsagi szabaly: a szerver a KEREST is elutasitja. Ket masolat
   * ugyanarra a szabalyra elcsuszhatna, es a felulete lenne a hangosabb --
   * vagyis a rosszabbik iranyba.
   */
  entries(token: string, id: string, signal?: AbortSignal) {
    return apiRequest<WorksheetEntryListResponse>(
      worksheetPath(id, "/entries"),
      token,
      { signal },
    );
  },
  addEntry(token: string, id: string, body: string) {
    return apiRequest<WorksheetEntryListResponse>(
      worksheetPath(id, "/entries"),
      token,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      },
    );
  },
  /**
   * A valasz a TELJES lista, nem az egy sor: a felulet igy egy korbol frissul,
   * es nem all elo az az allapot, amikor az atirt sor mar uj, a tobbi meg regi.
   */
  updateEntry(token: string, id: string, entryId: string, body: string) {
    return apiRequest<WorksheetEntryListResponse>(
      `${worksheetPath(id, "/entries")}/${encodeURIComponent(entryId)}`,
      token,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      },
    );
  },
  /** Aki alairhatja a lapot: a lap partnerenek nyilvantartott munkatarsai. */
  signers(token: string, id: string, signal?: AbortSignal) {
    return apiRequest<WorksheetSignerListResponse>(
      worksheetPath(id, "/signers"),
      token,
      { signal },
    );
  },
  sign(token: string, id: string, input: SignWorksheetVersionInput) {
    return apiRequest<WorksheetDetail>(worksheetPath(id, "/sign"), token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  },
};
