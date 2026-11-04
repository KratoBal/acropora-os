import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "./client";
import { maintenanceInvoiceApi } from "./maintenance-invoice";

/*
  „NINCS MÉG SZÁMLA” EGY TIG-RE (Balázs képe, 2026-11-04 18:48 UTC, MR-2026-0008: a megrendelés TIG-sora örökre
  „Számla: betöltés…”-t mutatott). A szerver `null`-t ad, amit a Nest üres törzzsel küld, és az `apiRequest` üres
  törzsre `undefined`-ot ad. MI PIROSÍT: ha az üres válasz vagy a 404 nem `null`; ha egy más hiba csendben `null`.
*/
afterEach(() => vi.unstubAllGlobals());

const respond = (status: number, body: string) =>
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(body || null, { status })),
  );

describe("maintenanceInvoiceApi.byCertificate", () => {
  it("az üres 200-as válasz és a 404 is null: még nincs számla", async () => {
    respond(200, "");
    expect(await maintenanceInvoiceApi.byCertificate("t", "cert-1")).toBeNull();
    respond(404, JSON.stringify({ message: "nincs" }));
    expect(await maintenanceInvoiceApi.byCertificate("t", "cert-1")).toBeNull();
  });

  it("a meglévő számlát adja, más hibát pedig továbbdob", async () => {
    respond(200, JSON.stringify({ id: "inv-1", status: "DRAFT" }));
    expect(await maintenanceInvoiceApi.byCertificate("t", "cert-1")).toEqual({
      id: "inv-1",
      status: "DRAFT",
    });
    respond(500, JSON.stringify({ message: "hiba" }));
    await expect(
      maintenanceInvoiceApi.byCertificate("t", "cert-1"),
    ).rejects.toBeInstanceOf(ApiError);
  });
});
