import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { TicketMailGmailClient } from "./ticket-mail-gmail.client.js";

/**
 * THE TICKET@ MAILBOX READ (card ec7b947b, S2a). WHAT TURNS RED: any request that is not a GET (except the OAuth token exchange); the query or
 * the mailbox not the configured one; the sender's credentials used; an attachment taken by its name or declared type instead of its content; an
 * oversized or unknown-type attachment downloaded or kept; the header order lost (the topmost Authentication-Results is the one that counts); an
 * error text (which could carry a token) escaping instead of a fixed code.
 */
const saved = { ...process.env };
beforeEach(() => {
  process.env.GMAIL_TICKET_READ_CLIENT_ID = "client";
  process.env.GMAIL_TICKET_READ_CLIENT_SECRET = "secret";
  process.env.GMAIL_TICKET_READ_REFRESH_TOKEN = "refresh";
  process.env.GMAIL_API_URL = "https://gmail.test/v1";
  process.env.GOOGLE_OAUTH_TOKEN_URL = "https://oauth.test/token";
});
afterEach(() => {
  process.env = { ...saved };
});

const b64 = (data: Buffer | string) => Buffer.from(data).toString("base64url");
const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3,
]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const PDF = Buffer.from("%PDF-1.4 test");

interface Call {
  url: URL;
  method: string;
  body: string;
}

/** A fake Gmail: the token endpoint, the id list and one message by id, with the attachments by id. */
function fakeGmail(options: {
  message?: unknown;
  attachments?: Record<string, string>;
  pages?: number;
  fail?: number;
}) {
  const calls: Call[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push({
      url,
      method: init?.method ?? "GET",
      body: String(init?.body ?? ""),
    });
    if (options.fail)
      return new Response("secret detail refresh", { status: options.fail });
    if (url.host === "oauth.test")
      return Response.json({ access_token: "token", expires_in: 3600 });
    const attachment = /\/attachments\/(.+)$/.exec(url.pathname);
    if (attachment)
      return Response.json({
        data: options.attachments?.[decodeURIComponent(attachment[1]!)],
      });
    if (url.pathname.endsWith("/messages")) {
      const page = Number(url.searchParams.get("pageToken") ?? 0);
      const pages = options.pages ?? 1;
      return Response.json({
        messages: Array.from({ length: 100 }, (_, i) => ({
          id: `${page * 100 + i}`,
        })),
        ...(page + 1 < pages ? { nextPageToken: String(page + 1) } : {}),
      });
    }
    return Response.json(options.message);
  };
  return { fetcher, calls };
}

const header = (name: string, value: string) => ({ name, value });

describe("TicketMailGmailClient", () => {
  it("lists ids over all pages with the configured query and mailbox, and only ever GETs the mailbox", async () => {
    process.env.GMAIL_TICKET_READ_USER = "Ticket@Acropora.hu";
    process.env.GMAIL_TICKET_READ_QUERY = "in:inbox newer_than:3d";
    const { fetcher, calls } = fakeGmail({ pages: 3 });
    const ids = await new TicketMailGmailClient(fetcher).listMessageIds();
    assert.equal(ids.length, 300);
    for (const call of calls.filter((c) => c.url.host === "gmail.test")) {
      assert.equal(call.method, "GET");
      assert.match(
        call.url.pathname,
        /^\/v1\/users\/ticket%40acropora\.hu\/messages/,
      );
      assert.equal(call.url.searchParams.get("q"), "in:inbox newer_than:3d");
    }
    assert.equal(calls.filter((c) => c.method === "POST").length, 1);
    assert.equal(
      calls.find((c) => c.method === "POST")!.url.host,
      "oauth.test",
    );
  });

  it("a per-call query replaces the configured one for that call only, and the environment is untouched", async () => {
    process.env.GMAIL_TICKET_READ_QUERY = "in:inbox newer_than:3d";
    const { fetcher, calls } = fakeGmail({});
    const client = new TicketMailGmailClient(fetcher);
    await client.listMessageIds("from:someone newer_than:1d");
    await client.listMessageIds();
    const queries = calls
      .filter((c) => c.url.pathname.endsWith("/messages"))
      .map((c) => c.url.searchParams.get("q"));
    assert.deepEqual(queries, [
      "from:someone newer_than:1d",
      "in:inbox newer_than:3d",
    ]);
    assert.equal(process.env.GMAIL_TICKET_READ_QUERY, "in:inbox newer_than:3d");
  });

  it("with max: ONE request for the first page, asked for at most max, however many pages the query has", async () => {
    const { fetcher, calls } = fakeGmail({ pages: 3 });
    const ids = await new TicketMailGmailClient(fetcher).listMessageIds(
      undefined,
      { max: 3 },
    );
    const listCalls = calls.filter((c) => c.url.pathname.endsWith("/messages"));
    assert.equal(listCalls.length, 1);
    assert.equal(listCalls[0]!.url.searchParams.get("maxResults"), "3");
    assert.equal(ids.length, 3);
  });

  it("CONTROL: the token exchange carries the READ credentials, not the sender's", async () => {
    process.env.GMAIL_TICKET_CLIENT_ID = "send-id";
    process.env.GMAIL_TICKET_CLIENT_SECRET = "send-secret";
    process.env.GMAIL_TICKET_REFRESH_TOKEN = "send-refresh";
    const { fetcher, calls } = fakeGmail({});
    await new TicketMailGmailClient(fetcher).listMessageIds();
    const body = new URLSearchParams(
      calls.find((c) => c.method === "POST")!.body,
    );
    assert.equal(body.get("client_id"), "client");
    assert.equal(body.get("refresh_token"), "refresh");
  });

  it("reads the headers in message order, the sender, the subject, the text and the thread", async () => {
    const { fetcher } = fakeGmail({
      message: {
        id: "m1",
        threadId: "t1",
        internalDate: "1790000000000",
        payload: {
          headers: [
            header(
              "Authentication-Results",
              "mx.google.com; dmarc=fail header.from=acropora.hu",
            ),
            header(
              "Authentication-Results",
              "mx.google.com; dmarc=pass header.from=acropora.hu",
            ),
            header("From", '"Kovács Anna" <Anna@Acropora.hu>'),
            header("Subject", "Re: Szűrő hiba"),
            header("Auto-Submitted", "auto-replied"),
            header("Precedence", "bulk"),
            header("List-Id", "<l.example.com>"),
          ],
          mimeType: "text/plain",
          body: { data: b64("A szűrő csöpög.") },
        },
      },
    });
    const message = await new TicketMailGmailClient(fetcher).getMessage("m1");
    assert.equal(message.threadId, "t1");
    assert.equal(message.fromAddress, "anna@acropora.hu");
    assert.equal(message.fromDisplayName, "Kovács Anna");
    assert.equal(message.subject, "Re: Szűrő hiba");
    assert.equal(message.text, "A szűrő csöpög.");
    assert.deepEqual(message.headers, {
      autoSubmitted: "auto-replied",
      precedence: "bulk",
      listId: "<l.example.com>",
      authenticationResults: [
        "mx.google.com; dmarc=fail header.from=acropora.hu",
        "mx.google.com; dmarc=pass header.from=acropora.hu",
      ],
    });
    assert.equal(message.receivedAt?.getTime(), 1790000000000);
  });

  it("falls back to the HTML part's text when there is no plain part", async () => {
    const { fetcher } = fakeGmail({
      message: {
        id: "m2",
        payload: {
          headers: [],
          mimeType: "text/html",
          body: { data: b64("<p>Csöpög <b>a cső</b></p>") },
        },
      },
    });
    const message = await new TicketMailGmailClient(fetcher).getMessage("m2");
    assert.match(message.text, /Csöpög/);
    assert.doesNotMatch(message.text, /<p>/);
  });

  it("keeps a PDF, a JPEG and a PNG by their content, and downloads those by attachment id", async () => {
    const { fetcher, calls } = fakeGmail({
      attachments: { a1: b64(PNG), a2: b64(JPEG) },
      message: {
        id: "m3",
        payload: {
          headers: [],
          parts: [
            { mimeType: "text/plain", body: { data: b64("Lásd a képeket.") } },
            {
              mimeType: "image/png",
              filename: "csepeg.png",
              body: { attachmentId: "a1", size: PNG.length },
            },
            {
              mimeType: "image/jpeg",
              filename: "szuro.jpg",
              body: { attachmentId: "a2", size: JPEG.length },
            },
            {
              mimeType: "application/pdf",
              filename: "lap.pdf",
              body: { data: b64(PDF), size: PDF.length },
            },
          ],
        },
      },
    });
    const message = await new TicketMailGmailClient(fetcher).getMessage("m3");
    assert.deepEqual(
      message.attachments.map((a) => a.fileName),
      ["csepeg.png", "szuro.jpg", "lap.pdf"],
    );
    assert.deepEqual(message.droppedAttachments, []);
    assert.equal(
      calls.filter((c) => c.url.pathname.includes("/attachments/")).length,
      2,
    );
  });

  it("with attachments: false the same message is read, the headers and text are kept, and NO attachment is downloaded or listed", async () => {
    const { fetcher, calls } = fakeGmail({
      attachments: { a1: b64(PNG) },
      message: {
        id: "m9",
        payload: {
          headers: [header("From", "Anna <anna@acropora.hu>")],
          parts: [
            { mimeType: "text/plain", body: { data: b64("Szöveg.") } },
            {
              mimeType: "image/png",
              filename: "csepeg.png",
              body: { attachmentId: "a1", size: PNG.length },
            },
          ],
        },
      },
    });
    const message = await new TicketMailGmailClient(fetcher).getMessage("m9", {
      attachments: false,
    });
    assert.equal(message.fromAddress, "anna@acropora.hu");
    assert.equal(message.text, "Szöveg.");
    assert.deepEqual(message.attachments, []);
    assert.deepEqual(message.droppedAttachments, []);
    assert.equal(
      calls.filter((c) => c.url.pathname.includes("/attachments/")).length,
      0,
    );
  });

  it("CONTROL: a file whose declared type and content disagree, and an unknown type, are dropped as TYPE, never kept", async () => {
    const { fetcher } = fakeGmail({
      attachments: {
        b1: b64("ez nem kep, csak szoveg"),
        b2: b64(Buffer.from("PK\u0003\u0004zip")),
      },
      message: {
        id: "m4",
        payload: {
          headers: [],
          parts: [
            {
              mimeType: "image/png",
              filename: "hamis.png",
              body: { attachmentId: "b1", size: 20 },
            },
            {
              mimeType: "application/zip",
              filename: "arch.zip",
              body: { attachmentId: "b2", size: 10 },
            },
          ],
        },
      },
    });
    const message = await new TicketMailGmailClient(fetcher).getMessage("m4");
    assert.deepEqual(message.attachments, []);
    assert.deepEqual(message.droppedAttachments, [
      { fileName: "hamis.png", reason: "TYPE" },
      { fileName: "arch.zip", reason: "TYPE" },
    ]);
  });

  it("CONTROL: a file declared over the size limit is dropped as TOO_LARGE and not downloaded", async () => {
    const { fetcher, calls } = fakeGmail({
      message: {
        id: "m5",
        payload: {
          headers: [],
          parts: [
            {
              mimeType: "image/png",
              filename: "nagy.png",
              body: { attachmentId: "x", size: 11 * 1024 * 1024 },
            },
          ],
        },
      },
    });
    const message = await new TicketMailGmailClient(fetcher).getMessage("m5");
    assert.deepEqual(message.droppedAttachments, [
      { fileName: "nagy.png", reason: "TOO_LARGE" },
    ]);
    assert.equal(
      calls.filter((c) => c.url.pathname.includes("/attachments/")).length,
      0,
    );
  });

  it("CONTROL: more than the file-count limit are dropped as LIMIT, the first ten kept", async () => {
    const parts = Array.from({ length: 12 }, (_, i) => ({
      mimeType: "image/png",
      filename: `k${i}.png`,
      body: { data: b64(PNG), size: PNG.length },
    }));
    const { fetcher } = fakeGmail({
      message: { id: "m6", payload: { headers: [], parts } },
    });
    const message = await new TicketMailGmailClient(fetcher).getMessage("m6");
    assert.equal(message.attachments.length, 10);
    assert.deepEqual(
      message.droppedAttachments.map((d) => d.reason),
      ["LIMIT", "LIMIT"],
    );
  });

  it("CONTROL: two From headers are no sender (fail closed), however the first one reads", async () => {
    const { fetcher } = fakeGmail({
      message: {
        id: "m8",
        payload: {
          headers: [
            header("From", "anna@acropora.hu"),
            header("From", "evil@tamado.hu"),
          ],
          mimeType: "text/plain",
          body: { data: b64("x") },
        },
      },
    });
    const message = await new TicketMailGmailClient(fetcher).getMessage("m8");
    assert.equal(message.from, null);
    assert.equal(message.fromAddress, null);
  });

  it("CONTROL: an attachment-less mail with a missing From has no sender address", async () => {
    const { fetcher } = fakeGmail({
      message: {
        id: "m7",
        payload: {
          headers: [],
          mimeType: "text/plain",
          body: { data: b64("x") },
        },
      },
    });
    const message = await new TicketMailGmailClient(fetcher).getMessage("m7");
    assert.equal(message.from, null);
    assert.equal(message.fromAddress, null);
  });

  it("answers an HTTP error with a fixed code, never the response text", async () => {
    for (const [status, code] of [
      [401, "TICKET_MAIL_GMAIL_AUTH_FAILED"],
      [403, "TICKET_MAIL_GMAIL_AUTH_FAILED"],
      [429, "TICKET_MAIL_GMAIL_RATE_LIMITED"],
      [500, "TICKET_MAIL_GMAIL_HTTP_500"],
    ] as const) {
      const { fetcher } = fakeGmail({ fail: status });
      await assert.rejects(
        new TicketMailGmailClient(fetcher).listMessageIds(),
        (error: Error) => {
          assert.equal(error.message, code);
          assert.doesNotMatch(error.message, /secret|refresh/);
          return true;
        },
      );
    }
  });

  it("refuses to run unconfigured, before any request", async () => {
    delete process.env.GMAIL_TICKET_READ_REFRESH_TOKEN;
    const { fetcher, calls } = fakeGmail({});
    await assert.rejects(
      new TicketMailGmailClient(fetcher).listMessageIds(),
      /TICKET_MAIL_GMAIL_NOT_CONFIGURED/,
    );
    assert.equal(calls.length, 0);
  });
});
