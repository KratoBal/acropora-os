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
  /**
   * A KERESES A SZERVERRE MEGY, nem a betoltott lapon szur. Ket szerviz-lista
   * (munkalap, hibajegy), egy szabaly -- es egy kliensoldali szuro azt igerne,
   * hogy az egesz halmazban keres, holott csak a visszaadott ketszaz soron.
   */
  list(
    token: string,
    scope: "open" | "all",
    signal?: AbortSignal,
    search?: string,
    includeHidden?: boolean,
  ) {
    const query = new URLSearchParams({ scope });
    const trimmed = search?.trim();
    if (trimmed) query.set("search", trimmed);
    /**
     * CSAK AKKOR KERUL BE, HA KERTEK. Egy `includeHidden=false` ugyanazt
     * jelentene a szervernek, mint a hianyzo mezo, es minden lekerest
     * megkulonboztethetetlenne tenne a naplokban attol, amelyik tenyleg kerte.
     */
    if (includeHidden) query.set("includeHidden", "true");
    return apiRequest<ServiceJobListResponse>(`${base}?${query}`, token, {
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
      /**
       * A JEGYRE DELEGALT KOLLEGAK, MAR A FELVITELKOR.
       *
       * Az iroda nyitja a jegyet a szervizesnek: a delegalas abban a
       * pillanatban ismert, amikor a jegy megszuletik. Kulon lepesre bizva a
       * felvivo azt hiszi, kiadta a munkat, kozben a jegy senki listajan nem
       * jelenik meg -- es errol semmi nem szol, mert a delegalatlan jegy nem
       * hibas allapot.
       */
      assigneeIds?: string[];
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
   * A JEGYRE DELEGALT KOLLEGAK TELJES NEVSORA.
   *
   * A VALASZ A TELJES RESZLETLAP, NEM NYUGTA, es ez elter a tobbi
   * jegy-muvelettol (`move`, `attachWorksheet`, `setPartner`). Azok utan a hivo
   * ujratolt; itt NEM kell, mert a szerver ugyanazt a sort adja vissza, amit a
   * kepernyo rajzol. Egy reflexbol beirt ujratoltes itt egy folosleges kort
   * tenne be.
   *
   * A MEZO NEVE `userIds`, nem `assigneeIds` -- a KET vegpont ket kulon DTO-t
   * hasznal, es a felvitelkori mezo hivjak `assigneeIds`-nek. Lemerve a
   * `SetServiceJobAssigneesDto`-n: egy elgepelt nev itt nem forditasi hiba
   * lenne, hanem 400-as valasz a kepernyon.
   */
  setAssignees(token: string, id: string, input: { userIds: string[] }) {
    return apiRequest<ServiceJobDetail>(jobPath(id, "/assignees"), token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  },
  /**
   * A JEGY HELYSZINE ES AZ OTT ALLO ESZKOZOK, EGY HIVASBAN.
   *
   * EGY VEGPONT A KETTORE, es nem kenyelem: a felvitelen is EGY szabaly koti
   * ossze oket (eszkozt csak helyszinnel egyutt, es a helyszin RESZFAJAROL).
   * Ket kulon hivas sorrend-fuggo kozbenso allapotot engedne: uj helyszin a
   * regi eszkozokkel, vagy forditva -- es ha a masodik elhasal, az az allapot
   * ITT MARAD, ranezesre hibatlanul.
   *
   * AZ `assetIds` A TELJES HALMAZ: aki nincs rajta, lekerul. Helyszin-valtaskor
   * EZ a megerosites helye -- a felulet megnevezi a leeso eszkozoket, es amit a
   * felhasznalo jovahagy, az utazik itt.
   */
  setPlacement(
    token: string,
    id: string,
    input: {
      departmentId: string;
      assetIds: string[];
      /**
       * A KOTOTT LAPOKON MARADO, KIVUL ESO ESZKOZOK TUDOMASULVETELE.
       *
       * A szerver ELSO korben MEGNEVEZI oket (409, mondatokkal), es csak a
       * masodik, kimondott korben ir. Elhagyva a felhasznalo nem mondott igent.
       */
      acceptWorksheetAssetsOutsideSite?: boolean;
    },
  ) {
    return apiRequest<ServiceJobDetail>(jobPath(id, "/placement"), token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
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
  /**
   * A `caption` EGY KERESRE EGY FELIRAT, es ez a szerver alakja, nem itteni
   * egyszerusites: a vegpont tiz fajlt fogad, es ez az egy szoveg MINDEGYIKRE
   * rakerul. Kepenkent mast a `setDocumentCaption` ir.
   */
  uploadDocument(
    token: string,
    id: string,
    type: ServiceJobDocumentType,
    files: File[],
    caption?: string,
  ) {
    const body = new FormData();
    body.append("type", type);
    // CSAK AKKOR MEGY EL, HA VAN: egy ures mezo `""` erteket kuldene, amit a
    // szerver ugyan semminek vesz, de a keresben akkor is ott allna mint
    // kitoltott mezo.
    if (caption?.trim()) body.append("caption", caption.trim());
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
  async downloadPackage(token: string, id: string) {
    const response = await fetch(
      `${API_PREFIX}/service/jobs/${encodeURIComponent(id)}/download`,
      { credentials: "same-origin", headers: apiAuthHeaders(token) },
    );
    if (!response.ok) throw new Error("A dokumentumcsomag nem tölthető le.");
    return response.blob();
  },
  /**
   * A FELIRAT ATIRASA EGY MAR FELTOLTOTT CSATOLMANYON.
   *
   * A `null` a TORLES, es ez nem kenyelmi alak: a szerver a hianyt EGYFELE
   * alakban tarolja, tehat az ures szoveg is `null`-kent er le. Ha a kliens
   * ures stringet kuldene, a "nincs felirat" es a "szandekosan ures felirat"
   * ket allapota egyformanak tunne.
   */
  setDocumentCaption(
    token: string,
    id: string,
    documentId: string,
    caption: string | null,
  ) {
    return apiRequest<{ ok: true }>(
      jobPath(id, `/documents/${encodeURIComponent(documentId)}`),
      token,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caption }),
      },
    );
  },
  deleteDocument(token: string, id: string, documentId: string) {
    return apiRequest<{ removed: true }>(
      jobPath(id, `/documents/${encodeURIComponent(documentId)}`),
      token,
      { method: "DELETE" },
    );
  },
  /**
   * A LÉPÉS VÁLASZA 2026-09-17 ÓTA A FRISS RÉSZLETLAP, nem nyugta.
   *
   * A korábbi `{ ok: true }` alak egy éles hibán bukott meg a TELEFONON (a
   * léptetés kiléptette az alkalmazást), ezért a szerver most a teljes lapot
   * adja vissza -- ugyanúgy, mint a felelős-kiosztás és a helyszín beállítása.
   *
   * A HÍVÓ ITT TOVÁBBRA IS ÚJRATÖLT, és ez nem feledékenység: a lépés a
   * választó-listákat is elavulttá teszi, azokat pedig ez a válasz nem hozza.
   * A típus viszont attól még IGAZAT mondjon: egy `{ ok: true }` deklaráció a
   * mai válaszra hamis, és épp egy ilyen hamis deklaráció volt a telefonos
   * hiba oka.
   */
  /**
   * A JEGY ELREJTESE VAGY VISSZAALLITASA. Ugyanaz az alak, mint a
   * munkalapnal: a jelolo a torzsben megy, egy uton.
   *
   * A valasz URES, es ez nem hianyossag: a rejtes a jegy egyetlen mezojet
   * mozditja, a reszletlap pedig ugyis ujratoltodik utana. Egy fel-frissitett
   * reszlet-objektum visszaadasa azt igerne, hogy a tobbi mezo is friss.
   */
  setHidden(token: string, id: string, hidden: boolean) {
    return apiRequest<void>(jobPath(id, "/hidden"), token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hidden }),
    });
  },
  move(
    token: string,
    id: string,
    input: { to: ServiceJobStatusValue; note?: string | null },
  ) {
    return apiRequest<ServiceJobDetail>(jobPath(id, "/move"), token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  },
};
