/**
 * A SZERZŐDÉS FAJTÁJA (hétfői lista M4, Balázs 2026-10-09). Egy helyen, mert
 * a szerver (`contracts/dto.ts`, a szabály a szolgáltatásban) és a két űrlap
 * (új szerződés, adatlap) ugyanígy dönt arról, melyik tételmező kötelező.
 *
 *   MAINTENANCE  karbantartás: alkalom / év, helyszín, eszközök, javítási
 *                díjak; megrendelőlap készül belőle
 *   PURCHASE     beszerzés: leírás, nettó egységár, mennyiség, mennyiségi
 *                egység, ÁFA; számla készül belőle
 *   REPAIR       javítás (karbantartási felmérés S0/3, Balázs 2026-10-15):
 *                ugyanazok a tételmezők, mint a karbantartásinál, de az alkalom
 *                / év nem kötelező, és megrendelőlap NEM készül belőle. Ma csak
 *                választható fajta, külön viselkedés nélkül.
 */
export const CONTRACT_KINDS = ["MAINTENANCE", "PURCHASE", "REPAIR"] as const;
export type ContractKind = (typeof CONTRACT_KINDS)[number];

/** A választókapcsoló feliratai, Balázs szavaival. */
export const CONTRACT_KIND_LABELS: Record<ContractKind, string> = {
  PURCHASE: "Beszerzés",
  MAINTENANCE: "Karbantartás",
  REPAIR: "Javítás",
};

/**
 * Miért nem állítható vissza a beszerzési szerződés karbantartásira vagy
 * javításira, vagy `null`. A tükre a megrendelőlapos zárnak (barracuda, #1661):
 * ha már készült belőle számla (vázlat is), a számla egy beszerzési szerződésre
 * hivatkozik.
 */
export function contractMaintenanceSwitchBlocker(
  invoiceCount: number,
): string | null {
  return invoiceCount > 0
    ? "Ebből a szerződésből már készült számla, ezért nem állítható vissza Karbantartásra vagy Javításra."
    : null;
}

/**
 * Miért nem állítható át a szerződés Beszerzésre vagy Javításra, vagy `null`,
 * ha átállítható. Balázs („így van”): ha már készült hozzá karbantartási
 * megrendelőlap, nem. A javítási szerződésből sem készül megrendelőlap
 * (felmérés S0/3), tehát ugyanez a zár.
 */
export function contractPurchaseSwitchBlocker(
  maintenanceOrderCount: number,
): string | null {
  return maintenanceOrderCount > 0
    ? "Ehhez a szerződéshez már készült karbantartási megrendelőlap, ezért nem állítható át Beszerzésre vagy Javításra."
    : null;
}

/**
 * Egy fajtaváltás zárja, `from`-ról `to`-ra, vagy `null`. A szerver és a
 * választókapcsoló ugyanezt kérdezi, opciónként. Karbantartásira váltani csak
 * beszerzésiből zárt (számla után); javításiból mindig szabad.
 */
export function contractKindSwitchBlocker(
  from: ContractKind,
  to: ContractKind,
  counts: { maintenanceOrderCount: number; invoiceCount: number },
): string | null {
  if (from === to) return null;
  if (from === "PURCHASE")
    return contractMaintenanceSwitchBlocker(counts.invoiceCount);
  if (to === "MAINTENANCE") return null;
  return contractPurchaseSwitchBlocker(counts.maintenanceOrderCount);
}
