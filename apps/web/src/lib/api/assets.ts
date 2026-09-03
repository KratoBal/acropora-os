import type { AssetLabelBatchSummary } from "@acropora/types";
import type {
  AssetDetail,
  AssetListResponse,
  AssetDocumentSummary,
  AssetDocumentType,
  AssetOwnerListResponse,
  AssetOwnerType,
  AssetQrCode,
  CreateAssetInput,
  UpdateAssetInput,
} from "@acropora/types";

import { apiAuthHeaders, apiRequest } from "./client";
import { API_PREFIX } from "./api-prefix";

export const assetLabelsApi = {
  /**
   * A KORABBI GENERALASOK: mikor, hany kod, hany szabad meg.
   *
   * A "szabad" a MEG NEM REGISZTRALT kodok szama, es a szerver SZAMOLJA. Hogy
   * hany matrica van meg KINYOMTATATLANUL, arra ma nincs forras -- a nyomtatas
   * tenyet sehol nem rogzitjuk.
   */
  batches(token: string, signal?: AbortSignal) {
    return apiRequest<AssetLabelBatchSummary[]>(
      "/service/assets/label-batches",
      token,
      { signal },
    );
  },
  /**
   * MAR KINYOMTATOTT KODOK BETOLTESE UJ KOTEGKENT.
   *
   * MEGISMETELHETO, es a valasz megmondja, mi tortent: az `imported` az UJAK, az
   * `alreadyExisted` azok, amik mar a keszletben voltak. A ketto kulon all,
   * mert a teendo mas -- az elso siker, a masodik arra utal, hogy a listat mar
   * betoltottek egyszer.
   */
  importCodes(token: string, codes: string[]) {
    return apiRequest<{
      batchId: string;
      imported: string[];
      alreadyExisted: string[];
    }>("/service/assets/label-batches/import", token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ codes }),
    });
  },
  /**
   * A SZABAD MATRICAK, KOTEGTOL FUGGETLENUL.
   *
   * A VALASZ LIMITALT (a vegpont alapja 100, felso hatara 500), tehat a lista
   * HOSSZA NEM a teljes szabad keszlet szama. A hivo ezert nem irhat ki belole
   * darabszamot ugy, mintha az az osszes lenne -- a lapon a limit is ott all.
   */
  free(token: string, limit: number, signal?: AbortSignal) {
    return apiRequest<{ id: string; code: string; issuedAt: string }[]>(
      `/service/assets/labels/free?limit=${limit}`,
      token,
      { signal },
    );
  },
  /**
   * EGY KOTEG KODJAI, A LETOLTESHEZ.
   *
   * KULON HIVAS, ES NEM A LISTA RESZE: a `batches` valasza otven kotegre
   * szolna, egyenkent akar otszaz koddal -- az akkor is atmenne a halon, ha
   * senki nem tolt le semmit. Ez EGY kotegrol szol, es akkor fut, amikor a
   * kezelo tenylegesen letoltene.
   */
  codes(token: string, batchId: string, signal?: AbortSignal) {
    return apiRequest<{ codes: string[] }>(
      `/service/assets/label-batches/${encodeURIComponent(batchId)}/codes`,
      token,
      { signal },
    );
  },
  /**
   * UJ TETEL GENERALASA. A valasz a kodokat IS visszaadja, hogy a letoltes
   * azonnal eloallithato legyen belole -- kulon lekerdezes nelkul.
   */
  issue(token: string, count: number, signal?: AbortSignal) {
    return apiRequest<{ batchId: string; codes: string[] }>(
      "/service/assets/label-batches",
      token,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count }),
        signal,
      },
    );
  },
};

export const assetsApi = {
  list(token: string, query: URLSearchParams, signal?: AbortSignal) {
    return apiRequest<AssetListResponse>(`/service/assets?${query}`, token, {
      signal,
    });
  },
  /**
   * A választható tulajdonosok: a szerviz-jelölt partnerek.
   *
   * A `keep` egy MÁR RÖGZÍTETT eszköz tulajdonosa. Aki szerkeszt, annak akkor is
   * látnia kell a saját tulajdonosát, ha az ma nem lenne választható -- különben
   * a kötelező mező üresen állna, és a mentés vagy elakadna, vagy más
   * tulajdonost írna a helyére.
   */
  owners(
    token: string,
    signal?: AbortSignal,
    keep?: { type: AssetOwnerType; id: string } | null,
  ) {
    const query = keep
      ? `?${new URLSearchParams({ ownerType: keep.type, ownerId: keep.id })}`
      : "";
    return apiRequest<AssetOwnerListResponse>(
      `/service/assets/owners${query}`,
      token,
      { signal },
    );
  },
  detail(token: string, id: string, signal?: AbortSignal) {
    return apiRequest<AssetDetail>(
      `/service/assets/${encodeURIComponent(id)}`,
      token,
      { signal },
    );
  },
  create(token: string, input: CreateAssetInput) {
    return apiRequest<AssetDetail>("/service/assets", token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  },
  update(token: string, id: string, input: UpdateAssetInput) {
    return apiRequest<AssetDetail>(
      `/service/assets/${encodeURIComponent(id)}`,
      token,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
    );
  },
  /**
   * VEGLEGES TORLES. Kulon jog all rajta (`SERVICE_ASSET_DELETE`), es a szerver
   * megtagadja, ha az eszkozhoz hibajegy, munkalapsor vagy alarendelt eszkoz
   * tartozik -- a valasz MEGNEVEZI, melyik. A hivo ezt a szoveget adja tovabb,
   * nem forditja altalanosra.
   */
  remove(token: string, id: string) {
    return apiRequest<{ ok: true }>(
      `/service/assets/${encodeURIComponent(id)}`,
      token,
      { method: "DELETE" },
    );
  },
  qr(token: string, id: string, signal?: AbortSignal) {
    return apiRequest<AssetQrCode>(
      `/service/assets/${encodeURIComponent(id)}/qr`,
      token,
      { signal },
    );
  },
  rotateQr(token: string, id: string) {
    return apiRequest<AssetDetail>(
      `/service/assets/${encodeURIComponent(id)}/qr/rotate`,
      token,
      { method: "POST" },
    );
  },
  uploadDocument(
    token: string,
    id: string,
    type: AssetDocumentType,
    file: File,
  ) {
    const body = new FormData();
    body.append("type", type);
    body.append("file", file);
    // LISTÁT AD VISSZA, EGY FÁJLNÁL IS. A végpont több fájlt fogad ugyanezen a
    // mezőnéven, és mindig listával válaszol. Ez a felület ma egy fájlt
    // választ, tehát a lista egyelemű - de a TÍPUSNAK azt kell mondania, ami
    // érkezik: ezt a fordító nem tudja ellenőrizni a szerver felé, mert a két
    // oldal külön deklarálja, és egy hazug típusparaméter itt csendben marad.
    return apiRequest<AssetDocumentSummary[]>(
      `/service/assets/${encodeURIComponent(id)}/documents`,
      token,
      { method: "POST", body },
    );
  },
  async downloadDocument(token: string, id: string, documentId: string) {
    const response = await fetch(
      `${API_PREFIX}/service/assets/${encodeURIComponent(id)}/documents/${encodeURIComponent(documentId)}`,
      { credentials: "same-origin", headers: apiAuthHeaders(token) },
    );
    if (!response.ok) throw new Error("A dokumentum nem tölthető le.");
    return response.blob();
  },
  deleteDocument(token: string, id: string, documentId: string) {
    return apiRequest<{ ok: true }>(
      `/service/assets/${encodeURIComponent(id)}/documents/${encodeURIComponent(documentId)}`,
      token,
      { method: "DELETE" },
    );
  },
};
