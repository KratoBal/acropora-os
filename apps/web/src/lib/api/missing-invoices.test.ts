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

/**
 * A KÉT EXPORT (nautilus #1308): fájlt adnak, nem JSON-t. MI PIROSÍT: ha a
 * letöltés nem a szerver adta néven menne; ha egy elutasítás (jog, hónap
 * alakja) mondata elveszne; ha a csomag a hiánylista végpontjára menne.
 */
describe("missingInvoicesApi exports", () => {
  afterEach(() => vi.unstubAllGlobals());

  const respond = (response: Response) => {
    const fetchMock = vi.fn().mockResolvedValue(response);
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  };

  it("missingXlsx fetches the month's list under the server's file name", async () => {
    const fetchMock = respond(
      new Response(new Blob(["PK"]), {
        status: 200,
        headers: {
          "Content-Disposition":
            'attachment; filename="hianyzo-szamlak-2026-08-v2.xlsx"',
        },
      }),
    );
    const { blob, fileName } = await missingInvoicesApi.missingXlsx(
      "token-1",
      "2026-08",
    );
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/missing-invoices/months/2026-08/missing.xlsx",
    );
    expect(fileName).toBe("hianyzo-szamlak-2026-08-v2.xlsx");
    expect(await blob.text()).toBe("PK");
  });

  it("a refused export keeps the server's sentence, a non-JSON body the general one", async () => {
    respond(
      new Response(
        JSON.stringify({ statusCode: 400, message: "A hónap alakja ÉÉÉÉ-HH." }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      ),
    );
    await expect(
      missingInvoicesApi.missingXlsx("token-1", "2026-8"),
    ).rejects.toThrow("A hónap alakja ÉÉÉÉ-HH.");
    respond(new Response("Bad Gateway", { status: 502 }));
    await expect(
      missingInvoicesApi.accountantPackage("token-1", "2026-08"),
    ).rejects.toThrow("A könyvelői csomag nem tölthető le.");
  });

  it("accountantPackage falls back to its own name without the header", async () => {
    const fetchMock = respond(
      new Response(new Blob(["%PDF-1.7"]), { status: 200 }),
    );
    const { fileName } = await missingInvoicesApi.accountantPackage(
      "token-1",
      "2026-08",
    );
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/missing-invoices/months/2026-08/accountant-package.pdf",
    );
    expect(fileName).toBe("konyveloi-csomag-2026-08.pdf");
  });
});
