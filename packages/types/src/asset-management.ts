export type AssetKind =
  "SYSTEM" | "EQUIPMENT" | "COMPONENT" | "SENSOR" | "OTHER";

/**
 * AZ ESZKÖZ ÁLLAPOTA. A sorrend a séma enum-sorrendjét követi, mert az a
 * LISTA RENDEZÉSE is (`assetListOrderBy`): csökkenő rendelkezésre állás.
 *
 * A két tartalék a régi `OUT_OF_SERVICE` helyére jött (Balázs kérése,
 * 2026-09-16). A régi érték egyetlen dolgot mondott -- hogy nem üzemel --, és
 * azt is a HIÁNYÁVAL; a két új azt mondja meg, MIRE számíthat a szerelő.
 */
export type AssetStatus =
  "ACTIVE" | "WARM_STANDBY" | "COLD_STANDBY" | "IN_REPAIR" | "RETIRED";

export type AssetCriticality = "LOW" | "NORMAL" | "HIGH" | "CRITICAL";

export type AssetOwnerType = "CUSTOMER" | "SUPPLIER";

/**
 * A DOKUMENTUM FAJTAJA, KLIENS-OLDALON.
 *
 * EZ A LISTA A NEGYEDIK PELDANY, ES A SZAM NEM RETORIKA -- merve 2026-09-22, a
 * PHOTO fajta felvetelekor. Ugyanez a negy ertek allt a semaban, a szerver
 * hatokor-szabalyaban, a tarolo DTO-jaban es itt. A PHOTO atvezetese soran a
 * fordito ebbol KETTOT fogott meg (ezt es a webes feliratot), a mobil sajat
 * masolata viszont NEMA maradt: az a csomag a pnpm workspace-en kivul all.
 *
 * AZ EGYEZEST MOSTANTOL ALLITAS ORZI, a testver-lista mintajara:
 * `apps/api/src/service-assets/asset-document-type-egyezes.spec.ts`.
 * A DTO masolata ugyanakkor MEGSZUNT: az a fajl mar ebbol a halmazbol dolgozik.
 */
export type AssetDocumentType =
  "INVOICE" | "WARRANTY" | "MANUAL" | "OTHER" | "PHOTO";

export type AssetEventType =
  | "CREATED"
  | "UPDATED"
  | "PLACEMENT_CHANGED"
  | "PARENT_CHANGED"
  | "STATUS_CHANGED"
  | "QR_ROTATED"
  | "LABEL_ASSIGNED"
  | "DOCUMENT_UPLOADED"
  | "DOCUMENT_DELETED";

export interface AssetCustomerSummary {
  id: string;
  customerNumber: string;
  displayName: string;
}

export interface AssetOwnerSummary {
  type: AssetOwnerType;
  id: string;
  code: string;
  displayName: string;
}

export interface AssetOwnerOption extends AssetOwnerSummary {
  isActive: boolean;
  address?: AssetAddressSummary;
  addresses: AssetAddressSummary[];
  /**
   * Igaz, ha ez a tulajdonos MA NEM választható új eszközhöz: nem szerviz-jelölt
   * partner, vagy webshopos vevő. Az ilyen sor csak azért van a listában, mert
   * egy MÁR RÖGZÍTETT eszköz tulajdonosa, és a szerkesztő nem veheti el azt, amit
   * nem ő tett oda. A felület megjelöli, a hívó nem kínálja fel újnak.
   */
  outsideServiceScope?: boolean;
}

export interface AssetOwnerListResponse {
  items: AssetOwnerOption[];
}

export interface AssetAddressSummary {
  id: string;
  name?: string;
  formatted: string;
}

export interface AssetAquariumSummary {
  id: string;
  aquariumNumber: string;
  name: string;
}

export interface AssetHierarchyItem {
  id: string;
  assetNumber: string;
  name: string;
  kind: AssetKind;
  status: AssetStatus;
}

export interface AssetProductSummary {
  variantId: string;
  sku: string;
  name: string;
}

export interface AssetUnitSummary {
  id: string;
  code: string;
  name: string;
  /**
   * A TELJES ÚT a gyökértől eddig az egységig, a nevekkel, sorrendben (az
   * utolsó elem maga az egység neve).
   *
   * AMIÉRT NEM ELÉG A `name`: a kód és a név csak TESTVÉREK között egyedi, tehát
   * két távoli ág alatt ugyanaz a „Biodóm (BIO)" megengedett. Egy listában a
   * puszta név ilyenkor két különböző egységre ugyanazt a képet adja, és semmi
   * nem jelzi az olvasónak, hogy van miben tévedni.
   */
  path: string[];
}

export interface AssetListItem extends AssetHierarchyItem {
  criticality: AssetCriticality;
  owner: AssetOwnerSummary;
  /**
   * MIKOR VÁLASZTÁS EZ, ÉS MIKOR VISSZAESÉS -- a szabály itt áll, hogy egy
   * későbbi felület ne fejtse vissza magának, és ne mossa össze a kettőt:
   *
   * - `owner.type === "CUSTOMER"`: a vevő KIVÁLASZTOTT címe. Ha nincs
   *   kiválasztva, a mező hiányzik.
   * - `owner.type === "SUPPLIER"`: MINDIG a partner saját postai címe, mert
   *   szállító-tulajdonoshoz vevői cím nem rendelhető. Ilyenkor tehát ez
   *   VISSZAESÉS, nem választás -- a választott hely a `unit`, és ha az
   *   hiányzik, a felület jelölje meg, hogy nincs pontosítva.
   *
   * Külön mező helyett azért elég ez a szabály, mert a két eset már ma
   * megkülönböztethető: szállító-tulajdonosnál a `customerAddressId` mindig
   * `null`, tehát ami itt látszik, csak a partner címe lehet.
   */
  address?: AssetAddressSummary;
  /**
   * A PARTNER ALEGYSÉGE, ahol az eszköz áll. Csak szerviz partner
   * tulajdonosnál van értéke; vevőnél az `address` a pontosítás.
   *
   * A listán is kimegy, nem csak az adatlapon: enélkül a felület nem tudná
   * kiírni, hol áll az eszköz, anélkül hogy eszközönként külön hívást
   * indítana.
   */
  unit?: AssetUnitSummary;
  aquarium?: AssetAquariumSummary;
  parent?: AssetHierarchyItem;
  manufacturer?: string;
  model?: string;
  serialNumber?: string;
  /**
   * AZ ÜGYFÉL SAJÁT ESZKÖZKÓDJA, a listasoron is.
   *
   * A keresés eddig is nézte, a sor viszont nem mutatta: az ügyfél felolvasta a
   * saját kódját, a találat feljött, és semmi nem árulta el, MIRE illeszkedett.
   * Egy találat, ami nem mutatja meg, mire talált, ugyanazt kérdezteti meg
   * másodszor.
   */
  inventoryNumber?: string;
  /**
   * AZ ESZKOZON ALLO ELORE NYOMTATOTT MATRICA KODJA, HA VAN.
   *
   * MIERT KERULT BE (2026-09-16): a kodot eddig CSAK IRNI lehetett -- egyetlen
   * felulet sem mutatta meg, melyik matrica all egy eszkozon. Amig a kod csak
   * FELVITELKOR volt megadhato, ez nem latszott hianynak. Az utolagos felvitel
   * viszont CSERET is megenged, es egy csere, amit a szerelo nem lat, egy
   * MUKODO matricat ir felul nemán: az urlap ures mezot mutatna, o beirna egy
   * kodot, es a regi visszakerulne a keszletbe anelkul, hogy barki tudna rola.
   *
   * Ezert a szerkeszto urlap ebbol tolti elo a mezot: ami ott all, az a
   * VALOSAG, nem egy ures hely.
   *
   * ES A LISTASORON IS, NEM CSAK AZ ADATLAPON (2026-09-18, Balazs kerese).
   * Ugyanaz az indok, ami az `inventoryNumber`-nel all felette: a KERESES
   * eddig is nezte (a lista `search` aga a matricakodra is illeszkedik), a sor
   * viszont nem mutatta -- tehat a talalatrol nem latszott, MIRE illeszkedett.
   * Nem jar extra adatbazis-koltseggel: a `label` relacio egy mezoje, es a
   * lekerdezes ugyanabban a korben hozza.
   *
   * `?: string` ES NEM `| null`, SZANDEKOSAN: a hianyzo matrica azt jelenti,
   * hogy NINCS kod -- nem azt, hogy nem kertuk le. A szomszedos szuro-mezonel
   * ezzel ELLENTETES alak all, es az sem veletlen; a kettot ne egysegesitsd.
   */
  labelCode?: string;
  nextServiceAt?: string;
  /**
   * A QR-matricán lévő azonosító.
   *
   * A listán is szerepel, nem csak az adatlapon, mert a helyszíni munkához
   * a telefon előre letölti az eszközöket, és térerő nélkül a beolvasott
   * kódot ebből kell feloldania. Adatlapról építeni a katalógust eszközönként
   * egy hívást jelentene.
   *
   * Nem ad új hozzáférést: a lista, az adatlap és a `scan` végpont MIND
   * ugyanazt a jogosultságot kéri (`SERVICE_VIEW`), tehát aki listázni tud,
   * az ma is megnyit bármelyik eszközt és beolvas bármelyik tokent.
   *
   * EZ MEGFORDUL, ha a beolvasás valaha bejelentkezés nélkül is működne
   * (például ügyfélnek szánt oldalon): akkor a token bemutatóra szóló
   * kulccsá válik, és nem szabad listában kiadni.
   */
  qrToken: string;
  childCount: number;
  updatedAt: string;
}

/**
 * MIT VALASZOL A MATRICAKOD BEOLVASASA.
 *
 * KET ESET KAP KULON VALASZT, A HARMADIK SZANDEKOSAN NEM LETEZIK ITT:
 *
 *     ASSET   a kod egy olyan eszkozon all, amit a hivo LATHAT
 *     FREE    a kod kiadott, de meg nincs eszkozhoz rendelve
 *
 * A „nem letezik" es a „letezik, de nem lathatod" NEM ebben az uniobam all,
 * hanem 404-kent erkezik, EGYETLEN alakban -- kulonben a matricakod
 * letezes-teszt lenne idegen eszkozokre (egy betu es negy szam, 260 ezer
 * lehetoseg, vegigprobalhato).
 *
 * ES A `FREE` VALASZ FELTETELES: csak belso hatokoru, IRASI joggal rendelkezo
 * hivo kapja meg. Az indok a szerver oldali `scanLabelOutcome` fejleceben all,
 * a meressel egyutt -- roviden: a szabad keszlet LISTAJA `SETTINGS_MANAGE`
 * moge van zarva, es egy „ez szabad" valasz ugyanannak az adatnak az
 * egyenkenti lekerdezese.
 */
export type AssetLabelScanResult =
  { kind: "ASSET"; asset: AssetDetail } | { kind: "FREE"; code: string };

export interface AssetDocumentSummary {
  id: string;
  type: AssetDocumentType;
  fileName: string;
  /**
   * A TÁROLT FÁJL TÍPUSA, ÉS EZ A LISTA MOSTANTÓL HÁROM ELEMŰ.
   *
   * Korábban a rögzített `"application/pdf"` literál állt itt, és igaz is volt
   * addig, amíg a végpont csak PDF-et fogadott. A képek befogadásával a
   * literál csendben hazudni kezdett: a szerver `image/jpeg` értéket ír a
   * sorba, a szerződés szerint viszont az az érték nem is létezhet. A fordító
   * nem szólt volna, mert a beírás oldalán `string` áll.
   *
   * Az unió szűkebb, mint a `string`, és ez szándékos: kimondja, mi állhat
   * ott, tehát egy negyedik formátum felvétele ITT is átvezetést kíván.
   */
  contentType: "application/pdf" | "image/jpeg" | "image/png";
  sizeBytes: number;
  sha256: string;
  /**
   * A CSATOLMANY FELIRATA -- MIT LATUNK A KEPEN. `null`, ha nincs.
   *
   * A HIANY EGYFELE ALAKBAN ALL (`null`, nem ures string): kulonben a "nincs
   * felirat" es a "szandekosan ures felirat" megkulonboztethetetlen lenne.
   */
  caption: string | null;
  uploadedBy?: { id: string; displayName: string };
  createdAt: string;
}

export interface AssetEventSummary {
  id: string;
  type: AssetEventType;
  actor?: {
    id: string;
    displayName: string;
  };
  payload: Record<string, unknown>;
  occurredAt: string;
}

export interface AssetDetail extends AssetListItem {
  /**
   * A TELJESÍTMÉNY, SZÖVEGKÉNT -- ÉS EZ NEM KÉNYELMETLENSÉG, HANEM A PONTOSSÁG.
   *
   * A tárolt alak `decimal(19,6)`. Ha ezt `number`-ré alakítanánk, a JavaScript
   * lebegőpontos számán át menne, és egy `0.1`-es lépésköz máris `0.30000000000000004`
   * alakban jönne vissza a kezelőnek. A szám itt NEM számolunk vele: leírjuk és
   * megmutatjuk, tehát a szöveg a hűbb alak.
   */
  performance?: string;
  /**
   * AZ EGYSÉG KIÍRVA JÖN, NEM CSAK AZ AZONOSÍTÓJA.
   *
   * Az adatlapnak `500 W`-ot kell mutatnia. Ha csak az azonosító jönne, minden
   * felület (web, mobil) KÜLÖN hívná le a törzsadatot, hogy egyetlen jelet
   * kiírhasson -- és a mobil ezt térerő nélkül nem tudná megtenni. A kivezetett
   * egység ugyanígy jön: a múltat nem írjuk át.
   */
  performanceUnit?: {
    id: string;
    code: string;
    name: string;
  };
  /**
   * A KATEGORIA NEVE -- A TORZSADATBOL, NEM SZABAD SZOVEGBOL.
   *
   * A mezo NEVE valtozatlan, tehat a megjelenito helyek nem mozdulnak. Ami
   * valtozott: az ERTEK mostantol egy `AssetCategory` sorbol jon, es a
   * `categoryId` mondja meg, melyikbol.
   */
  category?: string;
  /** A valasztott kategoria azonositoja; a szerkeszto ezt kuldi vissza. */
  categoryId?: string;
  description?: string;
  installedAt?: string;
  purchasedAt?: string;
  warrantyExpiresAt?: string;
  serviceIntervalDays?: number;
  lastServicedAt?: string;
  notes?: string;
  archivedAt?: string;
  product?: AssetProductSummary;
  ancestors: AssetHierarchyItem[];
  children: AssetHierarchyItem[];
  events: AssetEventSummary[];
  documents: AssetDocumentSummary[];
  createdAt: string;
}

/**
 * AMI VISSZATARTJA A TORLEST, TETELESEN. Harom kulon szamlalo, nem egy logikai
 * ertek: a hivo igy meg tudja mondani, MI tartja vissza, es mindharom agra kulon
 * allitas irhato.
 */
export interface AssetDeletionBlockers {
  serviceJobs: number;
  worksheetLines: number;
  childAssets: number;
}

export interface AssetListResponse {
  items: AssetListItem[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
  /**
   * ALLAPOTONKENTI DARABSZAM, A LISTA SAJAT VALASZAN.
   *
   * MIERT ITT, ES NEM KULON VEGPONTON: a szamok es a lista UGYANARROL a
   * halmazrol szolnak, es ha ket hivasbol jonnenek, a ketto elcsuszhatna --
   * a felulet a talalatok folott mas szamot mutatna, mint ami alattuk all.
   * Egy valasz, egy pillanat.
   *
   * MINDEN ALLAPOT SZEREPEL, A NULLAS IS: egy hianyzo kulcs a kliensen
   * pontosan ugy nez ki, mint a nulla, csak eppen nem az.
   */
  counts: Record<AssetStatus, number>;
}

export interface CreateAssetInput {
  ownerType: AssetOwnerType;
  ownerId: string;
  customerAddressId?: string;
  /** A partner ALEGYSÉGE. Csak szerviz partner tulajdonosnál. */
  departmentId?: string;
  aquariumId?: string;
  parentAssetId?: string;
  productVariantId?: string;
  kind: AssetKind;
  status?: AssetStatus;
  criticality?: AssetCriticality;
  name: string;
  /**
   * A FELVITEL MOSTANTOL AZONOSITOT KULD, NEM SZOVEGET.
   *
   * A szoveges alak 110 eszkozon tiz erteket szult, hat helyett. A mezo neve
   * ezert is valtozik: egy `category?: string` mezo, ami valojaban azonositot
   * var, pontosan az a fajta csendes felrevezetes, amit ez a munka megszuntet.
   */
  categoryId?: string | null;
  manufacturer?: string;
  model?: string;
  serialNumber?: string;
  inventoryNumber?: string;
  description?: string;
  installedAt?: string;
  purchasedAt?: string;
  warrantyExpiresAt?: string;
  serviceIntervalDays?: number;
  lastServicedAt?: string;
  nextServiceAt?: string;
  notes?: string;
  /**
   * AZ ELŐRE NYOMTATOTT MATRICA KÓDJA, ha a szerelő a helyszínen beolvasta.
   *
   * Nem generálunk újat: egy MÁR KIADOTT kódot kötünk az eszközhöz. Ha a kód
   * nem létezik a készletben, vagy már máson áll, a felvitel ELUTASÍT -- nem
   * hozza létre az eszközt matrica nélkül. Az ok a `42056ab0` kártyán áll: egy
   * csendben eldobott kód után a szerelő abban a hitben megy tovább, hogy a
   * matrica hozzá van rendelve.
   */
  labelCode?: string;
  /**
   * A TELJESÍTMÉNY ÉS A MÉRTÉKEGYSÉGE -- A KETTŐ EGYÜTT MEGY, VAGY EGYIK SEM.
   *
   * Egy „500" mértékegység nélkül nem adat, hanem találgatásra hívás (watt?
   * liter per óra?), a fordítottja ugyanígy. A megkötés a TÁBLÁN áll
   * (`Asset_performance_pairing_check`), tehát nem lehet megkerülni egy új
   * végponttal vagy egy háttéranyaggal -- a típus itt csak KIMONDJA.
   */
  performance?: string;
  performanceUnitId?: string;
}

export interface UpdateAssetInput {
  ownerType?: AssetOwnerType;
  ownerId?: string;
  customerAddressId?: string | null;
  /** `null` törli a kötést, a mező elhagyása érintetlenül hagyja. */
  departmentId?: string | null;
  aquariumId?: string | null;
  parentAssetId?: string | null;
  productVariantId?: string | null;
  kind?: AssetKind;
  status?: AssetStatus;
  criticality?: AssetCriticality;
  name?: string;
  /**
   * A KATEGORIA HIVATKOZAS, NEM SZOVEG. `null` torli a kotest, a mezo
   * elhagyasa erintetlenul hagyja -- ugyanaz az alak, mint a szomszedos
   * koteseknel.
   */
  categoryId?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  inventoryNumber?: string | null;
  description?: string | null;
  installedAt?: string | null;
  purchasedAt?: string | null;
  warrantyExpiresAt?: string | null;
  serviceIntervalDays?: number | null;
  lastServicedAt?: string | null;
  nextServiceAt?: string | null;
  notes?: string | null;
  expectedUpdatedAt: string;
  /**
   * AZ ELORE NYOMTATOTT MATRICA KODJA, UTOLAG IS.
   *
   * ES ITT NINCS `| null`, holott a tobbi mezon ott van -- nem feledekenysegbol:
   * a szerver `UpdateAssetDto`-ja is `string`-et var. A matrica LESZEDESE ma
   * nem letezik (az esemeny-naploban nincs neve, lasd a szerver oldali
   * dontest), tehat egy `null` 400-zal bukna el. A tipus igy MAR ITT
   * megmondja, ami a szerveren is all.
   */
  labelCode?: string;
  /**
   * ÉS ITT VAN `| null`, A `labelCode`-dal ELLENTÉTBEN -- a két ellentétes alak
   * ugyanabból a szabályból jön: a `null` TÖRLÉST jelent, és a teljesítménynél
   * a törlés LÉTEZIK (a matricánál nem).
   *
   * A PÁRT FRISSÍTÉSKOR AZ EREDMÉNY DÖNTI EL, NEM A BEKÜLDÖTT MEZŐ. Ha az
   * egység már áll az eszközön, a szám EGYEDÜL is átírható; a törléshez
   * viszont mind a kettőt `null`-ra kell állítani, mert egy fél pár a táblán
   * sem állhat meg.
   */
  performance?: string | null;
  performanceUnitId?: string | null;
}

export interface AssetQrCode {
  assetId: string;
  assetNumber: string;
  value: string;
  svg: string;
  labelSizeMm: 30;
}
