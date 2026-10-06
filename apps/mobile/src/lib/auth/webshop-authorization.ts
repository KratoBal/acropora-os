import type { UserRole } from "./types";

export interface WebshopCapabilities {
  workspace: boolean;
  ordersView: boolean;
  ordersManage: boolean;
  purchasingView: boolean;
  purchasingManage: boolean;
  productsView: boolean;
  productsManage: boolean;
  partnersView: boolean;
  partnersManage: boolean;
}

export interface ServiceCapabilities {
  workspace: boolean;
  assetsView: boolean;
  assetsManage: boolean;
  /**
   * A MUNKALAP UGYANAZT A KÉT SZERVER-JOGOT KAPJA, MINT AZ ESZKÖZ
   * (`service.view` és `service.manage`), mégis saját kulcsot kap itt.
   *
   * A szerveren a szerviz modul EGY jogosultság-pár, a telefonon viszont két
   * külön csempe, és a csempe kapujának azt kell megneveznie, amit MEGNYIT. Egy
   * `assetsView` névre kötött munkalap-csempe akkor is működne, de a következő
   * olvasó nem tudná eldönteni, szándék volt-e vagy elírás -- és ha a szerver
   * egyszer szétválasztja a két modult, a változás egyetlen helyen, itt landol.
   */
  worksheetsView: boolean;
  worksheetsManage: boolean;
  /**
   * A HIBAJEGY UGYANAZT A KET SZERVER-JOGOT KAPJA, mint az eszkoz es a
   * munkalap (`service.view` es `service.manage`) -- es ugyanabbol az okbol
   * kap megis sajat kulcsot, mint a munkalap: a telefonon KULON csempe, es a
   * csempe kapuja azt nevezze meg, amit MEGNYIT.
   *
   * ES ITT A KETTO SZETVALASZTASA NEM ELMELETI: a jegy OLVASASA es a jegy
   * LEPTETESE ket kulonbozo dolog a helyszinen. Aki csak nezi, annak a
   * leptetes-gombok sem valok -- egy nem mukodo gomb ugyanugy nez ki, mint egy
   * elromlott.
   */
  serviceJobsView: boolean;
  serviceJobsManage: boolean;
  /**
   * AZ AKVÁRIUM SAJÁT JOGPÁRT KAP A SZERVEREN (`aquariums.view` /
   * `aquariums.manage`), NEM a szerviz kettőjét -- ezért itt sem osztozhat a
   * fenti négy kulcs canView/canManage számításán.
   *
   * A PARTNER_SERVICE 2026-09-25-TŐL MEGKAPJA (Balázs döntése, Partner
   * Portál Akváriumok terv) -- korábban itt az állt, hogy a szerepnek
   * NINCS aquariums jogköre; ez a mondat elavult, mert a szerver
   * `ROLE_PERMISSIONS.PARTNER_SERVICE`-je mostantól viseli mindkettőt
   * (`packages/types/src/auth.ts`). A szerver oldali hatókör-szűrés
   * (`aquariums.service.ts` `visibilityFor`) ettől függetlenül szűkíti a
   * listát/adatlapot a hívó saját ügyfelére és kiosztott helyszíneire --
   * ez a mező csak a JOG meglétét tükrözi, nem a hatókört.
   */
  aquariumsView: boolean;
  aquariumsManage: boolean;
}

const FULL_ACCESS: WebshopCapabilities = {
  workspace: true,
  ordersView: true,
  ordersManage: true,
  purchasingView: true,
  purchasingManage: true,
  productsView: true,
  productsManage: true,
  partnersView: true,
  partnersManage: true,
};

/**
 * App-local mirror of the webshop-related subset of
 * `packages/types/src/auth.ts`. The Expo app intentionally does not import
 * pnpm workspace packages (see `types.ts` and docs/MOBILE-DEVELOPMENT.md).
 *
 * This is a presentation gate only. Every API endpoint still enforces the
 * canonical server-side permission before returning or changing data.
 *
 * The mirror is only as good as the names. `partnersView` and `partnersManage`
 * had no counterpart on the server at all until `partners.view` and
 * `partners.manage` were introduced: the two sides claimed to agree while
 * naming different things, and nothing here would have said so.
 *
 * `navView` and `navManage` used to sit here in that same state, and they are
 * gone (2026-08-26). They were named after a MODULE (the tax authority), while
 * the server grants rights per OPERATION: setting up the NAV connection needs
 * `settings.manage`, the taxpayer lookup needs `customers.manage`, and the
 * incoming invoices -- the thing the tile actually promised -- need
 * `purchasing.view`. One client-side name could not mirror three server
 * permissions, so renaming it would only have looked like a fix. When the
 * screen is built, it will use the key belonging to the call it makes.
 *
 * Every key that remains has a server-side counterpart, and that is asserted:
 * see `apps/api/src/auth/mobile-capability-mirror.spec.ts`.
 */
const ROLE_CAPABILITIES: Readonly<Record<UserRole, WebshopCapabilities>> = {
  OWNER: FULL_ACCESS,
  ADMIN: FULL_ACCESS,
  MANAGER: {
    ...FULL_ACCESS,
  },
  SALES: {
    workspace: true,
    ordersView: true,
    ordersManage: true,
    purchasingView: false,
    purchasingManage: false,
    productsView: true,
    productsManage: false,
    partnersView: false,
    partnersManage: false,
  },
  WAREHOUSE: {
    workspace: true,
    ordersView: true,
    ordersManage: false,
    purchasingView: true,
    purchasingManage: true,
    productsView: true,
    productsManage: false,
    partnersView: true,
    partnersManage: true,
  },
  SERVICE: {
    workspace: false,
    ordersView: false,
    ordersManage: false,
    purchasingView: false,
    purchasingManage: false,
    /** The products tile showed but could not be opened (`enabled={false}`),
     * which is worse than hiding it: the technician sees something is there
     * and cannot reach it. It is off here rather than on the tile because the
     * server took `products.view` away from SERVICE on 2026-09-02, and this
     * mirror must not claim more than the server grants. */
    productsView: false,
    productsManage: false,
    /** Service partners are the technician's working context, so the list is
     * visible from the phone. Editing is not: the owner's decision was "let
     * the service staff just see it for now" (2026-08-21), which the server
     * enforces by granting SERVICE `partners.view` and not `partners.manage`. */
    partnersView: true,
    partnersManage: false,
  },
  // Partner-fiók csak hibajegyet, munkalapot és eszközt kezel. A szerviz
  // képességeit lent, a `getServiceCapabilities` adja; itt minden webshop- és
  // partnerterület hamis marad, hogy a telefon is pontosan a szerver két
  // `service.*` jogát tükrözze.
  PARTNER_SERVICE: {
    workspace: false,
    ordersView: false,
    ordersManage: false,
    purchasingView: false,
    purchasingManage: false,
    productsView: false,
    productsManage: false,
    partnersView: false,
    partnersManage: false,
  },
  VIEWER: {
    workspace: true,
    ordersView: true,
    ordersManage: false,
    purchasingView: true,
    purchasingManage: false,
    productsView: true,
    productsManage: false,
    partnersView: true,
    partnersManage: false,
  },
};

/**
 * KINEK A KÉPESSÉGEIRŐL KÉRDEZÜNK: a szerep, és ha a szerver elküldte, a személy
 * saját jog-listája (sablon + felhasználónkénti eltérés, 2026-10-06). A lista
 * dönt; csak a hiányában (régebbi szerver) a szerep táblája.
 */
export interface CapabilitySubject {
  role: UserRole;
  permissions?: readonly string[];
}

/**
 * A KÉPESSÉG -> SZERVER-JOG MEGFELELTETÉS, a lista-alapú számításhoz. Ugyanaz a
 * pár, amit a szerver oldali `mobile-capability-mirror.spec.ts` `SERVER_PAIR`-je
 * rögzít; a `mobile-capability-values.spec.ts` minden szerepre összeveti a két
 * utat (lista és tábla), tehát egy elírás itt pirosat ad.
 */
const WEBSHOP_PERMISSION = {
  ordersView: "orders.view",
  ordersManage: "orders.manage",
  purchasingView: "purchasing.view",
  purchasingManage: "purchasing.manage",
  productsView: "products.view",
  productsManage: "products.manage",
  partnersView: "partners.view",
  partnersManage: "partners.manage",
} as const;

function webshopFromPermissions(
  permissions: readonly string[],
): WebshopCapabilities {
  const has = (permission: string) => permissions.includes(permission);
  const ordersView = has(WEBSHOP_PERMISSION.ordersView);
  const purchasingView = has(WEBSHOP_PERMISSION.purchasingView);
  const productsView = has(WEBSHOP_PERMISSION.productsView);
  return {
    // a webshop-munkaterület annak jár, aki a rendelést, a beszerzést vagy a
    // terméket látja; a partner-lista egymagában (SERVICE) nem nyitja meg
    workspace: ordersView || purchasingView || productsView,
    ordersView,
    ordersManage: has(WEBSHOP_PERMISSION.ordersManage),
    purchasingView,
    purchasingManage: has(WEBSHOP_PERMISSION.purchasingManage),
    productsView,
    productsManage: has(WEBSHOP_PERMISSION.productsManage),
    partnersView: has(WEBSHOP_PERMISSION.partnersView),
    partnersManage: has(WEBSHOP_PERMISSION.partnersManage),
  };
}

function serviceFromPermissions(
  permissions: readonly string[],
): ServiceCapabilities {
  const has = (permission: string) => permissions.includes(permission);
  const canView = has("service.view");
  const canManage = has("service.manage");
  return {
    workspace: canView,
    assetsView: canView,
    assetsManage: canManage,
    worksheetsView: canView,
    worksheetsManage: canManage,
    serviceJobsView: canView,
    serviceJobsManage: canManage,
    aquariumsView: has("aquariums.view"),
    aquariumsManage: has("aquariums.manage"),
  };
}

export function getWebshopCapabilities(
  subject: CapabilitySubject,
): WebshopCapabilities {
  return subject.permissions
    ? webshopFromPermissions(subject.permissions)
    : ROLE_CAPABILITIES[subject.role];
}

export function getServiceCapabilities(
  subject: CapabilitySubject,
): ServiceCapabilities {
  return subject.permissions
    ? serviceFromPermissions(subject.permissions)
    : serviceFromRole(subject.role);
}

/** A szerep táblája: csak régebbi szerver ellen, ami a listát nem küldi. */
function serviceFromRole(role: UserRole): ServiceCapabilities {
  const canView =
    role === "OWNER" ||
    role === "ADMIN" ||
    role === "MANAGER" ||
    role === "SERVICE" ||
    role === "PARTNER_SERVICE" ||
    role === "VIEWER";
  const canManage =
    role === "OWNER" ||
    role === "ADMIN" ||
    role === "MANAGER" ||
    role === "SERVICE" ||
    role === "PARTNER_SERVICE";
  // A PARTNER_SERVICE 2026-09-25-től ide is bekerült -- lásd a mezők
  // dokumentációját. Ez a két érték a fenti négy kulcstól FÜGGETLENÜL
  // számol, mert az akvárium a szerveren saját jogpárt visel, nem a
  // szerviz kettőjét.
  const canViewAquariums =
    role === "OWNER" ||
    role === "ADMIN" ||
    role === "MANAGER" ||
    role === "SERVICE" ||
    role === "PARTNER_SERVICE" ||
    role === "VIEWER";
  const canManageAquariums =
    role === "OWNER" ||
    role === "ADMIN" ||
    role === "MANAGER" ||
    role === "SERVICE" ||
    role === "PARTNER_SERVICE";
  return {
    workspace: canView,
    assetsView: canView,
    assetsManage: canManage,
    worksheetsView: canView,
    worksheetsManage: canManage,
    serviceJobsView: canView,
    serviceJobsManage: canManage,
    aquariumsView: canViewAquariums,
    aquariumsManage: canManageAquariums,
  };
}

export function userRoleLabel(role: UserRole): string {
  const labels: Record<UserRole, string> = {
    OWNER: "Tulajdonos",
    ADMIN: "Adminisztrátor",
    MANAGER: "Manager",
    SALES: "Értékesítés",
    WAREHOUSE: "Raktár",
    SERVICE: "Szerviz",
    PARTNER_SERVICE: "Partner szerviz",
    VIEWER: "Megtekintő",
  };
  return labels[role];
}
