/**
 * A FELTÖLTÉS TISZTA SZABÁLYAI (Üzenetek, 2. fázis): a százalék és a válasz
 * értelmezése. Külön fájl, hálózat és `@/` import nélkül, hogy a `node --test`
 * fordítás mérni tudja; az átvitel maga (`lib/api/upload-with-progress.ts`)
 * telefont kér.
 */

/** A haladás egész százalékban. Ismeretlen teljes méretnél 0, és sosem 100 a válasz előtt. */
export function uploadPercent(loaded: number, total: number): number {
  if (!(total > 0)) return 0;
  return Math.min(99, Math.max(0, Math.floor((loaded / total) * 100)));
}

export type UploadOutcome<T> =
  { kind: "ok"; value: T } | { kind: "error"; status: number; message: string };

/**
 * A szerver válasza: 2xx-nél a törzs, egyébként a hibaüzenet, ugyanúgy, ahogy
 * az `apiRequest` olvassa (`message` szöveg vagy szöveglista). Egy olvashatatlan
 * 2xx törzs HIBA, nem siker: egy csatolmány-azonosító nélküli „kész” feltöltés
 * a küldésnél egy nem létező csatolmányra mutatna.
 */
export function readUploadResponse<T>(
  status: number,
  responseText: string,
): UploadOutcome<T> {
  let body: unknown = null;
  try {
    body = responseText ? JSON.parse(responseText) : null;
  } catch {
    body = null;
  }
  if (status >= 200 && status < 300) {
    if (body === null || typeof body !== "object")
      return {
        kind: "error",
        status,
        message: "A szerver válasza nem olvasható.",
      };
    return { kind: "ok", value: body as T };
  }
  const message =
    body && typeof body === "object" && "message" in body
      ? (body as { message?: unknown }).message
      : undefined;
  if (Array.isArray(message))
    return { kind: "error", status, message: message.join(", ") };
  if (typeof message === "string" && message)
    return { kind: "error", status, message };
  return { kind: "error", status, message: `API request failed (${status}).` };
}
