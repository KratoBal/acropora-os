import { environment } from "@/config/env";
import { authSessionStore } from "@/lib/auth/token-store";
import {
  readUploadResponse,
  uploadPercent,
} from "@/lib/messages/upload-outcome";

import { ApiConfigError, ApiError, ApiNetworkError } from "./client";
import { FELTOLTES_IDOKORLAT_MS } from "./idokorlat";

/**
 * TÖBBRÉSZES FELTÖLTÉS HALADÁSSAL (Üzenetek, 2. fázis).
 *
 * === MIÉRT `XMLHttpRequest`, ÉS NEM AZ `apiRequest` ===
 *
 * A `fetch` nem ad feltöltési százalékot, a prompt pedig fájlonként haladást,
 * újrapróbálást és megszakítást kér. A React Native saját XHR-je a natív
 * hálózati rétegen megy: a `{ uri, name, type }` fájl-részt a natív oldal
 * olvassa be (ez az alak a futtató `fetch`-énél NEM menne, lásd
 * `file-bytes.ts`), és a `didSendNetworkData` eseményből jön az
 * `upload.onprogress`. A hibák ugyanazok az osztályok, mint az `apiRequest`-nél.
 *
 * Az útvonal első argumentumként, kiírva áll a hívónál: a
 * `mobile-api-routes.spec.ts` ezt a nevet is hívásnak olvassa.
 */
export interface UploadHandle<T> {
  promise: Promise<T>;
  abort(): void;
}

export class UploadAbortedError extends Error {
  constructor() {
    super("A feltöltés megszakítva.");
    this.name = "UploadAbortedError";
  }
}

export function uploadWithProgress<T>(
  path: `/${string}`,
  form: FormData,
  onProgress: (percent: number) => void,
): UploadHandle<T> {
  const xhr = new XMLHttpRequest();
  let aborted = false;

  const promise = (async () => {
    if (!environment.ok) throw new ApiConfigError(environment.problems);
    const url = `${environment.config.apiUrl}${path}`;
    const token = await authSessionStore.getToken();
    if (aborted) throw new UploadAbortedError();
    return new Promise<T>((resolve, reject) => {
      xhr.open("POST", url);
      xhr.setRequestHeader("Accept", "application/json");
      if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
      xhr.timeout = FELTOLTES_IDOKORLAT_MS;
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable)
          onProgress(uploadPercent(event.loaded, event.total));
      };
      xhr.onload = () => {
        const outcome = readUploadResponse<T>(xhr.status, xhr.responseText);
        if (outcome.kind === "ok") resolve(outcome.value);
        else reject(new ApiError(outcome.message, outcome.status));
      };
      xhr.onerror = () => reject(new ApiNetworkError());
      xhr.ontimeout = () => reject(new ApiNetworkError());
      xhr.onabort = () => reject(new UploadAbortedError());
      xhr.send(form);
    });
  })();

  return {
    promise,
    abort() {
      aborted = true;
      xhr.abort();
    },
  };
}
