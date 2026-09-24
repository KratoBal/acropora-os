/**
 * A KIÁLLÍTÁS ÉVE, BUDAPESTI NAPTÁR SZERINT -- NEM UTC SZERINT.
 *
 * A `MaintenanceOrder.occasionYear` ebből számol, és ez az az érték, ami a
 * kettős rendelés elleni őrzőt hajtja (hány nem visszavont rendelés esik
 * egy `ContractItem`-re EBBEN AZ ÉVBEN). Egy UTC-alapú `getFullYear()` egy
 * december 31-i, késő esti kiállításnál már a KÖVETKEZŐ évet mondaná --
 * ugyanaz a hiba, amit a `maintenance-order-form-formatting.ts`
 * `formatOrderFormDate`-je is hordozott, amíg át nem állt
 * `Intl.DateTimeFormat`-ra `Europe/Budapest` zónával (nautilus mérése,
 * 2026-09-24, acrobot jelezte -- ez a mérce most itt is él, nem csak ott).
 */
const HU_YEAR = new Intl.DateTimeFormat("hu-HU", {
  year: "numeric",
  timeZone: "Europe/Budapest",
});

export function maintenanceOrderOccasionYear(issuedAt: Date): number {
  return Number(HU_YEAR.format(issuedAt));
}
