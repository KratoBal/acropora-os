import type { IconName } from "@acropora/ui";

export interface AppNavigationItem {
  href: string;
  label: string;
  icon: IconName;
  /**
   * A KOZOS FORRAS TETELE (`@acropora/types` NAVIGATION_ENTRIES).
   *
   * KORABBAN ITT EGY JOGOSULTSAGI KULCS ALLT, es ez volt a ket felulet
   * elcsuszasanak a helye: a telefon ugyanezt a dontest a sajat tablaiban
   * tartotta, mas nevekkel. A lathatosagi szabaly mostantol EGY helyen all, itt
   * csak a MEGJELENES (utvonal, felirat, ikon) marad -- az felületenkent
   * kulonbozik, es jol van igy.
   *
   * Az azonosito nem az utvonal: az utvonal valtozhat, erre viszont a telefon a
   * sajat kepernyoit kepezi le.
   */
  entryId: string;
  exact?: boolean;
  /**
   * TOVÁBBI ÚTVONALAK, amiken a menüpont aktív. Az Elszámolások egy
   * gyűjtő-útvonalra visz, de a három fül a saját, régi útvonalán él
   * (könyvjelzők, levélben küldött linkek), és ott is az Elszámolások a
   * jelenlegi menüpont.
   */
  alsoActiveOn?: string[];
  /**
   * AZ ALCSOPORT FELIRATA a menücsoporton belül (csak a Beállításoknál): az
   * egymás utáni, azonos feliratú tételek egy kis címsor alá kerülnek. Csak
   * megjelenés: a jogosultság, az útvonal és a láthatóság nem függ tőle, és a
   * lista lapos marad (`navigationItems` ugyanúgy nyitja ki).
   */
  subgroup?: string;
}

/**
 * A menu heading that opens to reveal its own pages.
 *
 * A group carries no `href` on purpose: its heading opens and closes the
 * group, and a heading that both navigated and toggled would do one of the
 * two by accident on every click. Everything reachable is a child.
 *
 * Permission lives on the children, not here. A group is shown when at least
 * one of its children is, which keeps the rule in one place: if somebody may
 * not see any page under a heading, the heading is not there either.
 */
export interface AppNavigationGroup {
  label: string;
  icon: IconName;
  children: AppNavigationItem[];
  /**
   * With exactly one visible child, draw that child as a plain item instead
   * of a heading over a single page. Set where the group exists only for a
   * switch-gated page: while the switch is off, the menu looks as before.
   */
  flattenWhenAlone?: boolean;
  /** Alapból nyitva áll (az Áttekintés: a számlálói ott élnek). */
  defaultOpen?: boolean;
  /** Elválasztó vonal a csoport fölött (a Beállítások, a lista végén). */
  separated?: boolean;
}

export type AppNavigationEntry = AppNavigationItem | AppNavigationGroup;

export function isNavigationGroup(
  entry: AppNavigationEntry,
): entry is AppNavigationGroup {
  return "children" in entry;
}

/**
 * Every page in a list, with the groups opened out.
 *
 * Anything that asks "which pages are there" wants this rather than the raw
 * list: a group is a heading, it has no `href` and no permission of its own,
 * so counting it as a page would leave the pages underneath it uncounted. The
 * user editor's permission preview is the one that would have gone quiet.
 */
export function navigationItems(
  entries: AppNavigationEntry[],
): AppNavigationItem[] {
  return entries.flatMap((entry) =>
    isNavigationGroup(entry) ? entry.children : [entry],
  );
}

/** Az Elszámolások gyűjtő-útvonala: az első olyan fülre visz, amihez van jog. */
/** A Hiányzó számlák hónaplistája; egy hónap: `${MISSING_INVOICES_PATH}/2026-08`. */
export const MISSING_INVOICES_PATH = "/penzugy/hianyzo-szamlak";

export const SETTLEMENTS_PATH = "/penzugy/elszamolasok";

/** A katalógus adatminőség-nézete (JEV 5. fázis, Figma 394:316). */
export const PRODUCT_DATA_QUALITY_PATH = "/products/adatminoseg";

/**
 * AZ ELSZÁMOLÁSOK FÜLEI. Az útvonalak a régiek maradtak (könyvjelzők, levélben
 * küldött linkek); az `entryId` a fül saját láthatósági szabálya.
 */
export const SETTLEMENT_TABS: ReadonlyArray<{
  href: string;
  label: string;
  entryId: string;
}> = [
  { href: "/penzugy/foxpost", label: "Foxpost", entryId: "foxpost-settlement" },
  { href: "/penzugy/gls", label: "GLS", entryId: "gls-settlement" },
  {
    // Balázs, 2026-09-30: "kellene egy simple pay kimutatás is mint a
    // foxpostnál és a gls-nél"
    href: "/penzugy/simplepay",
    label: "SimplePay",
    entryId: "simplepay-settlement",
  },
];

/**
 * A KUTATÁSI TUDÁSTÁR (S4). A menüpont a modul kezdőlapjára, az Áttekintőre
 * (Figma 3:2) visz; az alatta álló oldalakon is aktív. A modul fülei a
 * `knowledge-base/knowledge-base-tabs.tsx` sorában állnak, csak a kész
 * képernyők (holt link nincs).
 */
export const KNOWLEDGE_BASE_PATH = "/tudasbazis";
export const KNOWLEDGE_SOURCES_PATH = "/tudasbazis/forrasok";
export const KNOWLEDGE_CLAIMS_PATH = "/tudasbazis/kiolvasas";
export const KNOWLEDGE_VOCABULARY_PATH = "/tudasbazis/szotar";
export const KNOWLEDGE_STORE_PATH = "/tudasbazis/allitasok";

/*
  A KILENC FŐMENÜ (Balázs, 2026-10-26 16:48 UTC, "mehet", Acropora OS szál, msg
  1564319716133314735; feladat os-menu-kilenc-fomenu). EGY LISTA, EGY HELYEN:
  eddig a menü öt külön tömbből állt össze (primary, business, content,
  secondary, settings), és a keret kézzel fűzte őket össze.

  A JOGOSULTSÁG NEM VÁLTOZIK, csak a hely és a sorrend: minden menüpont a saját
  `entryId`-ját és útvonalát viszi, és a láthatóságát a közös forrás
  (`NAVIGATION_ENTRIES`) adja. Egy oldal pontosan egy helyen áll. Amit ez a
  lista tart, azt a `navigation.component.test.ts` rögzíti: a halmaz
  (útvonal, azonosító, felirat) a költözés előttivel megegyezik, a csoportok
  és a sorrend pedig Balázs listája.
*/
export const mainNavigation: AppNavigationGroup[] = [
  {
    // Az első menü alapból nyitva: a feladatok és az olvasatlan üzenetek
    // számlálója itt él, és egy összecsukott fejléc elrejtené.
    label: "Áttekintés",
    icon: "dashboard",
    defaultOpen: true,
    children: [
      {
        href: "/",
        label: "Dashboard",
        icon: "dashboard",
        entryId: "dashboard",
      },
      {
        href: "/feladataim",
        label: "Feladataim",
        icon: "clipboard",
        entryId: "my-tasks",
      },
      {
        href: "/uzenetek",
        label: "Üzenetek",
        icon: "message",
        entryId: "messages",
      },
    ],
  },
  {
    // Service was already a group on screen, wired by hand in the shell. The
    // QR-code printing page moved here from Beállítások (Balázs's list); its
    // entry, path and visibility (`settings.manage`: the service role does not
    // see it, "Nem kell hogy lássa", 2026-09-02 21:00:53) did not change.
    label: "Szerviz",
    icon: "service",
    children: [
      {
        // A LANC SORRENDJE, nem a felvetel sorrendje: hibajegy, munkalap,
        // teljesitesi igazolas, szamla (Balazs, 2026-09-02 08:08).
        href: "/szerviz/hibajegyek",
        label: "Hibajegyek",
        icon: "clipboard",
        entryId: "service-jobs",
      },
      {
        href: "/szerviz/munkalapok",
        label: "Munkalapok",
        icon: "clipboard",
        entryId: "worksheets",
      },
      {
        href: "/szerviz/karbantartas",
        label: "Karbantartás",
        icon: "clipboard",
        entryId: "maintenance",
      },
      {
        href: "/szerviz/piszkozatok",
        label: "Piszkozatok",
        icon: "clipboard",
        entryId: "service-drafts",
      },
      {
        href: "/szerviz/anyagigenyek",
        label: "Anyagigények",
        icon: "clipboard",
        entryId: "material-requests-pending",
      },
      {
        href: "/szerviz/eszkozok",
        label: "Eszköznyilvántartás",
        icon: "box",
        entryId: "service-assets",
      },
      {
        /**
         * A SOR VEGEN, mint a Beallitasokban volt: nem kulso rendszer kulcsa es
         * nem jogosultsag-kezeles, hanem sajat, uzemeltetesi tetel. A lathatosag
         * a kozos forrasban all (`asset-labels`), `SETTINGS_MANAGE` alatt.
         */
        href: "/beallitasok/matricak",
        label: "QR-kód nyomtatás",
        icon: "settings",
        entryId: "asset-labels",
      },
    ],
  },
  {
    label: "Értékesítés",
    icon: "credit-card",
    children: [
      {
        href: "/pos",
        label: "POS",
        icon: "credit-card",
        entryId: "pos",
      },
      {
        // Árajánlatok (#1582 P1): a Pénzügyből költözött ide (Balázs, 2026-10-26);
        // a `quotes` kapcsoló mögött, alapból rejtve.
        href: "/ajanlatok",
        label: "Árajánlatok",
        icon: "file-text",
        entryId: "quotes",
      },
      {
        href: "/partnerek",
        label: "Partnerek",
        icon: "truck",
        entryId: "partners",
      },
      {
        href: "/partnerek/szerzodesek",
        label: "Szerződések",
        icon: "clipboard",
        entryId: "contracts",
      },
    ],
  },
  {
    label: "Webshop",
    icon: "store",
    children: [
      {
        // The page behind /webshop is the order list, and that is what it is
        // called here. "Webshop" is the heading above it now.
        href: "/webshop",
        // Balázs, 2026-10-05 11:31 UTC: a mai lista UNAS-adat, csak megtekintő;
        // az új bolt rendeléseitől így különül el. Az útvonal nem változik.
        label: "UNAS Megrendelések",
        icon: "cart",
        entryId: "webshop-orders",
      },
      {
        // Balázs, 2026-10-05: az új webshop rendelései (Medusa), feldolgozás,
        // számlázás és feladás egy helyen. A UNAS lista mellette változatlan.
        href: "/webshop/rendelesek",
        label: "Rendelések",
        icon: "cart",
        entryId: "webshop-medusa-orders",
      },
      {
        href: "/vevok",
        label: "Vevők",
        icon: "users",
        entryId: "webshop-customers",
      },
      {
        // The shop's own view of the catalogue. The full internal catalogue,
        // with the barcode editor, stays at /products under "Termékek".
        href: "/webshop/termekek",
        label: "Termékek a webshopban",
        icon: "package",
        entryId: "webshop-products",
      },
      /*
        MINDEN WEBSHOP-MENÜ EGY HELYEN (Balázs, 2026-10-26 13:05 UTC, msg
        1564263673932026020; acrobot döntése): a kezdőlap, a válogatások és a
        márkák is ide kerültek, a láthatóságuk a mai bejegyzéseké maradt.
      */
      {
        href: "/admin/kezdolap",
        label: "Kezdőlap",
        icon: "store",
        entryId: "homepage-content",
      },
      {
        href: "/admin/valogatasok",
        label: "Válogatások",
        icon: "package",
        entryId: "brands",
      },
      {
        href: "/admin/brands",
        label: "Márkák",
        icon: "package",
        entryId: "brands",
      },
      {
        // a gyűjtőoldal: UNAS és Medusa kapcsolat, szinkron, rendelés-
        // elavulás, webshop levélsablonok, kezdőlap
        href: "/webshop/beallitasok",
        label: "Webshop beállítások",
        icon: "settings",
        entryId: "webshop-settings",
        alsoActiveOn: [
          "/admin/integrations/unas",
          "/admin/integrations/medusa/connection",
          "/beallitasok/rendeles-elavulas",
        ],
      },
    ],
  },
  {
    label: "Raktár és beszerzés",
    icon: "warehouse",
    children: [
      {
        href: "/products",
        label: "Termékek",
        icon: "package",
        entryId: "products",
      },
      {
        // JEV 5. fázis: csak ha a szerver kiadja (JEV_PRODUCT_ENRICHMENT nem
        // off, és products.view); a böngésző a változót nem olvassa.
        href: PRODUCT_DATA_QUALITY_PATH,
        label: "Adatminőség",
        icon: "shield",
        entryId: "product-data-quality",
      },
      {
        href: "/beszerzes",
        label: "Beszerzés",
        icon: "cart",
        entryId: "purchasing",
      },
      {
        // Várható beérkezések (Balázs, 2026-09-30): "a Beszerzés alatt".
        href: "/beszerzes/varhato",
        label: "Várható beérkezések",
        icon: "truck",
        entryId: "expected-arrivals",
      },
      {
        href: "/beszerzes/arlistak",
        label: "Beszállítói árlisták",
        icon: "file-text",
        entryId: "price-lists",
      },
      {
        // Ide KÖLTÖZÖTT a korábbi felső szintű "Raktár", és a lap tartalma
        // szerint kapta a nevét: készletleltárak indítása és korrekciója. Az
        // útvonal nem változott, csak a menüben elfoglalt helye és a felirata.
        href: "/raktar",
        label: "Leltár",
        icon: "warehouse",
        entryId: "inventory",
      },
      {
        href: "/keszlet-egyeztetes",
        label: "Készlet-egyeztetés",
        icon: "box",
        entryId: "inventory-reconciliation",
      },
      {
        href: "/keszlet-kimenosor",
        label: "Készlet-kimenősor",
        icon: "box",
        entryId: "stock-sync-outbox",
      },
    ],
  },
  {
    label: "Pénzügy",
    icon: "finance",
    children: [
      {
        // Számlázás (Balázs, 2026-09-30): "a Számlázás menüpont a Pénzügy
        // alá kerül", a lista a /penzugy/szamlazas-on, a bizonylat a
        // /penzugy/szamlazas/:id-n, a vázlat a .../szerkesztes-en.
        href: "/penzugy/szamlazas",
        label: "Számlázás",
        icon: "file-text",
        entryId: "billing",
      },
      {
        href: "/beszerzes/nav-szamlak",
        label: "NAV számla lekérés",
        icon: "download",
        entryId: "nav-invoices",
      },
      {
        // Hiányzó számlák (Balázs briefje, 2026-09-30): az Elszámolások
        // mellett. Egy hónap a /penzugy/hianyzo-szamlak/2026-08 alatt.
        href: MISSING_INVOICES_PATH,
        label: "Hiányzó számlák",
        icon: "alert",
        entryId: "missing-invoices",
      },
      {
        // Balázs, 2026-09-30 15:06 UTC: "Szintén a Pénzügyek alá készüljön
        // egy Elszámolások menüpont. Ez alá kerüljön be a Foxpost a GLS és a
        // Simple Pay elszámolás." A menü két szintű, ezért a három fül a
        // gyűjtő oldalon áll (`SETTLEMENT_TABS`), nem harmadik menüszinten.
        href: SETTLEMENTS_PATH,
        label: "Elszámolások",
        icon: "download",
        entryId: "settlements",
        alsoActiveOn: SETTLEMENT_TABS.map((tab) => tab.href),
      },
    ],
  },
  /*
    AZ AKVARISZTIKA EGY FŐ MENÜ ALATT (Balázs, 2026-10-26 13:09 UTC, msg
    1564264593444839436; a név acrobot munkaneve, ha Balázs mást mond, csak a
    felirat változik): akváriumok, kalkulátorok, ICP, elhullási napló.
  */
  {
    label: "Akvarisztika",
    icon: "aquarium",
    children: [
      {
        href: "/akvariumok",
        label: "Akváriumok",
        icon: "aquarium",
        entryId: "aquariums",
      },
      {
        href: "/kalkulatorok",
        label: "Kalkulátorok",
        icon: "droplet",
        entryId: "calculators",
      },
      {
        href: "/icp",
        label: "ICP",
        icon: "briefcase",
        entryId: "icp",
      },
      {
        href: "/elhullasi-naplo",
        label: "Elhullási napló",
        icon: "fish",
        entryId: "mortality",
      },
    ],
  },
  {
    /**
     * A TARTALOM A SAJÁT FŐMENÜBEN ÁLL, a tudással együtt. A panasz, amiből a
     * Tartalom készült, épp az volt, hogy a dolgok sok felületen keletkeznek, és
     * nem látszik, mi vár kire. A két belső próbafelület (AI teszt, Tudásbázis)
     * ide költözött a korábbi külön blokkból; a jogosultságot ugyanúgy a közös
     * forrás adja (az AI teszt minden szerepkörnek, Balázs döntése, 2026-08-26).
     */
    label: "Tartalom és tudás",
    icon: "file-text",
    children: [
      {
        href: "/tartalom",
        label: "Tartalom",
        icon: "clipboard",
        entryId: "content",
      },
      {
        // belső szerkesztői modul a teszten (S4): a többi belső próbafelület mellett
        href: KNOWLEDGE_BASE_PATH,
        label: "Tudásbázis",
        icon: "file-text",
        entryId: "knowledge-base",
      },
      {
        // Belső próbafelület, nem üzemi oldal. A szűkítés a felhasználói
        // jogosultságok rendezésekor jön.
        href: "/ai-teszt",
        label: "AI teszt",
        icon: "activity",
        entryId: "ai-test",
      },
    ],
  },
  {
    // A Beállítások alcsoportokkal: az `subgroup` felirat a keretben egy kis
    // címsor a tételek fölött; az Általános és a Felhasználók nem tartozik
    // alcsoportba. Az UNAS és a Medusa beállításai a Webshop alatt állnak
    // (Balázs, 2026-10-26 13:05 UTC), itt nem duplázódnak.
    label: "Beállítások",
    icon: "settings",
    separated: true,
    children: [
      {
        href: "/beallitasok",
        label: "Általános",
        icon: "settings",
        entryId: "settings-general",
      },
      {
        href: "/admin/users",
        label: "Felhasználók",
        icon: "shield",
        entryId: "users",
      },
      {
        subgroup: "Kapcsolatok",
        href: "/admin/integrations/nav",
        label: "NAV",
        icon: "finance",
        entryId: "nav-integration",
      },
      {
        // A karbantartási piszkozat-számla Agent Key-je (ADR-014, 4. szelet).
        subgroup: "Kapcsolatok",
        href: "/admin/integrations/szamlazz/connection",
        label: "Számlázz.hu kapcsolat",
        icon: "finance",
        entryId: "szamlazz-connection",
      },
      {
        /**
         * SAJAT MENUPONT, ES EZ BALAZS KERESE VOLT: a mertekegysegek torzsadatkent
         * allnak a Beallitasok alatt, nem egy masik lap belsejeben elrejtve.
         * A mertekegyseg, az eszkoz-kategoria es az eszkoz-funkcio ugyanaz a
         * fajta tetel: sajat, uzemeltetesi torzsadat, amit ember tart karban.
         */
        subgroup: "Törzsadatok",
        href: "/beallitasok/mertekegysegek",
        label: "Mértékegységek",
        icon: "settings",
        entryId: "units-of-measure",
      },
      {
        subgroup: "Törzsadatok",
        href: "/beallitasok/eszkoz-kategoriak",
        label: "Eszköz-kategóriák",
        icon: "settings",
        entryId: "asset-categories",
      },
      {
        // Balazs kerese, 2026-09-22 (kanban 68add892).
        subgroup: "Törzsadatok",
        href: "/beallitasok/eszkoz-funkciok",
        label: "Eszköz-funkciók",
        icon: "settings",
        entryId: "asset-functions",
      },
      {
        // AZ AJANLATI SZOVEGRESZLETEK (#1582 P1): a Figma 35-ben nincs sajat
        // kerete, ezert a Beallitasok tobbi listalapjanak mintajat koveti.
        subgroup: "Árajánlat",
        href: "/beallitasok/ajanlat-szovegreszletek",
        label: "Ajánlat szövegrészletek",
        icon: "settings",
        entryId: "quote-snippets",
      },
      {
        // AZ AJANLATSABLONOK (#1582; Figma 35 · Offers / Templates, 579:2243)
        subgroup: "Árajánlat",
        href: "/beallitasok/ajanlat-sablonok",
        label: "Ajánlatsablonok",
        icon: "settings",
        entryId: "quote-templates",
      },
    ],
  },
];

/**
 * Whether this entry is the one the reader is on.
 *
 * A page below an entry's path counts as that entry: a single order is still
 * "Megrendelések". But a path can sit below two entries at once, and then the
 * more specific one owns it - `/beszerzes/nav-szamlak` is the NAV invoices,
 * not purchasing, and `/webshop/termekek` is the webshop products, not the
 * order list. Without `others` the outer entry lights up as well, and two
 * headings in the same group look equally current.
 *
 * `exact` stays for the case the paths cannot express: an entry that owns its
 * own page and nothing underneath it.
 */
export function isNavigationItemActive(
  pathname: string,
  item: AppNavigationItem,
  others: AppNavigationItem[] = [],
) {
  if (pathname === item.href) return true;
  if (
    item.alsoActiveOn?.some(
      (path) => pathname === path || pathname.startsWith(`${path}/`),
    )
  )
    return true;
  if (item.exact) return false;
  if (!pathname.startsWith(`${item.href}/`)) return false;

  return !others.some(
    (other) =>
      other.href.length > item.href.length &&
      (pathname === other.href || pathname.startsWith(`${other.href}/`)),
  );
}

/**
 * MINDEN OLDAL, EGY HELYEN OSSZEFUZVE.
 *
 * MIERT EXPORT, ES MIERT NEM MINDENKI SAJAT MAGA FUZI OSSZE: 2026-09-02-ig
 * HAROM helyen allt ez az osszefuzes (a keret aktiv-elem szamolasa, a keret
 * rajzolasa, es a felhasznalo-szerkeszto "mely oldalakat eri el ez a szerep"
 * elonezete), es KETTO kozuluk el is csuszott egymastol: az elonezet kihagyta a
 * Tartalom oldalt, es duplan sorolta a ket szerviz-menupontot, mert a
 * `serviceNavigation`-t kulon is felvette, holott a `businessNavigation` mar
 * tartalmazza a Szerviz csoport gyermekeikent.
 *
 * A sorrend a menu sorrendje, es ez nem mindegy: a keret ebben a sorrendben
 * rajzol, tehat aki ezt a listat olvassa, ugyanazt a sorrendet latja.
 */
export const allNavigationPages: AppNavigationItem[] =
  navigationItems(mainNavigation);
