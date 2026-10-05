/**
 * A FUVAROZOI REFERENCIA EGYETLEN HELYE (nautilus 26359). Balazs dontese
 * (2026-10-05 14:38 UTC, acrobot 26389): a Foxpost refCode es a GLS referencia
 * a RENDELESSZAM, vagyis a rendeles `display_id`-ja, `#` nelkul. Ha ez valaha
 * valtozik, CSAK ez a fuggveny valtozik.
 *
 * A Foxpost `refCode` legfeljebb 30 karakter (OpenAPI: CreateParcelRequest).
 * Hosszabbat nem vagunk le csendben: egy levagott referencia egy MASIK
 * rendelesre is illhet.
 */
export const SHIPMENT_REFERENCE_MAX_LENGTH = 30;

export interface ShipmentReferenceSource {
  displayId: number | string;
}

export function shipmentReference(order: ShipmentReferenceSource): string {
  const reference = String(order.displayId).trim().replace(/^#/, "");
  if (!reference)
    throw new Error("shipmentReference: the order has no display id");
  if (reference.length > SHIPMENT_REFERENCE_MAX_LENGTH) {
    throw new Error(
      `shipmentReference: "${reference}" is longer than ${SHIPMENT_REFERENCE_MAX_LENGTH} characters`,
    );
  }
  return reference;
}
