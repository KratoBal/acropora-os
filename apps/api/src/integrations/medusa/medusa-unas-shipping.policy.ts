import type { OsShippingProfile } from "./medusa-shipping-attributes.policy.js";

/**
 * A UNAS SZÁLLÍTÁSI MÓD-FELÜLÍRÁSAI -> A NÉGY SZÁLLÍTÁSI JELZŐ (kártya 2a7f2313).
 *
 * Balázs, 2026-10-06 16:45 UTC: a szállítási jelleget át kell hozni a UNAS-ból,
 * csak a teszt boltra. Mérve ugyanaznap az OS UNAS-tükrén (1901 termék): a UNAS
 * a terméken a módok FELÜLÍRÁSÁT tárolja (`ShippingMethods.Denied` és
 * `.Activated`). Öt kézbesítő mód van: GLS házhoz, GLS csomagpont, Foxpost, és
 * két nehéz-áru GLS mód (alapból kikapcsolva). A bolti átvétel soha nincs tiltva.
 *
 * A LEKÉPEZÉS acrobot döntése (27094, 27099), az első illő nyer:
 *   bolti átvétel   minden GLS mód (házhoz ÉS csomagpont) tiltva, és nehéz-áru
 *                   mód nincs bekapcsolva. Ide esik a „csak Foxpost” is: a
 *                   commerce-ben nincs „bolt + Foxpost” osztály, és a 116
 *                   ilyen termékből 115 élő állat (azokat a kategória úgyis
 *                   bolti átvételre teszi); a maradék biztonságos átmenet.
 *   nehéz           egy nehéz-áru GLS mód be van kapcsolva és nincs tiltva
 *   Foxpost tiltva  a Foxpost tiltva (a „csak GLS házhoz” is ide esik: a
 *                   commerce GLS szerepe a csomagpontot is engedi; ez ismert)
 *   semmi           nincs felülírás, vagy egyik fenti sem: `null`, nincs mit
 *                   átvinni
 *
 * Az élő állat NEM innen jön: a kategóriából (`medusa-livestock.policy.ts`).
 */
const GLS_HOME = "GLS házhozszállítás";
const GLS_POINT = "Átvétel a GLS csomagponton";
const FOXPOST = "Foxpost csomagautomaták";
const isHeavyMethod = (name: string) => /neh[ée]z\s*[áa]ru/i.test(name);

function methodNames(block: unknown): string[] {
  const method = (block as { Method?: unknown } | null | undefined)?.Method;
  const list =
    method === undefined || method === null
      ? []
      : Array.isArray(method)
        ? method
        : [method];
  return list
    .map((m) => String((m as { Name?: unknown } | null)?.Name ?? "").trim())
    .filter(Boolean);
}

export function unasShippingProfile(
  rawPayload: unknown,
): OsShippingProfile | null {
  const methods = (
    rawPayload as {
      ShippingMethods?: { Denied?: unknown; Activated?: unknown };
    } | null
  )?.ShippingMethods;
  const denied = methodNames(methods?.Denied);
  const heavyLive = methodNames(methods?.Activated).filter(
    (name) => isHeavyMethod(name) && !denied.includes(name),
  );
  const profile = (flags: Partial<OsShippingProfile>): OsShippingProfile => ({
    pickupOnly: false,
    foxpostForbidden: false,
    isHeavy: false,
    isFrozen: false,
    ...flags,
  });
  if (
    denied.includes(GLS_HOME) &&
    denied.includes(GLS_POINT) &&
    heavyLive.length === 0
  )
    return profile({ pickupOnly: true });
  if (heavyLive.length > 0) return profile({ isHeavy: true });
  if (denied.includes(FOXPOST)) return profile({ foxpostForbidden: true });
  return null;
}
