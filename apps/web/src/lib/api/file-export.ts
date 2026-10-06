import { ApiError } from "./client";

/** Egy letöltött export: a fájl és a szerver adta név. */
export interface FileExport {
  blob: Blob;
  fileName: string;
}

/**
 * Az export válasza fájl, nem JSON. Hibánál a szerver mondata megy tovább (a
 * hónap alakja, jog), és ha a törzs nem JSON (proxy-hiba), az általános mondat.
 * A fájl neve a Content-Disposition fejlécből jön, ha nincs, a tartalék.
 */
export async function readExport(
  response: Response,
  fallbackName: string,
  fallbackMessage: string,
): Promise<FileExport> {
  if (!response.ok) {
    let message: string | undefined;
    try {
      const payload = (await response.json()) as {
        message?: string | string[];
      };
      message = Array.isArray(payload.message)
        ? payload.message.join("\n")
        : payload.message;
    } catch {
      message = undefined;
    }
    throw new ApiError(message ?? fallbackMessage, response.status);
  }
  // \x22 = idézőjel: a nyers `"` egy regex-literálban az útvonal-őr maszkolóját
  // string-módba viszi, és a fájl többi hívása eltűnik előle.
  const named = /filename=\x22([^\x22]+)\x22/.exec(
    response.headers.get("Content-Disposition") ?? "",
  );
  return { blob: await response.blob(), fileName: named?.[1] ?? fallbackName };
}
