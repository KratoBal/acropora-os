import { apiAuthHeaders, apiRequest } from "./client";
import { API_PREFIX } from "./api-prefix";

const base = "/partners/contracts";

export type ContractItemInput = {
  /**
   * MEGLÉVŐ TÉTEL AZONOSÍTÓJA -- ha adott, a szerver UPDATE-eli a sort (az
   * id állandó marad), ha hiányzik, ÚJ tétel jön létre. Balázs éles
   * hibája (2026-09-24 21:48): e nélkül minden mentés törölte és
   * újraépítette az összes tételt, új id-vel, és a kliens tétel-kulcsos
   * állapota (kijelölt tételek, helyszín, eszközök) a régi id-n maradt.
   */
  id?: string;
  description: string;
  unitNet: string;
  quantity: string;
  occasionsPerYear: number;
  vatRatePercent: string;
  departmentId?: string | null;
  assetIds?: string[];
};

export type ContractInput = {
  customerId: string;
  number: string;
  title: string;
  validFrom: string;
  validTo?: string | null;
  status?: "DRAFT" | "ACTIVE" | "EXPIRED" | "TERMINATED";
  notes?: string | null;
  /**
   * A vevő szervezeti egysége és kapcsolattartója a megrendelőlapon -- MI
   * TÖLTJÜK KI, nem a vevő (Balázs döntése, 2026-09-24).
   */
  organizationalUnitName?: string | null;
  contactPersonName?: string | null;
  items: ContractItemInput[];
};

/**
 * EGY TÉTEL, AHOGY A SZERVER VISSZAADJA -- NEM AZONOS A `ContractItemInput`-tal.
 *
 * A `departmentId` SZKALÁR mező, tehát ugyanaz az alak íráson és olvasáson is
 * (`contracts.repository.ts` `contractInclude`-ja nem szűkíti a scalar
 * mezőket). Az `assetIds` viszont CSAK ÍRÁSKOR létezik: olvasáskor a szerver
 * az `assets` kapcsolati tömböt adja (`{assetId, asset: {...}}[]`), nem egy
 * lapos azonosító-listát. Eddig ez a típus a `ContractItemInput`-ot örökölte,
 * és `assetIds`-t ígért olvasásra is -- ami a szervertől SOHA nem jött meg
 * (lásd acrobot kártyáját, 2026-09-24 20:36: "a szerver tudja... de a webes
 * felületen SEHOL nincs mező hozzá").
 */
export type ContractItemSummary = {
  id: string;
  position: number;
  description: string;
  unitNet: string;
  quantity: string;
  occasionsPerYear: number;
  vatRatePercent: string;
  departmentId: string | null;
  assets: Array<{ assetId: string }>;
};

export type ContractSummary = Omit<ContractInput, "items"> & {
  id: string;
  customer: { id: string; displayName: string };
  createdAt: string;
  updatedAt: string;
  documents: Array<{
    id: string;
    fileName: string;
    contentType: string;
    sizeBytes: number;
    createdAt: string;
  }>;
  items: ContractItemSummary[];
};

export const contractsApi = {
  list(token: string) {
    return apiRequest<ContractSummary[]>(base, token);
  },
  detail(token: string, id: string) {
    return apiRequest<ContractSummary>(
      `${base}/${encodeURIComponent(id)}`,
      token,
    );
  },
  customers(token: string) {
    return apiRequest<
      Array<{
        id: string;
        displayName: string;
        worksheetPartnerCode: string | null;
      }>
    >(`${base}/customers`, token);
  },
  create(token: string, input: ContractInput) {
    return apiRequest<ContractSummary>(base, token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  },
  update(token: string, id: string, input: Partial<ContractInput>) {
    return apiRequest<ContractSummary>(
      `${base}/${encodeURIComponent(id)}`,
      token,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
    );
  },
  uploadPdf(token: string, id: string, file: File) {
    const form = new FormData();
    form.append("file", file);
    return apiRequest(`${base}/${encodeURIComponent(id)}/documents`, token, {
      method: "POST",
      body: form,
    });
  },
  async downloadPdf(token: string, id: string, documentId: string) {
    const response = await fetch(
      `${API_PREFIX}${base}/${encodeURIComponent(id)}/documents/${encodeURIComponent(documentId)}`,
      { credentials: "same-origin", headers: apiAuthHeaders(token) },
    );
    if (!response.ok) throw new Error("A szerződés PDF-je nem tölthető le.");
    return response.blob();
  },
};
