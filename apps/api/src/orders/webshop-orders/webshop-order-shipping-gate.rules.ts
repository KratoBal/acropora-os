import type { WebshopOrderStatus } from "@acropora/types";

/**
 * A KISZÁLLÍTÁS KAPUJA A SZERVEREN (kártya 33a0d3c7, murena A1 mérése 2026-11-18, barracuda olvasata, acrobot döntése): a
 * felület sorrendje számla -> csomag -> kiszállítás, de a státusz-végpont ezt eddig nem őrizte: a #72-es teszt rendelés a
 * Kiszállításra számla és csomag nélkül is átment, és a Stripe-levonás ERRE az állapotra fut (commerce
 * `CAPTURE_ON_STATUS = out_for_delivery`), tehát a pénz a számla és a csomag nélkül is bejött volna.
 *
 * A kapu: a Kiszállításra (nem bolti átvételnél) kell kiállított számla ÉS aktív, a szállítótól csomagszámot kapott csomag. A
 * bolti átvétel nem érintett: az `ready_for_pickup` útján megy, és ott nincs csomag. A számla ugyanaz, mint a lépéssoré
 * (`factsOf`): az OS kiállított számlája, vagy előre utalásnál a Számlázz.hu Autokassza kötött számlája.
 *
 * AMI ITT MÉG NINCS, SZÁNDÉKOSAN: a naplózott felülbírálás és a jogos kivételek (kézzel a szállító portálján feladott csomag, a
 * szállító API kiesése, ismeretlen szállítójú szállítási mód). Hogy ezek valóban előfordulnak-e, Luca válasza dönti el (acrobot
 * kérdése függőben); addig a kapu kivétel nélkül zár, és a kimondott 409 nevezi meg, mi hiányzik.
 */
export interface ShippingGateFacts {
  storePickup: boolean;
  /** A kiállított (vagy az Autokassza által kötött) számla száma. */
  invoiceNumber: string | null;
  /** Aktív csomag, amelyet a szállító már csomagszámmal nyugtázott. */
  hasParcel: boolean;
}

/** Null, ha a lépés mehet; különben a mondat, amit a kezelő kap (409). */
export function shippingGateRefusal(
  to: WebshopOrderStatus,
  facts: ShippingGateFacts,
): string | null {
  if (to !== "out_for_delivery" || facts.storePickup) return null;
  const missing = [
    ...(facts.invoiceNumber ? [] : ["kiállított számla"]),
    ...(facts.hasParcel ? [] : ["feladott csomag"]),
  ];
  if (missing.length === 0) return null;
  return `A Kiszállítás előtt kell: kiállított számla és feladott csomag. Hiányzik: ${missing.join(", ")}. (A sorrend: számla, csomag, kiszállítás; a kártyás levonás a Kiszállításra fut.)`;
}
