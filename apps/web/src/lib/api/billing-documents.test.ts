import { afterEach, describe, expect, it, vi } from "vitest";

import { billingDocumentsApi } from "./billing-documents";
import { ApiError } from "./client";

/**
 * A HIVATALOS PDF LETÖLTÉSE (nautilus #1283): vázlatra és PDF nélküli
 * bizonylatra a szerver 409-et ad EGY KIÍRHATÓ MONDATTAL. MI PIROSÍT: ha a
 * felület ezt a mondatot egy általános hibára cserélné, vagy ha egy nem JSON
 * hibatörzs (proxy-hiba) a letöltés helyett kivételt dobna a feldolgozásban.
 */
describe("billingDocumentsApi.pdf", () => {
  afterEach(() => vi.unstubAllGlobals());

  const respond = (response: Response) =>
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

  it("returns the stored PDF", async () => {
    respond(
      new Response(new Blob(["%PDF-1.7"]), {
        status: 200,
        headers: { "Content-Type": "application/pdf" },
      }),
    );
    const blob = await billingDocumentsApi.pdf("token-1", "doc-1");
    expect(await blob.text()).toBe("%PDF-1.7");
  });

  it("a 409 carries the server's sentence", async () => {
    respond(
      new Response(
        JSON.stringify({
          statusCode: 409,
          message: "A vázlatnak nincs hivatalos PDF-je.",
        }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      ),
    );
    const error = await billingDocumentsApi
      .pdf("token-1", "doc-1")
      .catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).message).toBe(
      "A vázlatnak nincs hivatalos PDF-je.",
    );
    expect((error as ApiError).status).toBe(409);
  });

  it("a body that is not JSON falls back to the general sentence", async () => {
    respond(new Response("Bad Gateway", { status: 502 }));
    await expect(billingDocumentsApi.pdf("token-1", "doc-1")).rejects.toThrow(
      "A bizonylat PDF-je nem tölthető le.",
    );
  });
});
