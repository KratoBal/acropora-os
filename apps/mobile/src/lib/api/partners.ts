import { apiRequest } from "./client";

/**
 * A végpont előtagja EGY HELYEN. Ez a fájl korábban 3-szer írta le ugyanezt, és
 * 2026-08-27-én a munkalap-kliens pontosan ezért tudott HÁROM helyen egyszerre
 * rossz előtaggal hívni: a szerkezet megengedte, hogy egy helyen javuljon és a
 * másik kettőben ne. Egy konstansnál ez a hiba nem tud részlegesen megtörténni.
 */
const BASE = "/suppliers";

/**
 * SZERVIZ PARTNEREK, OLVASÁSRA.
 *
 * A telefonon a partner MUNKAKÖRNYEZET: a szerelő azt nézi meg, kihez megy és
 * kit hívjon. A törzsadatát nem ő gondozza, ezért ez a modul csak olvas: a
 * szerver a `SERVICE` szerepkörnek `partners.view` jogot ad, `partners.manage`
 * jogot nem (a gazda döntése, 2026-08-21: „a szervizesek csak lássák
 * egyelőre"). Egy írásra képes hívás itt nem elfelejtett lehetőség, hanem az a
 * fajta ajtó, amit a szerver úgyis becsuk, a felhasználó pedig hibaüzenetként
 * kapna meg.
 *
 * A típusok SAJÁT másolatok, nem a `@acropora/types` csomagból jönnek: az Expo
 * app szándékosan nem húzza be a pnpm munkatér csomagjait (lásd
 * `docs/MOBILE-DEVELOPMENT.md`).
 */

export interface ServicePartnerListItem {
  id: string;
  code: string;
  name: string;
  isService: boolean;
  isSupplier: boolean;
  /** A partner rövidítése (`FANK`). A munkalapszámban már nincs benne, de a
   * lezárás megköveteli. Hiányozhat, amíg senki nem tölti ki. */
  worksheetPartnerCode?: string;
  phone?: string;
  email?: string;
  contactPersonName?: string;
  contactPersonPhone?: string;
  contactPersonEmail?: string;
  postalCode?: string;
  city?: string;
  addressLine1?: string;
  addressLine2?: string;
  isActive: boolean;
}

export interface ServicePartnerListResponse {
  items: ServicePartnerListItem[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
}

/**
 * A `kind=SERVICE` szűrés a SZERVEREN történik, nem itt.
 *
 * Ha egy már lapozott találati halmazt szűrnénk a telefonon, a lapok mérete
 * hazudna: az első oldalon öt sor látszana huszonöt helyett, a darabszám pedig
 * azokat is beleszámolná, akiket nem mutatunk.
 */
export function listServicePartners(page = 1, pageSize = 25, search = "") {
  const query = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
    kind: "SERVICE",
    status: "ACTIVE",
  });
  if (search.trim()) query.set("search", search.trim());
  return apiRequest<ServicePartnerListResponse>(`${BASE}?${query}`);
}

export function getServicePartner(id: string) {
  return apiRequest<ServicePartnerListItem>(
    `${BASE}/${encodeURIComponent(id)}`,
  );
}

/**
 * A PARTNER HELYSZÍNEI (alegységei), laposan.
 *
 * Ugyanaz a fa, amit a partner képernyőjén „Alegységek" néven szerkesztenek, és
 * ugyanaz a végpont, amit a webes eszköz-űrlap is hív. `partners.view` jogot
 * kér, amit a SERVICE szerepkör megkap -- a szerkesztéshez való `partners.manage`
 * nem kell hozzá, és nincs is meg neki.
 *
 * A választó-listát a `lib/partners/site-tree.ts` építi ebből: a fa a `parentId`
 * mezőből áll össze, és a teljes út kell, mert a kód csak testvérek között
 * egyedi.
 */
export interface PartnerUnit {
  id: string;
  parentId: string | null;
  code: string;
  name: string;
  isActive: boolean;
}

export function listPartnerUnits(partnerId: string) {
  return apiRequest<{ items: PartnerUnit[] }>(
    `${BASE}/${encodeURIComponent(partnerId)}/units`,
  );
}
