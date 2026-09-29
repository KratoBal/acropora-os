import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { GlsGmailClient } from "./gls-gmail.client.js";

const saved = { ...process.env };

function base64Url(value: string): string {
  return Buffer.from(value)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

beforeEach(() => {
  process.env.GMAIL_FOXPOST_CLIENT_ID = "client";
  process.env.GMAIL_FOXPOST_CLIENT_SECRET = "secret";
  process.env.GMAIL_FOXPOST_REFRESH_TOKEN = "refresh";
  process.env.GMAIL_API_URL = "https://gmail.test/gmail/v1";
  process.env.GOOGLE_OAUTH_TOKEN_URL = "https://oauth.test/token";
});

afterEach(() => {
  process.env = { ...saved };
});

describe("GlsGmailClient", () => {
  it("searches only the two GLS senders, and downloads only the XLSX attachments", async () => {
    const requested: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = new URL(String(input));
      requested.push(url.pathname + url.search);
      if (url.href === "https://oauth.test/token")
        return Response.json({ access_token: "access", expires_in: 3600 });
      if (url.pathname.endsWith("/messages"))
        return Response.json({ messages: [{ id: "gls-1" }] });
      if (url.pathname.endsWith("/messages/gls-1"))
        return Response.json({
          id: "gls-1",
          internalDate: "1790000000000",
          payload: {
            headers: [
              { name: "Subject", value: "GLS - Számla és Számlamelléklet" },
            ],
            parts: [
              {
                filename: "SettlementDocument_HU00000001_20260918.xlsx",
                mimeType:
                  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                body: { attachmentId: "xlsx-1", size: 4 },
              },
              {
                filename: "InvoiceDocument_HU00000001.pdf",
                mimeType: "application/pdf",
                body: { attachmentId: "pdf-1", size: 3 },
              },
              {
                filename: "InvoiceDocument_HU00000001.xml",
                mimeType: "application/xml",
                body: { attachmentId: "xml-1", size: 3 },
              },
            ],
          },
        });
      if (url.pathname.endsWith("/attachments/xlsx-1"))
        return Response.json({ data: base64Url("xlsx") });
      return new Response("not found", { status: 404 });
    };
    const client = new GlsGmailClient(fetcher);
    assert.deepEqual(await client.listMessageIds(), ["gls-1"]);
    const search = new URL(
      `https://x${requested.find((path) => path.endsWith("/messages") || path.includes("/messages?"))!}`,
    ).searchParams.get("q");
    assert.equal(
      search,
      "from:(utanvet@gls-hungary.com OR szamlamelleklet@gls-hungary.com) has:attachment filename:xlsx newer_than:90d",
    );

    const message = await client.getMessage("gls-1");
    assert.deepEqual(
      message.xlsx.map((file) => [file.fileName, file.buffer.toString()]),
      [["SettlementDocument_HU00000001_20260918.xlsx", "xlsx"]],
    );
    assert.equal(message.subject, "GLS - Számla és Számlamelléklet");
    assert.ok(
      !requested.some(
        (path) => path.includes("pdf-1") || path.includes("xml-1"),
      ),
    );
  });

  it("refuses to run without a key", async () => {
    delete process.env.GMAIL_FOXPOST_CLIENT_ID;
    await assert.rejects(
      new GlsGmailClient(async () => Response.json({})).listMessageIds(),
      /GLS_GMAIL_NOT_CONFIGURED/,
    );
  });
});
