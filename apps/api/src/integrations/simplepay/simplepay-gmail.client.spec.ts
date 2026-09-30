import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { SimplePayGmailClient } from "./simplepay-gmail.client.js";

const saved = { ...process.env };

function base64Url(value: string): string {
  return Buffer.from(value)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

beforeEach(() => {
  for (const prefix of ["GMAIL_SIMPLEPAY", "GMAIL_GLS"]) {
    delete process.env[`${prefix}_CLIENT_ID`];
    delete process.env[`${prefix}_CLIENT_SECRET`];
    delete process.env[`${prefix}_REFRESH_TOKEN`];
  }
  delete process.env.GMAIL_SIMPLEPAY_QUERY;
  process.env.GMAIL_FOXPOST_CLIENT_ID = "client";
  process.env.GMAIL_FOXPOST_CLIENT_SECRET = "secret";
  process.env.GMAIL_FOXPOST_REFRESH_TOKEN = "refresh";
  process.env.GMAIL_API_URL = "https://gmail.test/gmail/v1";
  process.env.GOOGLE_OAUTH_TOKEN_URL = "https://oauth.test/token";
});

afterEach(() => {
  process.env = { ...saved };
});

// the shape of the 2026-09-30 report mail: an HTML and a text body, two
// inline images, and the CSV (names invented)
const REPORT_MAIL = {
  id: "sp-1",
  internalDate: "1790744349312",
  payload: {
    headers: [
      { name: "Subject", value: "SimplePay - Forgalmi kimutatás" },
      { name: "From", value: "SimplePay <noreply@simplepay.hu>" },
    ],
    mimeType: "multipart/mixed",
    parts: [
      {
        mimeType: "multipart/alternative",
        parts: [
          {
            mimeType: "text/plain",
            body: {
              data: base64Url(
                "2026.09.21 - 2026.09.27 forgalmi időszakról\nTranzakciók száma: 2",
              ),
            },
          },
          { mimeType: "text/html", body: { data: base64Url("<p>x</p>") } },
        ],
      },
      {
        filename: "autoImage-x47i3ALk01XopgYha9L2",
        mimeType: "image/png",
        body: { attachmentId: "img-1", size: 6 },
      },
      {
        filename: "report_20260930.csv",
        mimeType: "text/csv",
        body: { attachmentId: "csv-1", size: 3 },
      },
    ],
  },
};

describe("SimplePayGmailClient", () => {
  it("searches SimplePay's weekly report, and brings its CSV and text body only", async () => {
    const requested: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = new URL(String(input));
      requested.push(url.pathname + url.search);
      if (url.href === "https://oauth.test/token")
        return Response.json({ access_token: "access", expires_in: 3600 });
      if (url.pathname.endsWith("/messages"))
        return Response.json({ messages: [{ id: "sp-1" }] });
      if (url.pathname.endsWith("/messages/sp-1"))
        return Response.json(REPORT_MAIL);
      if (url.pathname.endsWith("/attachments/csv-1"))
        return Response.json({ data: base64Url("a;b") });
      return new Response("not found", { status: 404 });
    };
    const client = new SimplePayGmailClient(fetcher);
    assert.deepEqual(await client.listMessageIds(), ["sp-1"]);
    const search = new URL(
      `https://x${requested.find((path) => path.includes("/messages?"))!}`,
    ).searchParams.get("q");
    assert.equal(
      search,
      'from:noreply@simplepay.hu subject:"Forgalmi kimutatás" has:attachment filename:csv newer_than:120d',
    );

    const message = await client.getMessage("sp-1");
    assert.deepEqual(
      [message.subject, message.sender, message.receivedAt?.toISOString()],
      [
        "SimplePay - Forgalmi kimutatás",
        "SimplePay <noreply@simplepay.hu>",
        "2026-09-30T04:59:09.312Z",
      ],
    );
    assert.deepEqual(
      message.csv.map((file) => [file.fileName, file.buffer.toString()]),
      [["report_20260930.csv", "a;b"]],
    );
    assert.match(message.body!, /2026\.09\.21 - 2026\.09\.27/);
    // the inline images are never downloaded
    assert.ok(!requested.some((path) => path.includes("img-1")));
  });

  it("names a refused key as an auth failure", async () => {
    const client = new SimplePayGmailClient(
      async () => new Response("no", { status: 401 }),
    );
    await assert.rejects(
      () => client.listMessageIds(),
      /SIMPLEPAY_GMAIL_AUTH_FAILED/,
    );
  });
});
