import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
  FoxpostForeignMessageError,
  FoxpostGmailClient,
  foxpostGmailConfig,
  isFoxpostAttachmentPair,
} from "./foxpost-gmail.client.js";

const savedEnvironment = { ...process.env };

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
  process.env.GMAIL_FOXPOST_USER = "info@acropora.hu";
  process.env.GMAIL_API_URL = "https://gmail.test/gmail/v1";
  process.env.GOOGLE_OAUTH_TOKEN_URL = "https://oauth.test/token";
});

afterEach(() => {
  process.env = { ...savedEnvironment };
});

describe("FoxpostGmailClient", () => {
  it("downloads exactly one XLSX and one PDF from the same Gmail message", async () => {
    const requested: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      requested.push(url);
      if (url === "https://oauth.test/token")
        return Response.json({ access_token: "access", expires_in: 3600 });
      if (url.includes("/messages?") || url.endsWith("/messages"))
        return Response.json({ messages: [{ id: "message-1" }] });
      if (url.includes("/messages/message-1?format=full"))
        return Response.json({
          id: "message-1",
          threadId: "thread-1",
          internalDate: "1786312800000",
          payload: {
            headers: [
              { name: "Subject", value: "Foxpost elszámolás" },
              { name: "From", value: "Foxpost <billing@example.test>" },
            ],
            parts: [
              {
                partId: "1",
                filename: "FOXPOST_W0166840_26H31.xlsx",
                mimeType:
                  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                body: { attachmentId: "xlsx-attachment", size: 4 },
              },
              {
                partId: "2",
                filename: "FX01015386.pdf",
                mimeType: "application/pdf",
                body: { data: base64Url("pdf"), size: 3 },
              },
            ],
          },
        });
      if (url.includes("/attachments/xlsx-attachment"))
        return Response.json({ data: base64Url("xlsx"), size: 4 });
      return new Response("not found", { status: 404 });
    };
    const client = new FoxpostGmailClient(fetcher);
    assert.deepEqual(await client.listCandidateMessageIds(), ["message-1"]);
    const message = await client.getMessage("message-1");
    assert.equal(message.id, "message-1");
    assert.equal(message.xlsx.buffer.toString(), "xlsx");
    assert.equal(message.pdf.buffer.toString(), "pdf");
    assert.equal(message.xlsx.filename, "FOXPOST_W0166840_26H31.xlsx");
    assert.equal(message.pdf.filename, "FX01015386.pdf");
    assert.equal(
      requested.filter((url) => url === "https://oauth.test/token").length,
      1,
    );
  });

  it("searches only Foxpost's own sender by default", async () => {
    // measured on production 2026-09-29: without the sender, 14 mails of
    // other senders with one XLSX and one PDF were taken as Foxpost
    // settlements, 9 of them GLS invoice attachments
    const searched: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = new URL(String(input));
      if (url.href === "https://oauth.test/token")
        return Response.json({ access_token: "access", expires_in: 3600 });
      searched.push(url.searchParams.get("q") ?? "");
      return Response.json({ messages: [] });
    };
    await new FoxpostGmailClient(fetcher).listCandidateMessageIds();
    assert.deepEqual(searched, [
      "from:noreply@billzone.eu has:attachment filename:xlsx filename:pdf newer_than:90d",
    ]);
  });

  it("still honours an explicit query override", () => {
    process.env.GMAIL_FOXPOST_QUERY = "from:other@example.com newer_than:7d";
    assert.equal(
      foxpostGmailConfig().query,
      "from:other@example.com newer_than:7d",
    );
  });

  it("knows Foxpost's file names, and nobody else's", () => {
    assert.equal(
      isFoxpostAttachmentPair(
        "FOXPOST_W0166840_26H38_Acropora Kft.xlsx",
        "FX01015386.pdf",
      ),
      true,
    );
    assert.equal(
      isFoxpostAttachmentPair("FOXPOST_W0166840_26H31.xlsx", "fx01015386.PDF"),
      true,
    );
    for (const [xlsx, pdf] of [
      [
        "SettlementDocument_HU00930236_20260918011215.xlsx",
        "InvoiceDocument_HU00930236.pdf",
      ],
      ["FOXPOST_W0166840_26H38.xlsx", "InvoiceDocument_HU00930236.pdf"],
      ["arlista.xlsx", "FX01015386.pdf"],
    ] as const)
      assert.equal(isFoxpostAttachmentPair(xlsx, pdf), false, xlsx);
  });

  it("rejects a foreign mail before downloading anything from it", async () => {
    const requested: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      requested.push(url);
      if (url === "https://oauth.test/token")
        return Response.json({ access_token: "access", expires_in: 3600 });
      return Response.json({
        id: "gls-1",
        threadId: "thread-1",
        internalDate: "1786312800000",
        payload: {
          headers: [],
          parts: [
            {
              partId: "1",
              filename: "SettlementDocument_HU00000000_20260918.xlsx",
              mimeType:
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
              body: { attachmentId: "xlsx-attachment", size: 4 },
            },
            {
              partId: "2",
              filename: "InvoiceDocument_HU00000000.pdf",
              mimeType: "application/pdf",
              body: { attachmentId: "pdf-attachment", size: 3 },
            },
          ],
        },
      });
    };
    await assert.rejects(
      new FoxpostGmailClient(fetcher).getMessage("gls-1"),
      FoxpostForeignMessageError,
    );
    assert.equal(
      requested.some((url) => url.includes("/attachments/")),
      false,
    );
  });
});
