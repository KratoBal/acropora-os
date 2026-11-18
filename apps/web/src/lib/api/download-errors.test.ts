import { afterEach, describe, expect, it, vi } from "vitest";

import { aquariumsApi } from "./aquariums";
import { assetsApi } from "./assets";
import { ApiError } from "./client";
import { completionCertificatesApi } from "./completion-certificates";
import { contractsApi } from "./contracts";
import { mailImagesApi } from "./mail-images";
import { maintenanceInvoiceApi } from "./maintenance-invoice";
import { maintenanceOrdersApi } from "./maintenance-orders";
import { worksheetsApi } from "./worksheets";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

/*
  A FÁJL-LETÖLTŐ KLIENSEK HIBÁJA IS A SZERVER MONDATA (barracuda a #2695-ön, acrobot 56023): a karbantartási csomag letöltése után a többi letöltő is az `apiErrorOf`-ot hívja.
  Eddig mindegyik eldobta a válasz törzsét, és egy rögzített mondatot dobott ("A számla PDF-je nem tölthető le."), tehát a szerver pontos oka (nincs kiállítva, nincs
  jogosultság, nem létezik) nem jutott el a képernyőig. MI PIROSÍT: ha egy letöltő 400-as mondata nem szó szerint a szerveré; ha a 403 és a 404 nem a közös mondatot kapja; ha a
  nem-JSON hiba (proxy 502) nem mondja ki a státuszt; ha a hiba nem ApiError (a hívó a státuszt nem látná).
*/
function respond(status: number, body: unknown) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (body === undefined) throw new SyntaxError("not json");
      return body;
    },
    blob: async () => new Blob(["file"]),
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  });
}

const DOWNLOADS: [string, () => Promise<unknown>][] = [
  [
    "a karbantartási számla PDF-je",
    () => maintenanceInvoiceApi.downloadPdf("t", "inv-1"),
  ],
  [
    "a megrendelőlap dokumentuma",
    () => maintenanceOrdersApi.downloadDocument("t", "mo-1", "d-1"),
  ],
  [
    "a teljesítési igazolás dokumentuma",
    () => completionCertificatesApi.downloadDocument("t", "cc-1", "d-1"),
  ],
  [
    "az akvárium mérési PDF-je",
    () =>
      aquariumsApi.downloadMeasurementReportPdf(
        "t",
        "aq-1",
        "occ-1",
        "meres.pdf",
      ),
  ],
  [
    "az akvárium Excel exportja",
    () => aquariumsApi.downloadMeasurementsXlsx("t", "aq-1", "meresek.xlsx"),
  ],
  [
    "az eszköz dokumentuma",
    () => assetsApi.downloadDocument("t", "as-1", "d-1"),
  ],
  [
    "az eszköz dokumentumának bélyegképe",
    () => assetsApi.downloadDocumentThumbnail("t", "as-1", "d-1"),
  ],
  [
    "a munkalap csatolmánya",
    () => worksheetsApi.downloadDocument("t", "ws-1", "d-1"),
  ],
  [
    "a munkalap csatolmányának bélyegképe",
    () => worksheetsApi.downloadDocumentThumbnail("t", "ws-1", "d-1"),
  ],
  ["a szerződés PDF-je", () => contractsApi.downloadPdf("t", "c-1", "d-1")],
  ["a levélkép", () => mailImagesApi.content("t", "img-1")],
];

describe.each(DOWNLOADS)("%s letöltése", (_name, download) => {
  it("a szerver 400-as mondata a hibaüzenet, szó szerint, ApiError-ként, a státusszal", async () => {
    respond(400, {
      statusCode: 400,
      message:
        "A számla még nincs kiállítva, a PDF a kiállítás után tölthető le.",
    });
    const failure = await download().catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).message).toBe(
      "A számla még nincs kiállítva, a PDF a kiállítás után tölthető le.",
    );
    expect((failure as ApiError).status).toBe(400);
  });

  it("a 403 és a törzs nélküli 404 a közös mondatot kapja, a nem-JSON 502 a státuszt mondja ki", async () => {
    respond(403, { message: "Forbidden resource" });
    await expect(download()).rejects.toThrow(
      "Nincs jogosultságod ehhez a művelethez.",
    );
    respond(404, undefined);
    await expect(download()).rejects.toThrow("A keresett elem nem található.");
    respond(502, undefined);
    await expect(download()).rejects.toThrow(
      "A kérés feldolgozása nem sikerült (HTTP 502).",
    );
  });
});
