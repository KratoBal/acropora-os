import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { GmailSentMailbox, SentMailboxError } from "./gmail-sent-mailbox.js";

/*
  THE SENDER'S OWN SENT MAILBOX (card jatek-level-torles), with no network: the fetch is a double. What turns this red:
  a scope read the wrong way (gmail.modify taken for a permanent delete, gmail.send for any removal); a failed token
  exchange thrown instead of named; a search that trusts Gmail's loose subject match, takes a mail sent after the
  limit, one already in the Trash, or one not sent; a mail body read (only format=metadata); a batch over Gmail's
  1000-id limit; a Trash call on a mail gone already counted as a failure, a real failure swallowed.
*/
const SUBJECT = "Erősítsd meg a játékodat: Acropora karácsonyi nyereményjáték";
const ENV = {
  GMAIL_TICKET_CLIENT_ID: "kitalalt-kliens",
  GMAIL_TICKET_CLIENT_SECRET: "kitalalt-titok",
  GMAIL_TICKET_REFRESH_TOKEN: "kitalalt-frissito",
  GMAIL_API_URL: "https://gmail.teszt/v1",
  GOOGLE_OAUTH_TOKEN_URL: "https://token.teszt",
};
const BEFORE = new Date("2026-11-14T20:00:00Z");

function mailbox(
  over: {
    scope?: string;
    tokenStatus?: number;
    messages?: Record<string, { subject: string; at: Date; labels: string[] }>;
    trashStatus?: number;
  } = {},
  env: Record<string, string> = ENV,
) {
  const calls: { url: string; method: string; body?: string }[] = [];
  const messages = over.messages ?? {};
  const ids = Object.keys(messages);
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({
      url,
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : undefined,
    });
    if (url === ENV.GOOGLE_OAUTH_TOKEN_URL)
      return over.tokenStatus
        ? new Response("{}", { status: over.tokenStatus })
        : Response.json({
            access_token: "kitalalt-hozzaferes",
            expires_in: 3600,
            scope: over.scope ?? "https://mail.google.com/",
          });
    const path = url.slice(ENV.GMAIL_API_URL.length);
    if (path.startsWith("/users/me/messages?")) {
      // two pages: the first two ids, then the rest
      const page = new URL(url).searchParams.get("pageToken");
      return Response.json(
        page
          ? { messages: ids.slice(2).map((id) => ({ id })) }
          : {
              messages: ids.slice(0, 2).map((id) => ({ id })),
              ...(ids.length > 2 ? { nextPageToken: "p2" } : {}),
            },
      );
    }
    const get = /^\/users\/me\/messages\/([^/?]+)\?/.exec(path);
    if (get) {
      const m = messages[decodeURIComponent(get[1]!)]!;
      return Response.json({
        id: get[1],
        internalDate: String(m.at.getTime()),
        labelIds: m.labels,
        payload: { headers: [{ name: "Subject", value: m.subject }] },
      });
    }
    if (path === "/users/me/messages/batchDelete")
      return new Response(null, { status: 204 });
    if (/\/trash$/.test(path))
      return new Response("{}", { status: over.trashStatus ?? 200 });
    throw new Error(`unknown address: ${url}`);
  }) as typeof fetch;
  return { box: new GmailSentMailbox(fetchImpl, env), calls };
}

describe("the sent mailbox", () => {
  it("reads what the key may do from the scope its token carries", async () => {
    const kind = async (scope: string) =>
      (await mailbox({ scope }).box.capability()).kind;
    assert.equal(await kind("https://mail.google.com/"), "DELETE");
    assert.equal(
      await kind("https://www.googleapis.com/auth/gmail.modify"),
      "TRASH",
    );
    assert.equal(
      await kind("https://www.googleapis.com/auth/gmail.send"),
      "SEND_ONLY",
    );
    assert.equal(
      await kind("https://www.googleapis.com/auth/gmail.readonly"),
      "SEND_ONLY",
    );
    assert.deepEqual(await mailbox({}, {}).box.capability(), {
      kind: "NOT_CONFIGURED",
    });
    assert.deepEqual(await mailbox({ tokenStatus: 400 }).box.capability(), {
      kind: "ERROR",
      code: "SENT_MAILBOX_TOKEN_FAILED_400",
    });
  });

  it("finds only the sent mails with exactly the subject, sent by the limit and not in the Trash, from the headers alone", async () => {
    const { box, calls } = mailbox({
      messages: {
        jo: {
          subject: SUBJECT,
          at: new Date("2026-11-10T10:00:00Z"),
          labels: ["SENT"],
        },
        hasonlo: {
          subject:
            "Erositsd meg a jatekodat: Acropora karacsonyi nyeremenyjatek",
          at: new Date("2026-11-10T10:00:00Z"),
          labels: ["SENT"],
        },
        kesobbi: {
          subject: SUBJECT,
          at: new Date("2026-11-14T20:00:01Z"),
          labels: ["SENT"],
        },
        kukaban: {
          subject: SUBJECT,
          at: new Date("2026-11-10T10:00:00Z"),
          labels: ["SENT", "TRASH"],
        },
        bejovo: {
          subject: SUBJECT,
          at: new Date("2026-11-10T10:00:00Z"),
          labels: ["INBOX"],
        },
      },
    });
    assert.deepEqual(await box.findSent(SUBJECT, BEFORE), ["jo"]);
    const gets = calls.filter((c) => /\/messages\/[^/?]+\?/.test(c.url));
    assert.equal(gets.length, 5);
    assert.ok(gets.every((c) => c.url.includes("format=metadata")));
    const list = calls.find((c) => c.url.includes("/messages?q="))!;
    assert.ok(decodeURIComponent(list.url).includes("in:sent"));
  });

  it("deletes in batches of at most 1000, or trashes one by one; a mail gone already is not a failure, a real failure throws", async () => {
    const many = Array.from({ length: 1001 }, (_, i) => `m${i}`);
    const full = mailbox();
    assert.equal(await full.box.remove(many, "DELETE"), 1001);
    const batches = full.calls.filter((c) => c.url.endsWith("/batchDelete"));
    assert.deepEqual(
      batches.map((c) => (JSON.parse(c.body!) as { ids: string[] }).ids.length),
      [1000, 1],
    );
    const gone = mailbox({ trashStatus: 404 });
    assert.equal(await gone.box.remove(["a", "b"], "TRASH"), 2);
    assert.equal(gone.calls.filter((c) => c.url.endsWith("/trash")).length, 2);
    const broken = mailbox({ trashStatus: 500 });
    await assert.rejects(
      broken.box.remove(["a"], "TRASH"),
      (e: unknown) =>
        e instanceof SentMailboxError &&
        e.code === "SENT_MAILBOX_TRASH_FAILED_500",
    );
  });
});
