/**
 * HOL ÁLL AZ ESZKÖZ, egy sorban -- és mikor NEM VÁLASZTÁS EREDMÉNYE, amit
 * látunk.
 *
 * Szerviz partner tulajdonosnál a választott hely az ALEGYSÉG. A cím ilyenkor
 * MINDIG a partner saját postai címe (vevői cím oda nem rendelhető), tehát ha
 * nincs alegység, a képernyőn látszó cím nem azt jelenti, hogy valaki
 * megmondta, hol áll az eszköz -- csak azt, hogy melyik cégnél. A kettő
 * ugyanúgy néz ki, és pont ez a baj: egy nem pontosított eszköz pontosan
 * olyan, mint egy pontosított.
 *
 * Ezért a hiány KI VAN MONDVA. Ugyanezekkel a szavakkal, mint a weben
 * (`apps/web/src/components/service-assets/asset-detail-page.tsx` és a lista):
 * ha az iroda azt mondja telefonba, hogy „nincs pontosítva", a szerelő
 * ugyanazt a feliratot lássa maga előtt.
 *
 * Vevő tulajdonosnál nincs alegység -- ott a CÍM a pontosítás --, tehát ott a
 * cím hiánya az egyetlen, amit ki kell mondani.
 */

export interface AssetPlacementInput {
  ownerType: "CUSTOMER" | "SUPPLIER";
  unit?: { code: string; name: string; path?: readonly string[] };
  address?: { formatted: string };
}

const NOT_REFINED = "Nincs pontosítva.";

function unitLabel(unit: NonNullable<AssetPlacementInput["unit"]>): string {
  const path = unit.path?.filter((part) => part.trim()) ?? [];
  const name = path.length > 0 ? path.join(" / ") : unit.name;
  return `${name} (${unit.code})`;
}

/** A listasoré: rövid, de a hiányt ott is kimondja. */
export function assetPlacementLine(input: AssetPlacementInput): string {
  if (input.unit) return unitLabel(input.unit);
  const address = input.address?.formatted.trim();
  if (input.ownerType === "SUPPLIER")
    return address ? `${NOT_REFINED} ${address}` : NOT_REFINED;
  return address ?? NOT_REFINED;
}

/** Az adatlapé: ugyanaz a döntés, bővebb mondattal. */
export function assetPlacementDetail(input: AssetPlacementInput): string {
  if (input.unit) return unitLabel(input.unit);
  const address = input.address?.formatted.trim();
  if (input.ownerType === "SUPPLIER")
    return address
      ? `${NOT_REFINED} A partner címe látszik helyette: ${address}`
      : NOT_REFINED;
  return address ?? NOT_REFINED;
}
