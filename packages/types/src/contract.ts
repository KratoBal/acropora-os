/**
 * A SZERZŐDÉS FAJTÁJA (hétfői lista M4, Balázs 2026-10-09). Egy helyen, mert
 * a szerver (`contracts/dto.ts`, a szabály a szolgáltatásban) és a két űrlap
 * (új szerződés, adatlap) ugyanígy dönt arról, melyik tételmező kötelező.
 *
 *   MAINTENANCE  karbantartás, javítás: alkalom / év, helyszín, eszközök,
 *                javítási díjak; megrendelőlap készül belőle
 *   PURCHASE     beszerzés: leírás, nettó egységár, mennyiség, mennyiségi
 *                egység, ÁFA; számla készül belőle
 */
export const CONTRACT_KINDS = ["MAINTENANCE", "PURCHASE"] as const;
export type ContractKind = (typeof CONTRACT_KINDS)[number];

/** A választókapcsoló feliratai, Balázs szavaival. */
export const CONTRACT_KIND_LABELS: Record<ContractKind, string> = {
  PURCHASE: "Beszerzés",
  MAINTENANCE: "Karbantartás, javítás",
};

/**
 * Miért nem állítható vissza a beszerzési szerződés karbantartásira, vagy
 * `null`. A tükre a megrendelőlapos zárnak (barracuda, #1661): ha már készült
 * belőle számla (vázlat is), a számla egy beszerzési szerződésre hivatkozik.
 */
export function contractMaintenanceSwitchBlocker(
  invoiceCount: number,
): string | null {
  return invoiceCount > 0
    ? "Ebből a szerződésből már készült számla, ezért nem állítható vissza Karbantartásra."
    : null;
}

/**
 * Miért nem állítható át a szerződés Beszerzésre, vagy `null`, ha átállítható.
 * Balázs („így van”): ha már készült hozzá karbantartási megrendelőlap, nem.
 */
export function contractPurchaseSwitchBlocker(
  maintenanceOrderCount: number,
): string | null {
  return maintenanceOrderCount > 0
    ? "Ehhez a szerződéshez már készült karbantartási megrendelőlap, ezért nem állítható át Beszerzésre."
    : null;
}
