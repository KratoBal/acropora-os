import type { ServiceJobKind, ServiceJobStatusValue } from "@acropora/types";

/**
 * A HIBAJEGY (KARBANTARTÁSI LAP) VÉGLEGES TÖRLÉSÉNEK SZABÁLYA (Balázs, 2026-11-18; acrobot 55766, 55770). Tiszta függvények: a tényekből egy tiltás-mondat
 * (vagy `null`), és a figyelmeztetések. A tények gyűjtése a tárolóé; itt semmi nem ír és nem olvas.
 *
 * Egy jegy akkor NEM törölhető, ha a törlés megsemmisítene valamit, ami már a jegyen kívül is hat: lezárt jegy, teljesítési igazolás (és az ahhoz kötött
 * számla), aláírt, lezárt (számozott) vagy az ügyfélnek átadott munkalap, karbantartási rendelés, egy MÁSIK jegy munkalapja által folytatott munkalap,
 * a beszerzésig jutott anyagigény, és minden jegyhez/munkalaphoz kötött készletmozgás (a készlet nem tűnhet el csendben, acrobot 55770). A megszakított
 * (CANCELLED) jegy törölhető. Az aláírásra váró munkalap nem tilt, de a megerősítő ablak kimondja, mert az ügyfél aláírási hivatkozása megszűnik.
 */
export interface ServiceJobDeleteSheetFacts {
  /** A lezárt lap teljes száma (`BIO-2026-001`); a piszkozatnak nincs. */
  number: string | null;
  /** Az ügyfélnek átadták (`handedOverAt`). */
  handedOver: boolean;
  /** Valamelyik verziója aláírt. */
  signed: boolean;
  /** A legutóbbi verziója aláírásra vár. */
  awaitingSignature: boolean;
  /** Egy másik jegy munkalapja folytatja (a törlés lógó hivatkozást hagyna). */
  continuedFromOutside: boolean;
}

export interface ServiceJobDeleteFacts {
  status: ServiceJobStatusValue;
  kind: ServiceJobKind;
  hasCompletionCertificate: boolean;
  hasMaintenanceOrder: boolean;
  worksheets: readonly ServiceJobDeleteSheetFacts[];
  /** Anyagigény, ami a beszerzésig jutott (folyamatban, megrendelve, részben vagy teljesen megérkezett). */
  procuredMaterialRequests: number;
  /** A jegyhez vagy a munkalapjaihoz kötött készletmozgások száma. */
  stockMovements: number;
}

export function serviceJobDeleteRefusal(
  facts: ServiceJobDeleteFacts,
): string | null {
  const maintenance = facts.kind === "MAINTENANCE";
  const thing = maintenance ? "karbantartási lap" : "hibajegy";
  const to = maintenance ? "karbantartási laphoz" : "hibajegyhez";
  if (facts.status === "COMPLETED")
    return maintenance
      ? "Lezárt karbantartási lap nem törölhető."
      : "Lezárt hibajegy nem törölhető.";
  if (facts.hasCompletionCertificate)
    return `Teljesítési igazolás tartozik a ${to}, ezért a ${thing} nem törölhető.`;
  if (facts.worksheets.some((sheet) => sheet.signed))
    return `Aláírt munkalap tartozik a ${to}, ezért a ${thing} nem törölhető.`;
  if (facts.worksheets.some((sheet) => sheet.number !== null))
    return `Lezárt (számozott) munkalap tartozik a ${to}, ezért a ${thing} nem törölhető.`;
  if (facts.worksheets.some((sheet) => sheet.handedOver))
    return `Az ügyfélnek átadott munkalap tartozik a ${to}, ezért a ${thing} nem törölhető.`;
  if (facts.hasMaintenanceOrder)
    return `Karbantartási rendelés tartozik a ${to}, ezért a ${thing} nem törölhető.`;
  if (facts.worksheets.some((sheet) => sheet.continuedFromOutside))
    return `Egy munkalapját másik ${maintenance ? "lap" : "jegy"} munkalapja folytatja, ezért a ${thing} nem törölhető.`;
  if (facts.procuredMaterialRequests > 0)
    return `A munkalapjaihoz tartozó anyagigény már a beszerzésig jutott, ezért a ${thing} nem törölhető.`;
  if (facts.stockMovements > 0)
    return `A ${thing}hez készletmozgás tartozik, ezért nem törölhető: a készlet nem tűnhet el csendben.`;
  return null;
}

export function serviceJobDeleteWarnings(
  facts: ServiceJobDeleteFacts,
): string[] {
  const waiting = facts.worksheets.filter(
    (sheet) => sheet.awaitingSignature,
  ).length;
  return waiting > 0
    ? [
        `${waiting} munkalap aláírásra vár: az ügyfél aláírási hivatkozása megszűnik.`,
      ]
    : [];
}
