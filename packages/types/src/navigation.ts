import {
  hasPermission,
  PERMISSIONS,
  type Permission,
  type UserRole,
} from "./auth.js";

/**
 * A MENÜ EGY FORRÁSBÓL. Mit lát egy szerep, és hol.
 *
 * A MÉRÉS, AMIÉRT LÉTREJÖTT (2026-09-02): a menü két helyen állt, két külön
 * névkészlettel. A weben 26 oldal egy kódba írt tömbben, tételenként egy
 * jogosultsági kulccsal; a telefonon 7 csempe, három különböző módon kapuzva
 * (tükrözött képesség-táblák `assetsView` néven ott, `service.view` néven a
 * szerveren; egy szerep-lista; és a "látszik-e" külön a "megnyitható-e"-től).
 * Ebből jött a korlát, amit ez feloldani készül: a telefon menüjének
 * megváltoztatása kódváltozás, tehát új bolti kiadás, míg a weben egy sor.
 *
 * ÉS EGY MÁSODIK, UGYANAZNAP MÉRT ELCSÚSZÁS, AMI NEM A TELEFONRÓL SZÓL: a
 * webes keret és a felhasználó-szerkesztő "mely oldalakat éri el ez a szerep"
 * előnézete KÉT KÜLÖN listát fűzött össze, és el is csúsztak. Az előnézet
 * kihagyta a Tartalom oldalt, és duplán sorolta a két szerviz-menüpontot.
 * Egy forrás mellett ez nem "javítva lett", hanem nem tud előállni.
 *
 * AMIT EZ A FÁJL NEM ÍR LE: a megjelenést (felirat, ikon, sorrend, a telefon
 * csempe-kódja és leírása). Az felületenként más, és jól van így. Ami itt áll,
 * az az AZONOSSÁG és a LÁTHATÓSÁGI SZABÁLY -- a két dolog, ami eddig két
 * helyen élt, és ezért csúszott.
 */

export type NavigationSurface = "web" | "mobile";

/**
 * KÉT SZABÁLY-FAJTA VAN, ÉS A MÁSODIK LEJÁRATTAL ÉRKEZIK.
 *
 * A `permission` az általános eset: ma mind a 26 webes oldal és a 7 csempéből
 * 6 pontosan egy jogon áll (mérve).
 *
 * JOG-HALMAZ (bármelyik/mindegyik) SZÁNDÉKOSAN NINCS. Ma egyetlen tétel sem
 * kéri, és előrelátást nem építünk oda, ahol a mérés azt mondja, hogy senki nem
 * kéri. Ami ezt olcsóvá teszi: a bővítés visszafelé kompatibilis -- egy jogból
 * bármikor lehet egyelemű halmaz úgy, hogy a régi alak értelmezése megmarad.
 */
export type NavigationVisibility =
  | { readonly kind: "permission"; readonly permission: Permission }
  | {
      readonly kind: "roles";
      readonly roles: readonly UserRole[];
      /**
       * MI SZÜNTETI MEG EZT AZ ÁGAT. Feltétel, nem határidő, és KÖTELEZŐ mező.
       *
       * Egy második szabály-fajta, amit senki nem köt feltételhez, örökre
       * ottmarad, és a következő olvasó tervezett képességnek fogja olvasni.
       * Azért mező és nem komment, mert egy komment elavul anélkül, hogy bárki
       * észrevenné -- ezt viszont ki kell tölteni ahhoz, hogy a fordító
       * átengedje. (Ugyanaz az elv, mint a `scripts/unas.sh` kötelező
       * `--approval` mezőjénél: a hívónak meg kell neveznie, mire hivatkozik.)
       */
      readonly retiredBy: string;
    };

export interface NavigationEntry {
  /**
   * ÁLLANDÓ KULCS, ÉS SZÁNDÉKOSAN NEM AZ ÚTVONAL. Az útvonal a megjelenés
   * része és változhat; erre az azonosítóra viszont a telefon a saját
   * képernyőit képezi le, és egy beállítás-felület is ezt fogja tárolni.
   */
  readonly id: string;
  readonly surfaces: readonly NavigationSurface[];
  readonly visibility: NavigationVisibility;
}

const permission = (value: Permission): NavigationVisibility => ({
  kind: "permission",
  permission: value,
});

/**
 * A NAV-CSEMPE AZ EGYETLEN SZEREP-LISTÁS TÉTEL, ÉS KÜLÖN ÁLL A WEBES NAV
 * OLDALTÓL, MERT A KÉT SZABÁLY MÉRHETŐEN MÁS (2026-09-02):
 *
 *   a webes /admin/integrations/nav  ->  `settings.manage`  ->  OWNER, ADMIN
 *   a telefon NAV-csempéje           ->  szerep-lista       ->  OWNER, ADMIN,
 *                                                                MANAGER,
 *                                                                WAREHOUSE,
 *                                                                VIEWER
 *
 * Egy tétellé vonni őket VISELKEDÉST VÁLTOZTATNA az egyik felületen, és azt
 * senki nem döntötte el. Ezért két tétel, kiírt indokkal.
 *
 * ÉS AMIÉRT NEM `purchasing.view` LETT, HOLOTT MA UGYANAZT ADNÁ: a mai
 * szerep-lista PONTOSAN azoké, akiknek `purchasing.view` joguk van -- a két
 * szabály ma egybeesik, de nem ugyanaz. Ha valaki később ad `purchasing.view`
 * jogot a SALES szerepnek, a jog-alapú alak megmutatná neki a csempét, a mai
 * szabály nem. Egy ilyen eltérés csendben jönne elő, és senki nem kötné egy
 * refaktorhoz.
 */
const NAV_TILE: NavigationEntry = {
  id: "nav-integration-mobile",
  surfaces: ["mobile"],
  visibility: {
    kind: "roles",
    roles: ["OWNER", "ADMIN", "MANAGER", "WAREHOUSE", "VIEWER"],
    retiredBy:
      "Az a kimondott döntés, hogy a NAV-csempe joga `purchasing.view` legyen. " +
      "Ma nincs értelme megkérdezni: a csempe nem nyitható meg (enabled=false), " +
      "és egy nem nyitható csempe láthatóságáról dönteni ugyanaz a hiba lenne, " +
      "mint egy üres oldalhoz jogosultsági szabályt tervezni. Amikor a funkció " +
      "épül, a szabály BELE kerül, és ez az ág tárgytalanná válik.",
  },
};

export const NAVIGATION_ENTRIES: readonly NavigationEntry[] = [
  {
    id: "dashboard",
    surfaces: ["web"],
    visibility: permission(PERMISSIONS.DASHBOARD_VIEW),
  },
  {
    id: "my-tasks",
    surfaces: ["web"],
    visibility: permission(PERMISSIONS.TASKS_VIEW),
  },
  {
    /**
     * A HIBAJEGY A LANC ELSO ELEME (hibajegy, munkalap, teljesitesi igazolas,
     * szamla), ezert all a munkalap ELOTT.
     *
     * CSAK `web`, HOLOTT A SZOMSZEDJAI `mobile`-ON IS ALLNAK, es ez MERESEN
     * all, nem ovatossagbol.
     *
     * A ket felulet NEM szimmetrikus: ELREJTENI egy csempet uj kiadas nelkul is
     * lehet, MEGMUTATNI viszont csak azt, amit a TELEPITETT alkalmazas mar
     * ismer (murena felmerese, 2026-09-02).
     *
     * ES A #355 UTAN PONTOSABBAN TUDJUK, MI TORTENNE, ezert all itt ez a
     * mondat a "nem nyilo csempe" helyett: a telefon KEZZEL IRT tablabol
     * kepezi a csempe-kodjait a menutetelekre (`TILE_ENTRY`,
     * `apps/mobile/src/lib/auth/tile-visibility.ts`), es abban ma NINCS
     * `service-jobs`. Merve az aktualis fo agon: nulla talalat a mobil faban.
     *
     * Vagyis a `mobile` felvetele NEM torott csempet adna, hanem SEMMIT - egy
     * deklaracio, ami telefon-csempet iger es nem csinal semmit, es errol senki
     * nem tudna. Ez a rosszabb fajta: a torott csempe HANGOS, a nem letezo NEMA.
     *
     * MI NYITJA MEG: a hibajegy-kepernyo elkeszulte a mobil alkalmazasban.
     * Akkor ez a sor bovul, es a dontes kulon megy Balazs ele, hogy ne
     * ketszer dontse el ugyanazt.
     */
    id: "service-jobs",
    /**
     * A MOBIL 2026-09-16-TOL, es ezt a sor folotti megjegyzes maga jelolte ki:
     * "a hibajegy-kepernyo elkeszulte a mobil alkalmazasban. Akkor ez a sor
     * bovul." A kepernyo elkeszult, tehat a sor bovul.
     *
     * A CSEMPE UGYANEBBEN A KORBEN KERULT BE (`TILE_ENTRY.HJ`). Kulon-kulon
     * egyik sem csinal semmit: e nelkul a sor nelkul a csempe rejtve maradna,
     * a csempe nelkul pedig ez a sor egy nem letezo belepesi pontot engedne.
     * A fel megoldas NEMA -- ezert megy a ketto egyutt.
     */
    surfaces: ["web", "mobile"],
    visibility: permission(PERMISSIONS.SERVICE_VIEW),
  },
  {
    id: "worksheets",
    surfaces: ["web", "mobile"],
    visibility: permission(PERMISSIONS.SERVICE_VIEW),
  },
  {
    id: "service-assets",
    surfaces: ["web", "mobile"],
    visibility: permission(PERMISSIONS.SERVICE_VIEW),
  },
  {
    /**
     * A BESZERZO SAJAT LISTAJA -- "RAM VARO ANYAGIGENYEK".
     *
     * A `SERVICE_MANAGE` csak azt engedi meg, hogy egyaltalan lassa a MENUPONTOT
     * -- hogy a lista TARTALMAT is latja-e, azt a szerver donti el a
     * `MATERIAL_REQUEST_MARK_RECEIVED` kepesseg alapjan (per-felhasznalo
     * jelolo, nem szerep). Ez a rendszer ma csak `permission`/`roles` alapu
     * lathatosagot ismer, egy per-felhasznalo kepesseget nem -- ezert a menu
     * DURVAN szur (barki, aki munkalapra irhat, latja a menupontot), a lap
     * viszont finoman (csak a kepesseggel rendelkezo lat adatot, masok
     * ertelmezheto uzenetet kapnak). Lasd `MaterialRequestsService.listPending`.
     */
    id: "material-requests-pending",
    /**
     * `mobile` HOZZAADVA 2026-09-23-AN, A MOBIL SZELETTEL EGYUTT. A menu-
     * szintu durva kapu (SERVICE_MANAGE) es a lap-szintu finom kapu
     * (MATERIAL_REQUEST_MARK_RECEIVED, per-felhasznalo) ugyanugy ket
     * retegben all a telefonon, mint a weben -- lasd a lenti fejlecet.
     */
    surfaces: ["web", "mobile"],
    visibility: permission(PERMISSIONS.SERVICE_MANAGE),
  },
  {
    id: "content",
    surfaces: ["web"],
    visibility: permission(PERMISSIONS.CONTENT_VIEW),
  },
  {
    id: "pos",
    surfaces: ["web"],
    visibility: permission(PERMISSIONS.ORDERS_VIEW),
  },
  {
    id: "webshop-orders",
    surfaces: ["web", "mobile"],
    visibility: permission(PERMISSIONS.ORDERS_VIEW),
  },
  {
    id: "webshop-customers",
    surfaces: ["web"],
    visibility: permission(PERMISSIONS.CUSTOMERS_VIEW),
  },
  {
    id: "webshop-products",
    surfaces: ["web"],
    visibility: permission(PERMISSIONS.PRODUCTS_VIEW),
  },
  {
    id: "products",
    surfaces: ["web", "mobile"],
    visibility: permission(PERMISSIONS.PRODUCTS_VIEW),
  },
  {
    id: "partners",
    surfaces: ["web", "mobile"],
    visibility: permission(PERMISSIONS.PARTNERS_VIEW),
  },
  {
    id: "purchasing",
    surfaces: ["web", "mobile"],
    visibility: permission(PERMISSIONS.PURCHASING_VIEW),
  },
  {
    id: "nav-invoices",
    surfaces: ["web"],
    visibility: permission(PERMISSIONS.PURCHASING_VIEW),
  },
  {
    id: "foxpost-settlement",
    surfaces: ["web"],
    visibility: permission(PERMISSIONS.FINANCE_VIEW),
  },
  {
    id: "inventory",
    surfaces: ["web"],
    visibility: permission(PERMISSIONS.INVENTORY_VIEW),
  },
  {
    id: "inventory-reconciliation",
    surfaces: ["web"],
    visibility: permission(PERMISSIONS.INVENTORY_VIEW),
  },
  {
    /**
     * A kimenosor OLVASASA `inventory.view`, ugyanaz, mint a szomszedjaie. A
     * ket admin muvelet (ujra sorba allitas, azonnali futtatas) `inventory.manage`
     * jogot igenyel a vegponton -- a menupont attol meg lathato marad, mert a
     * lapon az ALLAPOT a lenyeg, es azt egy view-jogu felhasznalonak is latnia
     * kell.
     */
    id: "stock-sync-outbox",
    surfaces: ["web"],
    visibility: permission(PERMISSIONS.INVENTORY_VIEW),
  },
  {
    id: "aquariums",
    // MOBIL FELULET 2026-09-24-TOL (Balazs kerese, brief:
    // exchange/akvariumok-1-kor-brief-2026-09-24.md, 13:01-es kiegeszites:
    // "helyben felveheto weben es appban is"). A web-only allapot csak
    // annyiban maradt volna igaz, hogy a telefonos kepernyo meg nem letezett
    // -- most letezik.
    surfaces: ["web", "mobile"],
    visibility: permission(PERMISSIONS.AQUARIUMS_VIEW),
  },
  {
    id: "icp",
    surfaces: ["web"],
    visibility: permission(PERMISSIONS.ICP_VIEW),
  },
  {
    id: "unas-connection",
    surfaces: ["web"],
    visibility: permission(PERMISSIONS.SETTINGS_MANAGE),
  },
  {
    id: "unas-sync",
    surfaces: ["web"],
    visibility: permission(PERMISSIONS.PRODUCTS_VIEW),
  },
  {
    id: "ai-test",
    surfaces: ["web"],
    visibility: permission(PERMISSIONS.AI_TEST_VIEW),
  },
  {
    id: "brands",
    surfaces: ["web"],
    visibility: permission(PERMISSIONS.PRODUCTS_VIEW),
  },
  {
    id: "settings-general",
    surfaces: ["web"],
    visibility: permission(PERMISSIONS.SETTINGS_MANAGE),
  },
  {
    id: "nav-integration",
    surfaces: ["web"],
    visibility: permission(PERMISSIONS.SETTINGS_MANAGE),
  },
  {
    id: "medusa-connection",
    surfaces: ["web"],
    visibility: permission(PERMISSIONS.SETTINGS_MANAGE),
  },
  {
    id: "users",
    surfaces: ["web"],
    visibility: permission(PERMISSIONS.USERS_MANAGE),
  },
  {
    /**
     * MATRICAKODOK KIADASA ES NYOMTATASA.
     *
     * A SZERVIZES NEM LATJA. Balazs dontese, 2026-09-02 21:00:53, Discord
     * (matricas szal), szo szerint: "Nem kell hogy lassa".
     *
     * A JOG EZERT `SETTINGS_MANAGE`, nem `SERVICE_MANAGE` -- ugyanaz, ami a
     * tobbi Beallitasok-tetelt kapuzza, amit a szervizes nem lat (Altalanos,
     * NAV, Medusa kapcsolat). Merve: mind a harom `SETTINGS_MANAGE` alatt all,
     * es azt csak az OWNER es az ADMIN kapja meg (a MANAGER-t a
     * ROLE_PERMISSIONS kifejezetten kiszuri).
     *
     * ES A VEGPONTOK UGYANEZT KAPJAK. Ha a menupont es a vegpont KULON jogon
     * allna, a ketto szetcsuszna: vagy latszana a gomb annak, aki nem hivhatja
     * meg, vagy hivhatna az, aki nem latja. Ez a mai napunk fo lelete volt --
     * egy szabaly ket helyen, es csak az egyik helyen javul.
     */
    id: "asset-labels",
    surfaces: ["web"],
    visibility: permission(PERMISSIONS.SETTINGS_MANAGE),
  },
  {
    /**
     * A MÉRTÉKEGYSÉGEK KARBANTARTÁSA.
     *
     * A JOG `SETTINGS_MANAGE`, nem `SERVICE_MANAGE` -- ez törzsadat-gondozás,
     * ugyanaz a fajta, mint a matricakiadás. A szerelő HASZNÁLJA a listát (az
     * eszköz-szerkesztő legördülője `SERVICE_VIEW` alatt olvassa), de nem
     * ÍRJA: ha bárki felvihetne egységet, a lista három nap alatt ötféle
     * „óra" változatot tartalmazna.
     *
     * A MENÜPONT ÉS A VÉGPONT UGYANAZT A JOGOT KAPJA. Ha kettévállnának, vagy
     * látszana a gomb annak, aki nem hívhatja meg, vagy hívhatná az, aki nem
     * látja -- és a kettő közül csak az első hangos.
     */
    id: "units-of-measure",
    surfaces: ["web"],
    visibility: permission(PERMISSIONS.SETTINGS_MANAGE),
  },
  {
    /**
     * AZ ESZKOZ-KATEGORIAK KARBANTARTASA.
     *
     * UGYANAZ A JOG, mint a mertekegysegnel, es ugyanabbol az okbol: ha barki
     * felvihetne kategoriat, pont az allna vissza, ami miatt a lista
     * letrejott -- 110 eszkozon tiz ertek hat helyett, negy elgepelessel.
     *
     * A MENUPONT ES A VEGPONT UGYANAZT A JOGOT KAPJA: kettevalva vagy latszik
     * a gomb annak, aki nem hivhatja, vagy hivhatja az, aki nem latja -- es a
     * ketto kozul csak az elso hangos.
     */
    id: "asset-categories",
    surfaces: ["web"],
    visibility: permission(PERMISSIONS.SETTINGS_MANAGE),
  },
  {
    /**
     * AZ ESZKOZ-FUNKCIOK KARBANTARTASA.
     *
     * Balazs kerese, 2026-09-22 (kanban 68add892): „ugyanolyan menut [...]
     * mint az Eszkoz kategoriak, csak Eszkoz-funkciok nevvel". UGYANAZ A JOG
     * es ugyanaz az okbol, mint a kategorianal: ha barki felvihetne funkciot
     * a Beallitasok lapjan kivul, a lista ugyanugy szetesne.
     *
     * FUGGETLEN AZ ASSET-CATEGORIES-TOL: ket kulon torzsadat, nincs kozottuk
     * kapcsolat.
     */
    id: "asset-functions",
    surfaces: ["web"],
    visibility: permission(PERMISSIONS.SETTINGS_MANAGE),
  },
  NAV_TILE,
];

const BY_ID = new Map(NAVIGATION_ENTRIES.map((entry) => [entry.id, entry]));

export function navigationEntry(id: string): NavigationEntry | undefined {
  return BY_ID.get(id);
}

/**
 * LÁTJA-E EZ A SZEREP.
 *
 * ISMERETLEN AZONOSÍTÓRA `false`, ÉS EZ NEM AZ ALAPÉRTELMEZÉS MEGKERÜLÉSE. Az
 * "új oldal alapértelmezetten látszik" szabály arról szól, hogy a menü-ADAT
 * hiánya ne rejtsen el semmit -- ott a jog dönt. Itt viszont a KÉRDÉS
 * értelmetlen: egy azonosító, ami nincs a forrásban, nem egy tétel, amiről
 * nincs adat, hanem egyáltalán nem tétel. Igazat adni rá annyi lenne, mint egy
 * elgépelt azonosítót mindenkinek megmutatni.
 */
export function isNavigationEntryVisible(id: string, role: UserRole): boolean {
  const entry = BY_ID.get(id);
  if (!entry) return false;
  const rule = entry.visibility;
  return rule.kind === "roles"
    ? rule.roles.includes(role)
    : hasPermission(role, rule.permission);
}

export function navigationIdsFor(
  role: UserRole,
  surface: NavigationSurface,
): string[] {
  return NAVIGATION_ENTRIES.filter(
    (entry) =>
      entry.surfaces.includes(surface) &&
      isNavigationEntryVisible(entry.id, role),
  ).map((entry) => entry.id);
}

/**
 * A KIADOTT ALAK: EGY TETEL UGY, AHOGY A SZERVER ATADJA A KLIENSNEK.
 *
 * MIERT AZ AZONOSITO ES A FELULET, ES MIERT NEM CSAK EGY AZONOSITO-LISTA: egy
 * puszta lista mellett a kliens nem tudja megkulonboztetni azt, hogy egy
 * azonositot NEM ISMER (regebbi telepites, ujabb szerver), attol, hogy az a
 * MASIK feluletre valo. A ket eset ugyanugy "hagyd ki" -- de az elso egy
 * verzio-csuszas, ami elobb-utobb kiadast igenyel, a masodik pedig a normal
 * mukodes. Egy naplosorban ez a kulonbseg minden.
 */
export interface NavigationEntryView {
  readonly id: string;
  readonly surfaces: readonly NavigationSurface[];
}

/**
 * AMIT EGY SZEREP LATHAT, MINDKET FELULETEN, A KIADASHOZ.
 *
 * A SZURES ITT TORTENIK, EGYSZER. Ha a szerver a valasz osszeallitasakor
 * ujra eldontene, ki mit lat, ket forras keletkezne megint -- csak egy
 * szinttel feljebb, es a ket oldal elterese eppolyan nema lenne, mint amilyen
 * a webes es a mobil tabla kozott volt.
 */
export function visibleNavigationFor(role: UserRole): NavigationEntryView[] {
  return NAVIGATION_ENTRIES.filter((entry) =>
    isNavigationEntryVisible(entry.id, role),
  ).map((entry) => ({ id: entry.id, surfaces: entry.surfaces }));
}
