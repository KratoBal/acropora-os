import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { FoxpostGmailClient } from "./foxpost-gmail.client.js";

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
});
