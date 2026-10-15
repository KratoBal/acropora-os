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

/**
 * A MEGRENDELŐLAP NÉLKÜLI LAP ÉVE: a létrehozás budapesti naptári éve. Január
 * 1-jén Budapesten mindig téli idő (UTC+1) van, tehát az év határa UTC-ben
 * december 31. 23:00 -- ugyanaz a naptár, mint a `maintenanceOrderOccasionYear`.
 */
export function budapestYearRange(year: number): { gte: Date; lt: Date } {
  const hour = 60 * 60 * 1000;
  return {
    gte: new Date(Date.UTC(year, 0, 1) - hour),
    lt: new Date(Date.UTC(year + 1, 0, 1) - hour),
  };
}
