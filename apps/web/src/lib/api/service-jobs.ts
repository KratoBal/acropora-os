import type {
  ServiceJobDetail,
  ServiceJobDocumentSummary,
  ServiceJobDocumentType,
  ServiceJobListResponse,
  ServiceJobStatusValue,
} from "@acropora/types";

import { apiAuthHeaders, apiRequest } from "./client";
import { API_PREFIX } from "./api-prefix";

const base = "/service/jobs";

function jobPath(id: string, suffix = "") {
  return `${base}/${encodeURIComponent(id)}${suffix}`;
}

export const serviceJobsApi = {
  list(token: string, scope: "open" | "all", signal?: AbortSignal) {
    return apiRequest<ServiceJobListResponse>(`${base}?scope=${scope}`, token, {
      signal,
    });
  },
  /**
   * UJ HIBAJEGY. A valasz az AZONOSITOT es a SZAMOT hozza, mert a felvitel utan
   * a felulet a friss jegy lapjara visz -- egy sikeruzenet a listan azt hagyna
   * a felhasznalora, hogy megkeresse, amit epp letrehozott.
   */
  create(
    token: string,
    input: {
      title: string;
      description?: string | null;
      customerId?: string | null;
      /** A partner helyszine. Csak partnerrel egyutt ervenyes; a szerver
       * ellenorzi, hogy az egyseg tenyleg a megadott partnere. */
      departmentId?: string | null;
      /** A helyszinen allo eszkozok, amikrol a jegy szol. Csak helyszinnel
       * egyutt ervenyes; a szerver a helyszin RESZFAJAT fogadja el. */
      assetIds?: string[];
    },
  ) {
    return apiRequest<{ id: string; jobNumber: string }>(base, token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  },
  detail(token: string, id: string, signal?: AbortSignal) {
    return apiRequest<ServiceJobDetail>(jobPath(id), token, { signal });
  },
  /**
   * EGY MEGLEVO LAP A JEGY ALA. A valasz itt is csak nyugta, tehat a hivo
   * ujratolt - a csatolt lap a naploban ES a lista-szakaszban is megjelenik,
   * es azt egy nyugtabol nem lehet felepiteni.
   */
  attachWorksheet(token: string, id: string, worksheetId: string) {
    return apiRequest<{ ok: true }>(jobPath(id, "/worksheets"), token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ worksheetId }),
    });
  },
  /**
   * PARTNER EGY MEG PARTNER NELKULI JEGYRE. A valasz nyugta, tehat a hivo
   * ujratolt: a partner neve a fejlecben es a csatolo doboz megjelenese is
   * ettol fugg.
   */
  setPartner(token: string, id: string, customerId: string) {
    return apiRequest<{ ok: true }>(jobPath(id, "/partner"), token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customerId }),
    });
  },
  /**
   * A CSATOLAS VISSZAUTJA. Enelkul egy rossz valasztas a legordulobol orokre
   * ott hagyna a lapot a jegy alatt.
   */
  detachWorksheet(token: string, id: string, worksheetId: string) {
    return apiRequest<{ ok: true }>(
      jobPath(id, `/worksheets/${encodeURIComponent(worksheetId)}`),
      token,
      { method: "DELETE" },
    );
  },
  /**
   * A LATHATOSAGI HOZZARENDELESEK EGY FELHASZNALOHOZ.
   *
   * A HAROM HIVAS UGYANAZON A JOGON ALL (`service.visibility.assign`), a
   * felhasznalo-lap viszont `users.manage` alatt: ma a ket halmaz egybeesik
   * (OWNER es ADMIN), de nem ugyanaz a szabaly. A szakaszt ezert a SAJAT jogan
   * kapuzzuk a kepernyon, nem a lapera bizva.
   */
  visibilityAssignments(token: string, userId: string, signal?: AbortSignal) {
    return apiRequest<
      {
        departmentId: string;
        createdAt: string;
        department: { name: string; code: string };
      }[]
    >(`${base}/visibility/${encodeURIComponent(userId)}`, token, { signal });
  },
  /**
   * AMIBOL VALASZTANI LEHET. A szerver rakja ossze a lancot (felhasznalo ->
   * szallito -> tukor-vevo sor -> alegysegek), mert a felulet a masodik
   * lepeshez nem lat utat: a `UserDetail` `supplierId`-t ad, a partner-lista
   * `customerId`-t, es a ketto nem parosithato.
   */
  selectableUnits(token: string, userId: string, signal?: AbortSignal) {
    return apiRequest<{
      items: {
        id: string;
        name: string;
        code: string;
        parentId: string | null;
      }[];
    }>(`${base}/visibility/${encodeURIComponent(userId)}/units`, token, {
      signal,
    });
  },
  assignUnit(token: string, userId: string, departmentId: string) {
    return apiRequest<{ departmentId: string }>(
      `${base}/visibility/${encodeURIComponent(userId)}`,
      token,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ departmentId }),
      },
    );
  },
  unassignUnit(token: string, userId: string, departmentId: string) {
    return apiRequest<{ ok: true }>(
      `${base}/visibility/${encodeURIComponent(userId)}/${encodeURIComponent(departmentId)}`,
      token,
      { method: "DELETE" },
    );
  },
  /**
   * A JEGY CSATOLMANYAI. KULON HIVAS, nem a reszletlap resze.
   *
   * MIERT NEM A `ServiceJobDetail`-BEN: az eszkoznel a dokumentumok a
   * reszletlap valaszaban utaznak, itt nem. A jegy reszletlapja HAROM listat
   * fesul ossze egy naploba (allapotvaltas, munkalap, eszkoz), es a csatolmany
   * nem naplo-elem -- egy kesobb erkezo fenykep nem esemeny a jegy eleteben,
   * hanem allomany rajta. Kulon hivas mellett a lista FRISSITHETO feltoltes
   * utan anelkul, hogy a teljes reszletlapot (es vele a naplot) ujra le kellene
   * kerni.
   */
  documents(token: string, id: string, signal?: AbortSignal) {
    return apiRequest<{ items: ServiceJobDocumentSummary[] }>(
      jobPath(id, "/documents"),
      token,
      { signal },
    );
  },
  /**
   * FELTOLTES. LISTAT AD VISSZA, EGY FAJLNAL IS.
   *
   * A vegpont tobb fajlt fogad ugyanezen a mezonéven (`file`), es MINDIG
   * listaval valaszol. Egy valasz, aminek a TIPUSA a bemenettol fugg, minden
   * hivot arra kenyszeritene, hogy kitalalja, melyik agon jar.
   */
  uploadDocument(
    token: string,
    id: string,
    type: ServiceJobDocumentType,
    files: File[],
  ) {
    const body = new FormData();
    body.append("type", type);
    // UGYANAZ A MEZONEV MINDEN FAJLHOZ: a szerver `FilesInterceptor("file")`
    // alakban olvassa, tehat a tobbes szam a MEZO ISMETLESE, nem egy `file[]`
    // nevu mezo.
    for (const file of files) body.append("file", file);
    return apiRequest<ServiceJobDocumentSummary[]>(
      jobPath(id, "/documents"),
      token,
      { method: "POST", body },
    );
  },
  /**
   * LETOLTES. NYERS `fetch`, NEM `apiRequest`: a valasz BAJT, nem JSON.
   *
   * Ugyanaz az alak, amit az eszkoz-oldal hasznal. A `credentials` es a fejlec
   * kezzel kerul ra, mert az `apiRequest` a valaszt JSON-kent olvasna.
   */
  async downloadDocument(token: string, id: string, documentId: string) {
    const response = await fetch(
      /*
        A CIM ITT KIIRVA ALL, NEM a `jobPath` helperrel osszerakva -- es ez
        MERT megkotes, nem stilus. A repo hasonlosag-meroje
        (`mobile-api-routes.spec.ts`) a kliens-fajlokbol olvassa ki a hivott
        cimeket, es a helper-hivast egy sablonon BELUL nem tudja feloldani: a
        kimenete egy ertelmetlen ut lett, es a mero pirosra valtott. Szandekosan
        szuk, tehat a helyes valasz nem a mero tagitasa, hanem a kiirt alak --
        ugyanaz, amit az eszkoz-oldali letoltes is hasznal.
      */
      `${API_PREFIX}/service/jobs/${encodeURIComponent(id)}/documents/${encodeURIComponent(documentId)}`,
      { credentials: "same-origin", headers: apiAuthHeaders(token) },
    );
    if (!response.ok) throw new Error("A csatolmány nem tölthető le.");
    return response.blob();
  },
  deleteDocument(token: string, id: string, documentId: string) {
    return apiRequest<{ removed: true }>(
      jobPath(id, `/documents/${encodeURIComponent(documentId)}`),
      token,
      { method: "DELETE" },
    );
  },
  /**
   * A LÉPÉS VÁLASZA CSAK NYUGTA (`{ ok: true }`), nem a friss jegy.
   *
   * Ezért a hívó ÚJRATÖLT utána. Ha a nyugtából építenénk fel a képernyőt, a
   * napló új sora hiányozna róla - és épp az a sor a lépés bizonyítéka.
   */
  move(
    token: string,
    id: string,
    input: { to: ServiceJobStatusValue; note?: string | null },
  ) {
    return apiRequest<{ ok: true }>(jobPath(id, "/move"), token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  },
};
