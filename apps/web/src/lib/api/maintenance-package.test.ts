import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "./client";
import { maintenancePackageApi } from "./maintenance-package";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

/*
  A KARBANTARTÁSI CSOMAG LETÖLTÉSÉNEK HIBÁJA A SZERVER MONDATA (Luca, 2026-11-18 14:39 UTC, képernyőkép; acrobot 55959): a szerver 400-zal pontosan megmondja, miért nem tölthető le
  ("nincs teljesítési igazolás", "nincs aláírva", "nincs lezárva": `maintenancePackageBlockMessage`), a kliens viszont eldobta a válasz törzsét, és csak annyit írt ki, hogy
  "A karbantartási csomag nem tölthető le." MI PIROSÍT: ha a 400 szövege nem jut el a hívóig; ha a 401/403/404 nem a közös (apiRequest) mondatot kapja; ha a nem-JSON hiba (proxy 502) nem
  mondja ki a státuszt; ha a sikeres válasz nem Blob.
*/
function respond(status: number, body: unknown) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (body === undefined) throw new SyntaxError("not json");
      return body;
    },
    blob: async () => new Blob(["zip"]),
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  });
}

describe("maintenancePackageApi.download", () => {
  it("a szerver 400-as mondata a hibaüzenet, szó szerint", async () => {
    respond(400, {
      statusCode: 400,
      message:
        "A csomag nem tölthető le: a karbantartási lapnak nincs teljesítési igazolása.",
    });
    const failure = await maintenancePackageApi
      .download("t", "job-1")
      .catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).message).toBe(
      "A csomag nem tölthető le: a karbantartási lapnak nincs teljesítési igazolása.",
    );
    expect((failure as ApiError).status).toBe(400);
  });

  it("több sorból álló üzenet soronként marad (mint az apiRequest-nél)", async () => {
    respond(400, { message: ["nincs aláírva", "nincs lezárva"] });
    await expect(maintenancePackageApi.download("t", "job-1")).rejects.toThrow(
      "nincs aláírva\nnincs lezárva",
    );
  });

  it("a 401, 403 és 404 a közös mondatot kapja, nem egy angol keretrendszer-szöveget", async () => {
    respond(401, { message: "Unauthorized" });
    await expect(maintenancePackageApi.download("t", "j")).rejects.toThrow(
      "A munkamenet lejárt. Jelentkezz be újra.",
    );
    respond(403, { message: "Forbidden resource" });
    await expect(maintenancePackageApi.download("t", "j")).rejects.toThrow(
      "Nincs jogosultságod ehhez a művelethez.",
    );
    respond(404, undefined);
    await expect(maintenancePackageApi.download("t", "j")).rejects.toThrow(
      "A keresett elem nem található.",
    );
  });

  it("a nem-JSON hiba (proxy) kimondja a státuszt", async () => {
    respond(502, undefined);
    await expect(maintenancePackageApi.download("t", "j")).rejects.toThrow(
      "HTTP 502",
    );
  });

  it("a sikeres válasz a zip Blob-ja", async () => {
    respond(200, "zip");
    const blob = await maintenancePackageApi.download("t", "j");
    expect(blob).toBeInstanceOf(Blob);
  });
});
