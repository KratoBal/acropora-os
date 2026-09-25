import type {
  AquariumDetail,
  AquariumListResponse,
  AquariumMeasurementListResponse,
  AquariumMeasurementOccasion,
  AssetDetail,
  AssetDocumentSummary,
  AssetListResponse,
  AssetQrCode,
  AuthenticatedUser,
  CreateAquariumInput,
  CurrentUserResponse,
  ServiceJobPartnerDetail,
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
  me: () => request<CurrentUserResponse>("/auth/me"),
  login: (email: string, password: string) =>
    request<{ user: AuthenticatedUser }>("/auth/login/password", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  logout: () => request<{ ok: true }>("/auth/logout", { method: "POST" }),
  tickets: (scope: "all" | "open" | "closed") =>
    request<ServiceJobListResponse>(
      `/service/jobs?${new URLSearchParams({ scope, kind: "ALL" })}`,
    ),
  ticket: (id: string) =>
    /*
      A PARTNER SAJAT ALAKOT KAP, NEM A BELSOT. A tipus a kozos csomagbol jon,
      es UGYANAZ, amit a szerver eloallit (`partnerServiceJobDetail`) -- tehat
      a ket oldal nem tud elcsuszni egymastol.
    */
    request<ServiceJobPartnerDetail>(`/service/jobs/${encodeURIComponent(id)}`),
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
  /**
   * A BEJELENTES JAVITASA (cim, leiras).
   *
   * UGYANAZ A VEGPONT, MINT A BELSOS FELULETEN -- a partner portal mar ma is
   * ugyanoda kuld (`POST /service/jobs` a felvitelnel). A ket hatokor nem
   * kulon UTVONALON valik szet, hanem a szolgaltatason BELUL: a partnere addig
   * tart, amig a jegyen NINCS munkalap.
   *
   * A HATART A SZERVER MONDJA KI. Ha mar van lap, 409 jon, sajat mondattal.
   */
  updateTicket: (
    id: string,
    input: { title?: string; description?: string | null },
  ) =>
    request<{ id: string }>(`/service/jobs/${encodeURIComponent(id)}`, {
      method: "PATCH",
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
   * ÚJ AKVÁRIUM FELVITELE A PORTÁLRÓL.
   *
   * A HÍVÓ NEM KÜLD `ownershipType`-OT, `customerId`-t VAGY `newCustomer`-t --
   * ez a hívás mindig a hívó SAJÁT ügyfelére hoz létre akváriumot
   * (`aquariums.service.ts` `resolvePartnerOwnership`, szerver oldalon
   * kényszerítve `ownershipType: "CUSTOMER"`-re és a hívó `customerId`-jére;
   * egy innen küldött eltérő érték elutasítást kapna, nem csendes
   * felülírást). A `departmentId` a hívó SAJÁT, kiosztott helyszínei közül
   * KÖTELEZŐ -- ezt a szerver `assignedUnitIdsFor`-ral ellenőrzi.
   */
  createAquarium: (
    input: Pick<
      CreateAquariumInput,
      | "departmentId"
      | "name"
      | "waterType"
      | "systemVolumeLiters"
      | "systemVolumeIsManual"
    >,
  ) =>
    request<AquariumDetail>("/aquariums", {
      method: "POST",
      body: JSON.stringify({ ownershipType: "CUSTOMER", ...input }),
    }),
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
   *
   * === ES AKKOR CSAK EZ A FELE LETT KIJAVITVA (2026-09-21) ===
   *
   * A szerver KET kulonbozo szaballyal dontott arrol, mit lat a partner: a
   * LISTA a reszlegen at is beengedett, az ADATLAP csak a sor sajat gazdajat
   * nezte. A 2026-09-18-i javitas a listat hozta helyre, es az adatlapot
   * mellette hagyta -- ugyanaz a hiba, egy kattintassal odebb.
   *
   * Merve 2026-09-21 az eles adaton: 79 eszkozbol 79 szallitoi tulajdonu, sajat
   * `customerId`-je EGYIKNEK SINCS. A lista mind a 79-et megmutatta, az adatlap
   * mind a 79-re nemet mondott.
   */
  /**
   * A LAPOZAS, A STATUSZ-SZURO ES A RENDEZES 2026-09-24-TOL VALODI PARAMETER,
   * NEM BEEGETETT ERTEK. A vegpont ugyanaz, mint a belso feluleten
   * (`apps/web/src/lib/api/assets.ts`), es a hatokort a szerver adja a
   * hivo szerepe szerint -- ez a hivas csak azt a negy mezot kuldi tovabb,
   * amit a belso lista is kuld.
   *
   * A KORABBI ALAPERTELMEZES (`status=ALL&pageSize=100`) MEGMARAD ALAPKENT,
   * ha a hivo nem ad meg ertéket -- igy a MASIK hivohely (helyszin-valaszto
   * betoltese elott mar nem volt ilyen) nem valtozik.
   */
  assets: (input?: {
    departmentId?: string;
    /**
     * MELYIK AKVÁRIUMHOZ VAN CSATOLVA -- az `Asset.aquariumId` szerinti
     * szűrés (`service-assets.repository.ts:566`). Az Akváriumok adatlap
     * "Eszközök a medencében" kártyája ezzel kéri le, mi van MÁR
     * hozzárendelve, és (2026-09-25-től) ugyanezt a hívást, `departmentId`-
     * val szűrve, a hozzárendelhető jelöltek listájához is -- lásd
     * `assignAssetAquarium` fejlécét.
     */
    aquariumId?: string;
    search?: string;
    status?: string;
    page?: number;
    pageSize?: number;
    sort?: string;
    direction?: string;
  }) => {
    const query = new URLSearchParams({
      status: input?.status ?? "ALL",
      pageSize: String(input?.pageSize ?? 100),
      page: String(input?.page ?? 1),
    });
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
    if (input?.aquariumId) query.set("aquariumId", input.aquariumId);
    if (input?.search?.trim()) query.set("search", input.search.trim());
    if (input?.sort) query.set("sort", input.sort);
    if (input?.direction) query.set("direction", input.direction);
    return request<AssetListResponse>(`/service/assets?${query}`);
  },
  /**
   * EGY ESZKOZ ADATLAPJA. A hatokort a SZERVER szabja (`partnerScopeOf`),
   * tehat idegen eszkozre 404 jon -- a portal nem szur mellé sajat feltetelt.
   * Egy kliens-oldali szures azt sugallna, hogy a lathatosagot a hivo dönti el.
   *
   * === AZ "IDEGEN" SZO 2026-09-21-IG MAST JELENTETT, MINT AMIT A SZERZOJE GONDOLT ===
   *
   * Ez a mondat vegig IGAZ volt, es kozben a hibat irta le helyesnek: a szerver
   * szukebb szabalyt futtatott az adatlapon, mint a listan, tehat "idegen" MIND
   * A 79 eszkozt jelentette. Balazs szo szerinti jelzese: "ha rakattint egyre
   * akkor mindenre azt mondja, hogy nincs ilyen eszkoz."
   *
   * Mostantol az adatlap UGYANAZT a lathatosagot hasznalja, mint a lista
   * (`assetVisibilityForAndBranch`), tehat az "idegen" azt jelenti, amit a
   * szerzoje ertett rajta: ami NEM a kero helyszinen all es nem is az ove.
   *
   * A CSATOLMANY-AGAK IS EGYUTT MOZDULTAK (belyegkep, letoltes): kulonben a lap
   * megnyilna, a fajljai megjelennenek, es a megnyitasuk 404-et adna.
   */
  asset: (id: string) =>
    request<AssetDetail>(`/service/assets/${encodeURIComponent(id)}`),
  /**
   * ESZKÖZ HOZZÁRENDELÉSE/LEVÉTELE EGY AKVÁRIUMRÓL.
   *
   * KÜLÖN VÉGPONT (`PATCH /service/assets/:id/aquarium`), NEM az `asset()`
   * adatlapon is elérhető általános `PATCH /:id` -- lásd a szerver oldali
   * `AssignAssetAquariumDto` és a `service.asset.aquarium-assign` jog
   * fejlécét (`packages/types` `auth.ts`, emlék 1843). Ez a szűk DTO
   * garantálja, hogy a portál NEM tud más mezőt küldeni az eszközön, még ha
   * a hívó megpróbálná is.
   *
   * `aquariumId: null` VESZI LE az eszközt az akváriumról. Az
   * `expectedUpdatedAt` KÖTELEZŐ -- a hívó félnek a legutóbb betöltött
   * eszköz-sor `updatedAt` mezőjét kell visszaküldenie, mert a szerver
   * mező-szintű ütközés-védelme (`asset-field-conflict.ts`) ez alapján dönt
   * el, nyúlt-e valaki más közben ugyanahhoz a mezőhöz.
   */
  assignAssetAquarium: (
    assetId: string,
    input: { aquariumId: string | null; expectedUpdatedAt: string },
  ) =>
    request<AssetDetail>(
      `/service/assets/${encodeURIComponent(assetId)}/aquarium`,
      { method: "PATCH", body: JSON.stringify(input) },
    ),
  /**
   * A QR-KOD LEKERDEZESE `SERVICE_VIEW`-T KER, NEM `SERVICE_MANAGE`-ET
   * (`service-assets.controller.ts`, `:id/qr`) -- tehat minden partner
   * felhasznalo lekerheti, aki mar most is latja az eszkozt. Ez a hivas nem
   * ir semmit, csak megjeleniti es letoltheto teszi a mar kiadott matricat.
   */
  assetQr: (id: string) =>
    request<AssetQrCode>(`/service/assets/${encodeURIComponent(id)}/qr`),
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
  /**
   * A LAPOZAS, A STATUSZ-SZURO ES A KERESES 2026-09-24-TOL VALODI PARAMETER,
   * NEM BEEGETETT ERTEK -- ugyanaz a minta, mint az `assets()`-nel. A vegpont
   * ugyanaz, mint a belso feluleten (`apps/web/src/lib/api/worksheets.ts`),
   * es a hatokort a szerver adja a hivo szerepe szerint.
   */
  worksheets: (input?: {
    status?: string;
    search?: string;
    page?: number;
    pageSize?: number;
  }) => {
    const query = new URLSearchParams({
      page: String(input?.page ?? 1),
      pageSize: String(input?.pageSize ?? 25),
    });
    if (input?.status) query.set("status", input.status);
    if (input?.search?.trim()) query.set("search", input.search.trim());
    return request<WorksheetListResponse>(`/service/worksheets?${query}`);
  },
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
  /**
   * A HATOKORT A SZERVER DONTI EL, NEM EZ A HIVAS -- ugyanaz a szabaly, mint
   * az `assets()`-nel: nincs `customerId` parameter, mert egy bennhagyott
   * azonosito azt sugallna, hogy a hivo szabalyozza a lathatosagot. Ma a
   * `PartnerScope` (`aquarium-visibility.ts`) szabalyozza, a szerveren --
   * a sajat ugyfel, kiosztott helyszinei szerint.
   */
  aquariums: (input?: {
    search?: string;
    page?: number;
    pageSize?: number;
  }) => {
    const query = new URLSearchParams({
      page: String(input?.page ?? 1),
      pageSize: String(input?.pageSize ?? 25),
    });
    if (input?.search?.trim()) query.set("search", input.search.trim());
    return request<AquariumListResponse>(`/aquariums?${query}`);
  },
  /** Idegen akvariumra 404 jon -- ugyanaz a hatokor, mint a listan. */
  aquarium: (id: string) =>
    request<AquariumDetail>(`/aquariums/${encodeURIComponent(id)}`),
  aquariumMeasurements: (id: string) =>
    request<AquariumMeasurementListResponse>(
      `/aquariums/${encodeURIComponent(id)}/measurements`,
    ),
  /**
   * ÚJ VÍZMÉRÉS RÖGZÍTÉSE -- Balázs döntése (2026-09-25): a portál "új
   * mérés" képessége nyitott a hívó saját, látható akváriumaira. A szerver
   * a hívó hatókörét a `requireAquarium` -> scoped `detail()` úton
   * ellenőrzi (`aquarium-measurements.service.ts` `create()`), tehát idegen
   * akváriumra 404-et ad, nem csendes elutasítást.
   */
  createAquariumMeasurement: (
    id: string,
    input: {
      measuredAt?: string;
      values: { parameterCode: string; value: number }[];
    },
  ) =>
    request<AquariumMeasurementOccasion>(
      `/aquariums/${encodeURIComponent(id)}/measurements`,
      {
        method: "POST",
        body: JSON.stringify(input),
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
