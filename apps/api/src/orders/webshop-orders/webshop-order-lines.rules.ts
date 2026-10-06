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

/**
 * A SZÉTBONTÁS KÉRÉSE AZ ADATLAP SORAIHOZ MÉRVE (kártya 0a14f739 C/3). A
 * webshop ugyanezt elutasítja (422), de a kezelő itt a saját sorainak nevével
 * kapja meg az okot, és a hibás kérés el sem indul. Ami nem bontás: üres
 * kijelölés, és minden tétel teljes mennyisége (üres rendelés maradna).
 */
export function splitRequestRefusal(
  lines: readonly { id: string; title: string; quantity: number }[],
  wanted: readonly { itemId: string; quantity: number }[],
): string | null {
  if (!wanted.length) return "Jelölj ki legalább egy tételt a bontáshoz.";
  const seen = new Set<string>();
  for (const item of wanted) {
    const line = lines.find((candidate) => candidate.id === item.itemId);
    if (!line || seen.has(item.itemId))
      return "A kijelölt tétel nincs a rendelésen: töltsd újra az oldalt.";
    seen.add(item.itemId);
    if (
      !Number.isInteger(item.quantity) ||
      item.quantity < 1 ||
      item.quantity > line.quantity
    )
      return `${line.title}: 1 és ${line.quantity} közötti mennyiség bontható.`;
  }
  const whole = lines.every(
    (line) =>
      wanted.find((item) => item.itemId === line.id)?.quantity ===
      line.quantity,
  );
  return whole
    ? "Minden tétel teljes mennyisége nem bontás: az eredeti rendelésben maradnia kell valaminek."
    : null;
}
