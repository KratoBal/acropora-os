import type { WebshopOrderDetail, WebshopOrderStatus } from "@acropora/types";

/**
 * A TÉTELMŰVELETEK SZABÁLYAI (Rendelések, 6. PR; a prompt 12. pontja: mennyiség,
 * csere, törlés soronként). A Kiszállítás előtt a tételművelet csak
 * előkészít: a rendelés összege változik, a levonás a Kiszállításkor megy,
 * a csökkentett összegre (acrobot 26310, 1. döntés; commerce #482).
 */

/** Ezekben az állapotokban módosíthatók a tételek: a Kiszállítás előtt. */
const EDITABLE: readonly WebshopOrderStatus[] = [
  "pending_processing",
  "confirmed",
  "stocking",
];

/**
 * Miért NEM módosíthatók most a tételek; `null`, ha módosíthatók. A kiállított
 * számla és a feladott csomag a rendelés régi összegét viseli: a tétel csak
 * azok rendezése után változhat. A számla-VÁZLAT nem akadály, a kiállítás a
 * rendelésből újraírja.
 */
export function lineEditRefusal(input: {
  status: WebshopOrderStatus | null;
  invoice: WebshopOrderDetail["invoice"];
  parcel: WebshopOrderDetail["parcel"];
}): string | null {
  if (!input.status || !EDITABLE.includes(input.status))
    return "A tételek a Kiszállítás előtt módosíthatók.";
  if (input.invoice?.status === "ISSUED" || input.invoice?.status === "ISSUING")
    return "A számla már ki van állítva: a tétel csak a számla sztornója után módosítható.";
  if (input.parcel)
    return "A csomag már fel van adva: a tétel csak a csomag lemondása után módosítható.";
  return null;
}
