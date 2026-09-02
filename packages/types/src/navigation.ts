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
    id: "aquariums",
    surfaces: ["web"],
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
