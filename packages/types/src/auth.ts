export const USER_ROLES = [
  "OWNER",
  "ADMIN",
  "MANAGER",
  "SALES",
  "WAREHOUSE",
  "SERVICE",
  "VIEWER",
] as const;

export type UserRole = (typeof USER_ROLES)[number];

export const PERMISSIONS = {
  DASHBOARD_VIEW: "dashboard.view",
  TASKS_VIEW: "tasks.view",
  ORDERS_VIEW: "orders.view",
  ORDERS_MANAGE: "orders.manage",
  PRODUCTS_VIEW: "products.view",
  PRODUCTS_MANAGE: "products.manage",
  CUSTOMERS_VIEW: "customers.view",
  CUSTOMERS_MANAGE: "customers.manage",
  INVENTORY_VIEW: "inventory.view",
  INVENTORY_MANAGE: "inventory.manage",
  PURCHASING_VIEW: "purchasing.view",
  PURCHASING_MANAGE: "purchasing.manage",
  /// A Partnerek menüpont: beszállítók és szerviz partnerek. Szándékosan
  /// KÜLÖN a beszerzési jogtól, mert a partner már nem csak beszerzési
  /// fogalom: szerviz partnernek munkalap és ajánlat is készül, a beszerzés
  /// pedig egy szervizesnek nem tartozik rá. Amíg a kettő egy jog volt, a
  /// SERVICE szerepkör a partnereket sem tudta listázni.
  PARTNERS_VIEW: "partners.view",
  /// A látás és az írás azért két jog, mert a bővítés iránya ismert: a
  /// szervizesek "egyelőre csak lássák" (Balázs döntése, 2026-08-21). Egy
  /// későbbi engedés így szerepkör-kiosztás lesz, nem újabb jog bevezetése.
  PARTNERS_MANAGE: "partners.manage",
  FINANCE_VIEW: "finance.view",
  FINANCE_MANAGE: "finance.manage",
  SERVICE_VIEW: "service.view",
  SERVICE_MANAGE: "service.manage",
  AQUARIUMS_VIEW: "aquariums.view",
  AQUARIUMS_MANAGE: "aquariums.manage",
  ICP_VIEW: "icp.view",
  ICP_MANAGE: "icp.manage",
  CONTENT_VIEW: "content.view",
  /// Tartalmat ÍRNI és lektorálni. A jóváhagyás NEM ez: az a
  /// `CONTENT_APPROVE`, és szándékosan külön, mert Balázs szabálya szerint
  /// egyelőre semmi nem mehet ki nélküle vagy Luca nélkül. Egy közös
  /// "content.manage" azt jelentené, hogy aki írja, jóvá is hagyhatja -- a
  /// kapu pedig pont az, hogy a kettő nem ugyanaz a kéz.
  CONTENT_MANAGE: "content.manage",
  /// A második lépcső: jóváhagyás és kiküldésre bocsátás.
  ///
  /// EZ A JOG MA KÉT NEVESÍTETT EMBERHEZ TARTOZIK: Balázshoz és Lucához. Nem
  /// vezetői szint, hanem két személy -- és ezt azért kell kiírni, mert a jog
  /// NEVE túléli a mai helyzetet. Egy szerepkör-tábla, amiben csak annyi áll,
  /// hogy a MANAGER nem kapja meg, egy év múlva önkényesnek látszik, és valaki
  /// jó szándékkal hozzáadja.
  ///
  /// A DÖNTÉS: Balázs, 2026-09-01 14:28, Discord. Szó szerint ennyi áll a
  /// kérésében a jóváhagyásról: „jova lehet hagyni mondjuk egy posztot ugy,
  /// hogy elotte lektoralja az akire tartozik."
  ///
  /// A második fele -- hogy egyelőre semmi nem mehet ki nélküle vagy Luca
  /// nélkül -- ugyanabból az üzenetből való, de a jegyzőkönyveinkben
  /// ÖSSZEFOGLALVA szerepel, nem szó szerint. Így is írom ide: az első mondat
  /// idézet, a második a mi olvasatunk arról, amit mondott.
  CONTENT_APPROVE: "content.approve",
  SETTINGS_MANAGE: "settings.manage",
  USERS_MANAGE: "users.manage",
  /// Egyedi rekordokra korlátozott, auditált készlet-repair (checkpoint 6
  /// - lásd apps/api/src/inventory/stock-reconciliation-repair.*).
  /// Szándékosan KÜLÖN a sima INVENTORY_MANAGE-től, amit a WAREHOUSE
  /// szerepkör is megkap a mindennapi leltár/beszerzés/POS munkához - egy
  /// repair közvetlenül felülírja a készlet "igazságát", ezért ugyanolyan
  /// szűk körnek jár, mint a SETTINGS_MANAGE/USERS_MANAGE (lásd
  /// ROLE_PERMISSIONS lent: csak OWNER/ADMIN, még a MANAGER sem).
  INVENTORY_RECONCILIATION_REPAIR: "inventory.reconciliation.repair",
  /// Lezárt munkalap módosítása (új verzió készítése). Szándékosan KÜLÖN a
  /// SERVICE_MANAGE-től: munkalapot írni és egy már kiadott, esetleg aláírt
  /// munkalapot átírni nem ugyanaz a jogkör - az utóbbi számlát alapozó
  /// dokumentumot érint. Ezért a SERVICE szerepkör NEM kapja meg (lásd
  /// ROLE_PERMISSIONS lent).
  SERVICE_WORKSHEET_AMEND: "service.worksheet.amend",
  /// Eszköz VÉGLEGES törlése a saját adatlapjáról. Szándékosan KÜLÖN a
  /// SERVICE_MANAGE-től: eszközt felvinni és szerkeszteni a napi szerviz-munka,
  /// egy eszközt megszüntetni viszont visszafordíthatatlan, és a hozzá tartozó
  /// esemény- és dokumentum-történet is vele megy (kaszkád). Ezért ugyanolyan
  /// szűk körnek jár, mint a SETTINGS_MANAGE és a SERVICE_WORKSHEET_AMEND
  /// (lásd ROLE_PERMISSIONS lent: a MANAGER sem kapja meg).
  ///
  /// A KIVEZETÉS NEM EZ: egy használatból kivont eszköz `RETIRED` állapotba
  /// kerül, és megmarad. Ez a jog a téves felvitel visszavonására való.
  SERVICE_ASSET_DELETE: "service.asset.delete",
  /// A termék törzsadat-gazdájának átvétele a UNAS-tól (UNAS -> ACROPORA).
  /// Szándékosan KÜLÖN a PRODUCTS_MANAGE-től, és nem azért, mert ritkán
  /// használt: az átvétel után a webshop-szinkron TÖBBÉ NEM ír a terméken,
  /// tehát egy UNAS oldali javítás némán nem érkezik meg. Aki napi
  /// terméktörzset gondoz, annak ehhez nem kell jog; ez ugyanolyan szűk
  /// körnek szól, mint az INVENTORY_RECONCILIATION_REPAIR (lásd
  /// ROLE_PERMISSIONS lent: csak OWNER/ADMIN, még a MANAGER sem).
  PRODUCTS_CATALOG_AUTHORITY_TRANSFER: "products.catalog-authority.transfer",
  /// A belső AI teszt-felület. Minden szerepkör megkapja, mert Balázs döntése
  /// szó szerint az volt, hogy "most kapja meg mindenki" (2026-08-26), és a
  /// szűkítés feltételét is ő mondta ki: amikor a felhasználói jogosultságokat
  /// rendezzük. Ezért NINCS a MANAGER tiltólistáján, és ezért szerepel a
  /// tételes szerepkör-listákon is - anélkül a SALES, WAREHOUSE, SERVICE és
  /// VIEWER nem kapná meg, és a "mindenki" csendben háromra szűkülne.
  AI_TEST_VIEW: "ai-test.view",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

const ALL_PERMISSIONS = Object.freeze(Object.values(PERMISSIONS));

const VIEW_PERMISSIONS: readonly Permission[] = [
  PERMISSIONS.AI_TEST_VIEW,
  PERMISSIONS.DASHBOARD_VIEW,
  PERMISSIONS.TASKS_VIEW,
  PERMISSIONS.ORDERS_VIEW,
  PERMISSIONS.PRODUCTS_VIEW,
  PERMISSIONS.CUSTOMERS_VIEW,
  PERMISSIONS.INVENTORY_VIEW,
  PERMISSIONS.PURCHASING_VIEW,
  PERMISSIONS.PARTNERS_VIEW,
  PERMISSIONS.FINANCE_VIEW,
  PERMISSIONS.SERVICE_VIEW,
  PERMISSIONS.AQUARIUMS_VIEW,
  PERMISSIONS.ICP_VIEW,
  PERMISSIONS.CONTENT_VIEW,
];

export const ROLE_PERMISSIONS: Readonly<
  Record<UserRole, readonly Permission[]>
> = {
  OWNER: ALL_PERMISSIONS,
  ADMIN: ALL_PERMISSIONS,
  MANAGER: ALL_PERMISSIONS.filter(
    (permission) =>
      permission !== PERMISSIONS.SETTINGS_MANAGE &&
      permission !== PERMISSIONS.USERS_MANAGE &&
      permission !== PERMISSIONS.INVENTORY_RECONCILIATION_REPAIR &&
      permission !== PERMISSIONS.SERVICE_WORKSHEET_AMEND &&
      permission !== PERMISSIONS.SERVICE_ASSET_DELETE &&
      permission !== PERMISSIONS.PRODUCTS_CATALOG_AUTHORITY_TRANSFER &&
      // A JOVAHAGYAS NEM VEZETOI JOG, HANEM KET NEVESITETT EMBERE. Balazs
      // szabalya 2026-09-01 14:28-rol: egyelore semmi nem mehet ki nelkule vagy
      // Luca nelkul. Egy MANAGER, aki tartalmat IR, sajat magat hagyna jova --
      // es akkor a kapu nem kapu, hanem egy pipa a sajat munkajan.
      permission !== PERMISSIONS.CONTENT_APPROVE,
  ),
  SALES: [
    PERMISSIONS.AI_TEST_VIEW,
    PERMISSIONS.DASHBOARD_VIEW,
    PERMISSIONS.TASKS_VIEW,
    PERMISSIONS.ORDERS_VIEW,
    PERMISSIONS.ORDERS_MANAGE,
    PERMISSIONS.PRODUCTS_VIEW,
    PERMISSIONS.CUSTOMERS_VIEW,
    PERMISSIONS.CUSTOMERS_MANAGE,
    PERMISSIONS.INVENTORY_VIEW,
    PERMISSIONS.FINANCE_VIEW,
  ],
  WAREHOUSE: [
    PERMISSIONS.AI_TEST_VIEW,
    PERMISSIONS.DASHBOARD_VIEW,
    PERMISSIONS.TASKS_VIEW,
    PERMISSIONS.ORDERS_VIEW,
    PERMISSIONS.PRODUCTS_VIEW,
    PERMISSIONS.INVENTORY_VIEW,
    PERMISSIONS.INVENTORY_MANAGE,
    PERMISSIONS.PURCHASING_VIEW,
    PERMISSIONS.PURCHASING_MANAGE,
    PERMISSIONS.PARTNERS_VIEW,
    PERMISSIONS.PARTNERS_MANAGE,
  ],
  SERVICE: [
    PERMISSIONS.AI_TEST_VIEW,
    PERMISSIONS.DASHBOARD_VIEW,
    PERMISSIONS.TASKS_VIEW,
    PERMISSIONS.PRODUCTS_VIEW,
    PERMISSIONS.CUSTOMERS_VIEW,
    /// Csak nézni. A szerviz partner a szervizesnek munkakörnyezet, de a
    /// törzsadatát nem ő gondozza (Balázs döntése, 2026-08-21: "a
    /// szervizesek csak lássák egyelőre"), ezért PARTNERS_MANAGE nincs.
    PERMISSIONS.PARTNERS_VIEW,
    PERMISSIONS.SERVICE_VIEW,
    PERMISSIONS.SERVICE_MANAGE,
    PERMISSIONS.AQUARIUMS_VIEW,
    PERMISSIONS.AQUARIUMS_MANAGE,
  ],
  VIEWER: VIEW_PERMISSIONS,
};

export interface AuthenticatedUser {
  id: string;
  email: string;
  /** The official, full name. Documents use this one. */
  displayName: string;
  /** What the team calls them; see `personDisplayName`. */
  nickname?: string | null;
  role: UserRole;
  avatarUrl?: string | null;
  /**
   * Which customer this account acts on behalf of, or `null` for our own
   * colleagues.
   *
   * REQUIRED, NOT OPTIONAL, and that is the point of the field. An optional
   * one would default to `undefined` at every construction site that forgot
   * it, and `undefined` reads as "no partner" - which is exactly the value
   * that means "an internal colleague who may see everything". A forgotten
   * field would therefore widen access silently. Required, the compiler
   * lists every place that builds an authenticated user and makes each one
   * state the membership out loud.
   */
  customerId: string | null;
  /** Which service partner this account acts on behalf of. See `customerId`. */
  supplierId: string | null;
}

/**
 * Who an authenticated account belongs to.
 *
 * A discriminated value rather than the two raw columns, because the reader
 * always wants the same thing: one partner, or none. The "both are set" state
 * is unrepresentable here, so no caller has to decide what it would mean.
 */
export type PartnerMembership =
  | { kind: "internal" }
  | { kind: "customer"; customerId: string }
  | { kind: "supplier"; supplierId: string }
  /**
   * Both columns are filled. The database forbids this
   * (`User_at_most_one_partner_check`), so reaching it means the constraint
   * is gone or the value never came from the database. NOT collapsed into
   * `internal`: that would turn a broken row into the widest possible access.
   */
  | { kind: "ambiguous" };

/**
 * Reads the membership off an authenticated user.
 *
 * This is NOT the authorisation filter - it answers "who is this account",
 * not "what may it see". The filter is a separate step and lives in the
 * repository layer; keeping the two apart is what lets this one be tested
 * without a database.
 */
export function partnerMembership(
  user: Pick<AuthenticatedUser, "customerId" | "supplierId">,
): PartnerMembership {
  /**
   * PRESENCE, not truthiness, and the difference points one way only.
   *
   * An empty string cannot name a partner - the foreign key would refuse it -
   * but the type allows one, and `if (user.customerId)` would read it as
   * absent, i.e. as one of our own colleagues, i.e. as the widest access
   * there is. Treated as present it becomes a membership that matches no
   * partner, so a filter built from it returns nothing. Both readings are
   * wrong about the value; only one of them is wrong in the safe direction.
   *
   * `undefined` is normalised to `null` first: the declared type does not
   * allow it, but a value crossing a JSON boundary or arriving from
   * untyped code can still carry it, and absent really does mean absent.
   */
  const customerId = user.customerId ?? null;
  const supplierId = user.supplierId ?? null;

  if (customerId !== null && supplierId !== null) return { kind: "ambiguous" };
  if (customerId !== null) return { kind: "customer", customerId };
  if (supplierId !== null) return { kind: "supplier", supplierId };
  return { kind: "internal" };
}

export interface Session {
  id: string;
  user: AuthenticatedUser;
  expiresAt: string;
  token?: string;
}

export function hasPermission(
  userOrRole: AuthenticatedUser | UserRole,
  permission: Permission,
): boolean {
  const role = typeof userOrRole === "string" ? userOrRole : userOrRole.role;
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function hasAnyPermission(
  userOrRole: AuthenticatedUser | UserRole,
  permissions: readonly Permission[],
): boolean {
  return permissions.some((permission) =>
    hasPermission(userOrRole, permission),
  );
}

export function hasAllPermissions(
  userOrRole: AuthenticatedUser | UserRole,
  permissions: readonly Permission[],
): boolean {
  return permissions.every((permission) =>
    hasPermission(userOrRole, permission),
  );
}
