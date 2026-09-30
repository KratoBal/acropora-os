import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
  SupplierInvoiceMailClient,
  senderAddress,
} from "./supplier-invoice-mail.client.js";

const saved = { ...process.env };

function base64Url(value: string | Buffer): string {
  return Buffer.from(value)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

beforeEach(() => {
  process.env.GMAIL_GLS_CLIENT_ID = "client";
  process.env.GMAIL_GLS_CLIENT_SECRET = "secret";
  process.env.GMAIL_GLS_REFRESH_TOKEN = "refresh";
  process.env.GMAIL_API_URL = "https://gmail.test/gmail/v1";
  process.env.GOOGLE_OAUTH_TOKEN_URL = "https://oauth.test/token";
});

afterEach(() => {
  process.env = { ...saved };
});

// What must fail: a search with another query than the one asked for; a PDF
// sent as application/octet-stream (Aquarioom) missed; anything but a PDF
// downloaded; the sender not read from the From header.
describe("the supplier invoice mail client", () => {
  it("searches with the given query, and downloads only the PDFs, by name too", async () => {
    const requested: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = new URL(String(input));
      requested.push(url.pathname + url.search);
      if (url.href === "https://oauth.test/token")
        return Response.json({ access_token: "access", expires_in: 3600 });
      if (url.pathname.endsWith("/messages"))
        return Response.json({ messages: [{ id: "m-1" }] });
      if (url.pathname.endsWith("/messages/m-1"))
        return Response.json({
          id: "m-1",
          internalDate: "1790000000000",
          payload: {
            headers: [
              { name: "From", value: "AQUARIOOM <Contact@Aquarioom.com>" },
              { name: "Subject", value: "Invoice N°FA00009139" },
            ],
            parts: [
              { mimeType: "text/plain", body: { data: base64Url("szia") } },
              {
                mimeType: "application/octet-stream",
                filename: "Facture FA00009139.pdf",
                body: { attachmentId: "att-1", size: 10 },
              },
              {
                mimeType: "image/png",
                filename: "logo.png",
                body: { data: base64Url("png") },
              },
            ],
          },
        });
      if (url.pathname.endsWith("/attachments/att-1"))
        return Response.json({ data: base64Url("%PDF-1.4 x") });
      return new Response("nincs", { status: 404 });
    };
    const client = new SupplierInvoiceMailClient(fetcher);

    assert.deepEqual(
      await client.listMessageIds(
        "from:(contact@aquarioom.com) has:attachment",
      ),
      ["m-1"],
    );
    const message = await client.getMessage("m-1");

    assert.equal(
      new URL("https://x" + requested[1]!).searchParams.get("q"),
      "from:(contact@aquarioom.com) has:attachment",
    );
    assert.equal(message.sender, "contact@aquarioom.com");
    assert.equal(message.subject, "Invoice N°FA00009139");
    assert.deepEqual(
      message.pdfs.map((pdf) => [pdf.fileName, pdf.buffer.toString()]),
      [["Facture FA00009139.pdf", "%PDF-1.4 x"]],
    );
    assert.equal(
      requested.filter((path) => path.includes("/attachments/")).length,
      1,
    );
  });

  it("reads the sender from a bracketed or a bare address", () => {
    assert.equal(
      senderAddress("De Jong <Info@DeJongMarineLife.nl>"),
      "info@dejongmarinelife.nl",
    );
    assert.equal(
      senderAddress("info@hertlein-aquaristik.de"),
      "info@hertlein-aquaristik.de",
    );
    assert.equal(senderAddress("nincs cím"), null);
    assert.equal(senderAddress(null), null);
  });
});
