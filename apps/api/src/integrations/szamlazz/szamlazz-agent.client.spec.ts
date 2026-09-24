import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  HttpSzamlazzAgentClient,
  SzamlazzAgentHttpError,
} from "./szamlazz-agent.client.js";

const SUCCESS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<xmlszamlavalasz xmlns="http://www.szamlazz.hu/xmlszamlavalasz">
<sikeres>true</sikeres>
<szamlanetto>10000</szamlanetto>
<szamlabrutto>12700</szamlabrutto>
</xmlszamlavalasz>`;

/**
 * A TESZT SOHA NEM HÍV VALÓDI HÁLÓZATOT -- ez a `fetch` mindig egy helyi
 * FÜGGVÉNY, sosem a globális implementáció. Ez a szabály acrobot kikötése
 * (23107): a Számlázz.hu Agent API valódi kulccsal fut, tehát semmilyen
 * teszt nem szólíthatja meg élesben.
 */
function fakeFetch(
  handler: (url: string, init: RequestInit) => Response,
): typeof fetch {
  return (async (url: string | URL, init?: RequestInit) =>
    handler(String(url), init ?? {})) as typeof fetch;
}

describe("HttpSzamlazzAgentClient", () => {
  it("posts the XML as a multipart file field named action-xmlagentxmlfile", async () => {
    let seenUrl = "";
    let seenBody: FormData | undefined;
    const client = new HttpSzamlazzAgentClient(
      "https://example.invalid/szamla/",
      fakeFetch((url, init) => {
        seenUrl = url;
        seenBody = init.body as FormData;
        return new Response(SUCCESS_XML, { status: 200 });
      }),
    );

    await client.generateInvoice("<xmlszamla></xmlszamla>");

    assert.equal(seenUrl, "https://example.invalid/szamla/");
    assert.ok(seenBody instanceof FormData);
    const field = seenBody!.get("action-xmlagentxmlfile");
    assert.ok(field instanceof Blob);
    assert.equal((field as File).name, "szamla.xml");
    assert.equal(await (field as Blob).text(), "<xmlszamla></xmlszamla>");
  });

  it("parses a successful 200 response", async () => {
    const client = new HttpSzamlazzAgentClient(
      "https://example.invalid/szamla/",
      fakeFetch(() => new Response(SUCCESS_XML, { status: 200 })),
    );

    const result = await client.generateInvoice("<xmlszamla></xmlszamla>");
    assert.equal(result.successful, true);
    assert.equal(result.grossTotal, 12700);
  });

  it("throws a transport error on a non-2xx HTTP status, distinct from a business rejection", async () => {
    const client = new HttpSzamlazzAgentClient(
      "https://example.invalid/szamla/",
      fakeFetch(() => new Response("Internal error", { status: 500 })),
    );

    await assert.rejects(
      () => client.generateInvoice("<xmlszamla></xmlszamla>"),
      SzamlazzAgentHttpError,
    );
  });
});
