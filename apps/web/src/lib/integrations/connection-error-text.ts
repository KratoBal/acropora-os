/**
 * A KAPCSOLAT-ELLENŐRZÉS HIBAKÓDJA MAGYARUL (UI-áttekintés, 4. csomag, 2026-11-03).
 *
 * Az UNAS és a NAV kapcsolat-beállító lapja eddig a nyers kódot írta ki piros monospace
 * szöveggel (`UNAS_CONNECTION_VERIFICATION_STALE`). A kód a hibakereséshez kell, a felhasználónak
 * viszont mondat: a mondat látszik, a kód a mondat tooltipjében (`title`) megmarad.
 *
 * A két rendszer kódjai azonos szerkezetűek (`<RENDSZER>_CONNECTION_...`, `<RENDSZER>_CREDENTIAL_...`),
 * ezért az előtag levágása után egy tábla szolgál ki mindkettőt. Az API kódlistái
 * (`unas-connection.types.ts`, `nav-connection.types.ts`) a teszt szerint mind le vannak fedve.
 */
export type ConnectionSystem = "UNAS" | "NAV";

/** A rendszer neve a mondat elején (nagybetűvel). */
const SYSTEM_START: Record<ConnectionSystem, string> = {
  UNAS: "Az UNAS",
  NAV: "A NAV",
};

const TEXT: Record<string, (system: ConnectionSystem) => string> = {
  CONNECTION_CONFIGURATION_MISSING: () => "A kapcsolat beállítása hiányzik.",
  CONNECTION_NOT_CONFIGURED: () => "A kapcsolat még nincs beállítva.",
  CONNECTION_DISABLED: () => "A kapcsolat ki van kapcsolva.",
  CREDENTIAL_MASTER_KEY_NOT_CONFIGURED: () =>
    "A hozzáférési adatok titkosító kulcsa nincs beállítva a szerveren.",
  CREDENTIAL_MASTER_KEY_INVALID: () =>
    "A hozzáférési adatok titkosító kulcsa érvénytelen.",
  CREDENTIAL_KEY_VERSION_UNKNOWN: () =>
    "A hozzáférési adatok titkosító kulcsának verziója ismeretlen.",
  CREDENTIAL_ENVELOPE_INVALID: () =>
    "A tárolt hozzáférési adatok sérültek vagy ismeretlen alakúak.",
  CREDENTIAL_DECRYPT_FAILED: () =>
    "A tárolt hozzáférési adatokat nem sikerült visszafejteni.",
  CREDENTIAL_INPUT_INVALID: () =>
    "A megadott hozzáférési adatok érvénytelenek.",
  CONNECTION_RATE_LIMITED: () =>
    "Túl sok kérés ment ki rövid idő alatt. Várj egy kicsit, és próbáld újra.",
  CONNECTION_RATE_LIMITED_UPSTREAM: (s) =>
    `${SYSTEM_START[s]} korlátozta a kéréseket. Várj egy kicsit, és próbáld újra.`,
  CONNECTION_AUTH_REJECTED: (s) =>
    `${SYSTEM_START[s]} elutasította a bejelentkezést. Ellenőrizd a hozzáférési adatokat.`,
  CONNECTION_PERMISSION_MISSING: () =>
    "A hozzáférési adatoknak hiányzik egy szükséges jogosultsága az UNAS-ban.",
  CONNECTION_PERMISSION_UNKNOWN: () =>
    "A hozzáférési adatok jogosultságát nem sikerült megállapítani.",
  CONNECTION_API_REJECTED: (s) => `${SYSTEM_START[s]} elutasította a kérést.`,
  CONNECTION_HTTP_4XX: (s) =>
    `${SYSTEM_START[s]} kérési hibával (4xx) válaszolt.`,
  CONNECTION_HTTP_5XX: (s) =>
    `${SYSTEM_START[s]} szerverhibával (5xx) válaszolt.`,
  CONNECTION_NETWORK_FAILED: (s) =>
    `${SYSTEM_START[s]} nem érhető el (hálózati hiba).`,
  CONNECTION_TIMEOUT: (s) => `${SYSTEM_START[s]} nem válaszolt időben.`,
  CONNECTION_RESPONSE_INVALID: (s) =>
    `${SYSTEM_START[s]} válasza nem értelmezhető.`,
  CONNECTION_FAILED: () => "A kapcsolat ellenőrzése sikertelen.",
  CONNECTION_VERIFICATION_STALE: () =>
    "Az utolsó ellenőrzés régi (több mint egy napja). Tesztelj újra.",
};

/**
 * A hibakód mondata. Ismeretlen kódra (az API új kódot kapott, a tábla még nem) általános
 * mondat áll, a nyers kód nélkül; a kódot a hívó a tooltipbe teszi.
 */
export function connectionErrorText(
  code: string,
  system: ConnectionSystem,
): string {
  const rest = code.startsWith(`${system}_`)
    ? code.slice(system.length + 1)
    : code;
  return (
    TEXT[rest]?.(system) ??
    "A kapcsolat ellenőrzése nem sikerült (ismeretlen ok)."
  );
}

/** Igaz, ha a kódnak saját mondata van (a teszt ezt kérdezi a kódlistákra). */
export function hasConnectionErrorText(
  code: string,
  system: ConnectionSystem,
): boolean {
  const rest = code.startsWith(`${system}_`)
    ? code.slice(system.length + 1)
    : code;
  return rest in TEXT;
}
