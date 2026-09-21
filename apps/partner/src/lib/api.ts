import type {
  AssetDetail,
  AssetDocumentSummary,
  AssetListResponse,
  AuthenticatedUser,
  ServiceJobDetail,
  ServiceJobDocumentSummary,
  ServiceJobListResponse,
  WorksheetDetail,
  WorksheetDepartmentListResponse,
  WorksheetDocumentListResponse,
  WorksheetListResponse,
  WorksheetSignerListResponse,
} from "@acropora/types";

const apiPrefix = "/api";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function csrfHeader(method: string): Record<string, string> {
  if (["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase())) return {};
  const value = document.cookie
    .split(";")
    .map((part) => part.trim().split("="))
    .find(([name]) => name === "acropora_csrf")
    ?.slice(1)
    .join("=");
  return value ? { "X-CSRF-Token": decodeURIComponent(value) } : {};
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const method = init?.method ?? "GET";
  let response: Response;
  try {
    response = await fetch(`${apiPrefix}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        ...(typeof init?.body === "string"
          ? { "Content-Type": "application/json" }
          : {}),
        ...csrfHeader(method),
        ...init?.headers,
      },
    });
  } catch {
    throw new ApiError(
      "A szerver nem érhető el. Kérjük, próbálja meg később.",
      0,
    );
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      message?: string | string[];
    } | null;
    const message = Array.isArray(body?.message)
      ? body.message.join(" ")
      : body?.message;
    throw new ApiError(
      message ??
        (response.status === 403
          ? "Nincs hozzáférése ehhez az adathoz."
          : "A kérés feldolgozása nem sikerült."),
      response.status,
    );
  }
  return response.json() as Promise<T>;
}

export async function requestBlob(path: string): Promise<Blob> {
  const response = await fetch(`${apiPrefix}${path}`, {
    headers: { Accept: "application/octet-stream" },
  });
  if (!response.ok)
    throw new ApiError("A fájl nem tölthető le.", response.status);
  return response.blob();
}

function documentForm(file: File, caption: string) {
  const form = new FormData();
  form.append("file", file);
  if (caption.trim()) form.append("caption", caption.trim());
  return form;
}

export const partnerApi = {
  me: () => request<AuthenticatedUser>("/auth/me"),
  login: (email: string, password: string) =>
    request<{ user: AuthenticatedUser }>("/auth/login/password", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  logout: () => request<{ ok: true }>("/auth/logout", { method: "POST" }),
  tickets: (scope: "all" | "open" | "closed") =>
    request<ServiceJobListResponse>(
      `/service/jobs?${new URLSearchParams({ scope })}`,
    ),
  ticket: (id: string) =>
    request<ServiceJobDetail>(`/service/jobs/${encodeURIComponent(id)}`),
  createTicket: (input: {
    title: string;
    description?: string;
    departmentId?: string;
    assetIds?: string[];
  }) =>
    request<{ id: string; jobNumber: string }>("/service/jobs", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  ticketDocuments: (id: string) =>
    request<{ items: ServiceJobDocumentSummary[] }>(
      `/service/jobs/${encodeURIComponent(id)}/documents`,
    ),
  ticketDocumentBlob: (jobId: string, documentId: string) =>
    requestBlob(
      `/service/jobs/${encodeURIComponent(jobId)}/documents/${encodeURIComponent(documentId)}`,
    ),
  ticketPackageBlob: (id: string) =>
    requestBlob(`/service/jobs/${encodeURIComponent(id)}/download`),
  uploadTicketDocument: (id: string, file: File, caption: string) =>
    request(`/service/jobs/${encodeURIComponent(id)}/documents`, {
      method: "POST",
      body: documentForm(file, caption),
    }),
  departments: (customerId: string) =>
    request<WorksheetDepartmentListResponse>(
      `/service/worksheets/customers/${encodeURIComponent(customerId)}/departments`,
    ),
  /**
   * A LATHATOSAGOT A SZERVER DONTI EL, NEM EZ A HIVAS.
   *
   * 2026-09-18-ig itt `ownerType=CUSTOMER` + `ownerId` allt, es EZ URITETTE KI a
   * lapot: a partner helyszinen allo eszkoz SZALLITO-tulajdonu (merve stage-en:
   * 2 sorbol 2), tehat a vevo-tulajdonura szukitett kerdes szuksegszeruen nulla
   * sort adott.
   *
   * A `customerId` parameter AZERT KERULT KI, es nem csak a ket query-mezo: egy
   * bennhagyott azonosito azt sugallna, hogy a hivo szabalyozza a lathatosagot.
   * Ma a `PartnerScope` szabalyozza, a szerveren.
   */
  assets: (input?: { departmentId?: string; search?: string }) => {
    const query = new URLSearchParams({ status: "ALL", pageSize: "100" });
    /*
      A KET SZURO A SZERVERNEK MEGY, NEM A BETOLTOTT LISTA FOLE. A lista
      lapozott (ma 100-as lap, elesen 79 eszkoz): egy bongeszo-oldali szures a
      lapozas elso napjan CSENDBEN hianyos lenne -- a megjelenitett oldalbol
      valogatna, es a tobbirol nem tudna.

      ES AZ URES ERTEK NEM MEGY KI. Egy `departmentId=` alaku, ures parameter
      nem ugyanaz, mint a parameter hianya: a szerver egy ures azonositot
      kapna, es a reszfa-kibontas azt egy nem letezo egysegre futtatna.
    */
    if (input?.departmentId) query.set("departmentId", input.departmentId);
    if (input?.search?.trim()) query.set("search", input.search.trim());
    return request<AssetListResponse>(`/service/assets?${query}`);
  },
  /**
   * EGY ESZKOZ ADATLAPJA. A hatokort a SZERVER szabja (`partnerScopeOf`),
   * tehat idegen eszkozre 404 jon -- a portal nem szur mellé sajat feltetelt.
   * Egy kliens-oldali szures azt sugallna, hogy a lathatosagot a hivo dönti el.
   */
  asset: (id: string) =>
    request<AssetDetail>(`/service/assets/${encodeURIComponent(id)}`),
  assetDocuments: (id: string) =>
    request<{ items: AssetDocumentSummary[] }>(
      `/service/assets/${encodeURIComponent(id)}/documents`,
    ),
  assetDocumentBlob: (assetId: string, documentId: string) =>
    requestBlob(
      `/service/assets/${encodeURIComponent(assetId)}/documents/${encodeURIComponent(documentId)}`,
    ),
  uploadAssetDocument: (id: string, file: File, caption: string) =>
    request(`/service/assets/${encodeURIComponent(id)}/documents`, {
      method: "POST",
      body: documentForm(file, caption),
    }),
  worksheets: () =>
    request<WorksheetListResponse>("/service/worksheets?page=1&pageSize=100"),
  worksheet: (id: string) =>
    request<WorksheetDetail>(`/service/worksheets/${encodeURIComponent(id)}`),
  worksheetDocuments: (id: string) =>
    request<WorksheetDocumentListResponse>(
      `/service/worksheets/${encodeURIComponent(id)}/documents`,
    ),
  worksheetDocumentBlob: (worksheetId: string, documentId: string) =>
    requestBlob(
      `/service/worksheets/${encodeURIComponent(worksheetId)}/documents/${encodeURIComponent(documentId)}`,
    ),
  uploadWorksheetDocument: (id: string, file: File, caption: string) =>
    request(`/service/worksheets/${encodeURIComponent(id)}/documents`, {
      method: "POST",
      body: documentForm(file, caption),
    }),
  worksheetSigners: (id: string) =>
    request<WorksheetSignerListResponse>(
      `/service/worksheets/${encodeURIComponent(id)}/signers`,
    ),
  signWorksheet: (id: string, signerUserId: string, signatureCode: string) =>
    request<WorksheetDetail>(
      `/service/worksheets/${encodeURIComponent(id)}/sign`,
      {
        method: "POST",
        body: JSON.stringify({
          decision: "ACCEPTED",
          signerUserId,
          signatureCode,
        }),
      },
    ),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ updated: true }>("/account/password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword }),
    }),
  changeSigningCode: (currentPassword: string, signingCode: string) =>
    request<{ updated: true }>("/account/signing-code", {
      method: "POST",
      body: JSON.stringify({ currentPassword, signingCode }),
    }),
};
