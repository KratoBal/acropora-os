import { ApiError, apiAuthHeaders } from "./client";

/**
 * TÖBBRÉSZES FELTÖLTÉS `XMLHttpRequest`-TEL (a `fetch` nem ad feltöltési
 * százalékot). Egy helyen, hogy a `mobile-api-routes.spec.ts` az útvonalat
 * HÍVÁSKÉNT lássa: a nevesített burkoló nélkül egy XHR-feltöltés útja az őrző
 * elől rejtve marad, mert az csak az `apiRequest`-et és a `fetch`-et olvassa.
 * Az útvonal első argumentumként, kiírva áll a hívónál.
 *
 * A hitelesítés az `apiRequest`-é (`apiAuthHeaders`: Bearer vagy CSRF-süti).
 * Egy 2xx válasz, aminek a törzse nem olvasható objektum, HIBA, nem siker: a
 * hívó különben egy üres eredményt kapna sikerként.
 */
export interface UploadOptions {
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
  /** A hálózati hiba mondata a felületen. */
  networkError: string;
  /** A szerver hibája, ha nem mond saját üzenetet. */
  failure: string;
  /** A megszakítás mondata; csak ha a hívó adhat `signal`-t. */
  aborted?: string;
}

export function uploadWithProgress<T>(
  url: string,
  token: string,
  form: FormData,
  options: UploadOptions,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", url);
    request.setRequestHeader("Accept", "application/json");
    for (const [name, value] of Object.entries(apiAuthHeaders(token, "POST")))
      request.setRequestHeader(name, value);
    const { onProgress } = options;
    if (onProgress)
      request.upload.addEventListener("progress", (event) => {
        if (event.lengthComputable)
          onProgress(Math.round((event.loaded / event.total) * 100));
      });
    request.addEventListener("error", () =>
      reject(new ApiError(options.networkError, 0)),
    );
    request.addEventListener("abort", () =>
      reject(new ApiError(options.aborted ?? options.networkError, 0)),
    );
    request.addEventListener("load", () => {
      let payload: unknown = null;
      try {
        payload = JSON.parse(request.responseText) as unknown;
      } catch {
        payload = null;
      }
      if (request.status >= 200 && request.status < 300) {
        if (!payload || typeof payload !== "object") {
          reject(
            new ApiError("A szerver válasza nem olvasható.", request.status),
          );
          return;
        }
        onProgress?.(100);
        resolve(payload as T);
        return;
      }
      const message =
        payload &&
        typeof payload === "object" &&
        "message" in payload &&
        typeof payload.message === "string"
          ? payload.message
          : options.failure;
      reject(new ApiError(message, request.status));
    });
    options.signal?.addEventListener("abort", () => request.abort());
    request.send(form);
  });
}
