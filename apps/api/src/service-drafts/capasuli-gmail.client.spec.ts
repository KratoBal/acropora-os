import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { CapasuliGmailClient } from "./capasuli-gmail.client.js";
const saved = { ...process.env };
beforeEach(() => {
  process.env.GMAIL_CAPASULI_CLIENT_ID = "client";
  process.env.GMAIL_CAPASULI_CLIENT_SECRET = "secret";
  process.env.GMAIL_CAPASULI_REFRESH_TOKEN = "refresh";
  process.env.GMAIL_API_URL = "https://gmail.test/v1";
  process.env.GOOGLE_OAUTH_TOKEN_URL = "https://oauth.test/token";
});
afterEach(() => {
  process.env = { ...saved };
});
const b64 = (s: string) => Buffer.from(s).toString("base64url");
describe("Cápasuli Gmail read-only access", () => {
  it("reads more than 500 messages through all pages and never modifies mail", async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const client = new CapasuliGmailClient(async (input, init) => {
      const url = new URL(String(input));
      calls.push({ url: url.href, method: init?.method ?? "GET" });
      if (url.host === "oauth.test")
        return Response.json({ access_token: "token", expires_in: 3600 });
      assert.equal(init?.method ?? "GET", "GET");
      const page = Number(url.searchParams.get("pageToken") ?? 0);
      assert.equal(
        url.searchParams.get("q"),
        'from:zoobudapest.com subject:"napi jelentő"',
      );
      return Response.json({
        messages: Array.from({ length: 100 }, (_, i) => ({
          id: `${page * 100 + i}`,
        })),
        ...(page < 5 ? { nextPageToken: String(page + 1) } : {}),
      });
    });
    assert.equal((await client.listMessageIds()).length, 600);
    assert.equal(calls.filter((c) => c.method === "POST").length, 1);
  });
  it("walks nested MIME, downloads photos and preserves CID placement", async () => {
    const client = new CapasuliGmailClient(async (input) => {
      const url = String(input);
      if (url.includes("oauth.test"))
        return Response.json({ access_token: "token" });
      if (url.includes("/attachments/"))
        return Response.json({ data: b64("image") });
      return Response.json({
        id: "msg",
        internalDate: "1790000000000",
        payload: {
          headers: [
            {
              name: "From",
              value: "Szilveszter Roland <keeper@zoobudapest.com>",
            },
          ],
          parts: [
            {
              mimeType: "multipart/related",
              parts: [
                {
                  mimeType: "text/html",
                  body: {
                    data: b64(
                      '<p>Cápasuli: 2026. október 3.</p><p>Nap folyamán felmerülő hibák, intézkedések: volt</p><p>Szivattyú csere.</p><img src="cid:photo"/>',
                    ),
                  },
                },
                {
                  mimeType: "image/jpeg",
                  filename: "photo.jpeg",
                  headers: [{ name: "Content-ID", value: "<photo>" }],
                  body: { attachmentId: "a" },
                },
              ],
            },
          ],
        },
      });
    });
    const m = await client.getMessage("msg");
    assert.match(m.text, /\[photo.jpeg\]/);
    assert.equal(m.reporterPersonName, "Szilveszter Roland");
    assert.equal(m.attachments[0]!.buffer.toString(), "image");
  });
  it("reports auth failures as a safe code", async () => {
    const client = new CapasuliGmailClient(
      async () => new Response("private body", { status: 403 }),
    );
    await assert.rejects(
      () => client.listMessageIds(),
      /CAPASULI_GMAIL_AUTH_FAILED/,
    );
  });
});
