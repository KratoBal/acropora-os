import { afterEach, describe, expect, it, vi } from "vitest";

import { missingInvoicesApi } from "./missing-invoices";

/**
 * A SZÁMLA FELTÖLTÉSE A DRAWERBŐL (nautilus #1305): a lap-teszt az egész
 * API-modult mockolja, tehát a kérés törzsét nem látja. MI PIROSÍT: ha a fájl
 * vagy a fajtája (INVOICE, PREMIUM_NOTICE) nem kerülne a multipart törzsbe,
 * ha az azonosító kódolatlanul menne az útba, vagy ha a metódus nem POST.
 */
describe("missingInvoicesApi.uploadDocument", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("posts the file and its kind to the item's documents", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "debit/1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const pdf = new File(["%PDF-1.7"], "szamla.pdf", {
      type: "application/pdf",
    });

    await missingInvoicesApi.uploadDocument(
      "token-1",
      "debit/1",
      pdf,
      "PREMIUM_NOTICE",
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/missing-invoices/items/debit%2F1/documents");
    expect(init.method).toBe("POST");
    const body = init.body as FormData;
    expect(body.get("kind")).toBe("PREMIUM_NOTICE");
    const sent = body.get("file") as File;
    expect(sent.name).toBe("szamla.pdf");
    expect(await sent.text()).toBe("%PDF-1.7");
  });
});
