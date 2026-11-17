import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { main, parseArguments } from "./ticket-mail-auth-measure.cli.js";
import { TicketMailGmailError } from "./ticket-mail-gmail.client.js";
import {
  headerShape,
  maskHeader,
  measureMessage,
  summarizeRun,
} from "./ticket-mail-auth-measure.js";

/**
 * THE AUTHENTICATION-RESULTS MEASUREMENT (task t-20261117-authres-mero, card ec7b947b).
 *
 * WHAT TURNS RED: a printed line that carries an e-mail address (local part), an IP address, the Gmail id, a subject or a name; a header that is
 * read as another shape than the intake's rule reads it (the measure uses the intake's own parser and verdict, so the two cannot drift); a summary
 * that miscounts; an argument check that lets a bad limit or an over-long query through.
 */
const PASS =
  "mx.google.com; dkim=pass header.i=@acropora.hu header.s=g; spf=pass (google.com: domain of anna.kovacs@acropora.hu designates 209.85.220.41 as permitted sender) smtp.mailfrom=anna.kovacs@acropora.hu; dmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=acropora.hu";
const FAIL =
  "mx.google.com; dkim=fail header.i=@acropora.hu; spf=fail smtp.mailfrom=anna.kovacs@acropora.hu; dmarc=fail (p=REJECT sp=REJECT dis=REJECT) header.from=acropora.hu";
const HEADERS = {
  autoSubmitted: null,
  precedence: null,
  listId: null,
};

const measure = (authenticationResults: string[], fromAddress: string | null) =>
  measureMessage({
    id: "18c2f0a1b3d4e5f6",
    fromAddress,
    ownAddress: "ticket@acropora.hu",
    headers: { ...HEADERS, authenticationResults },
  });

describe("maskHeader", () => {
  it("masks the local part of an address and keeps its domain", () => {
    const masked = maskHeader(PASS);
    assert.ok(!masked.includes("anna.kovacs"));
    assert.ok(masked.includes("***@acropora.hu"));
  });
  it("masks IPv4 and IPv6 addresses", () => {
    const masked = maskHeader(
      "mx.google.com; spf=pass (client-ip=209.85.220.41; 2a00:1450:4864:20::32a)",
    );
    assert.ok(!masked.includes("209.85"));
    assert.ok(!masked.includes("2a00"));
    assert.equal(masked.match(/\[ip\]/g)?.length, 2);
  });
  it("masks an address written with a quoted local part (the trick that hides a plain address pattern)", () => {
    const masked = maskHeader(
      'mx.google.com; spf=pass smtp.mailfrom="anna kovacs"@acropora.hu',
    );
    assert.ok(!masked.includes("anna"));
  });
  it("masks a quoted local part that holds an escaped quote (barracuda, #2660)", () => {
    const masked = maskHeader(
      'mx.google.com; spf=pass smtp.mailfrom="secretname\\"tail"@tamado.hu',
    );
    assert.ok(!masked.includes("secretname"));
    assert.ok(!masked.includes("tail"));
    assert.ok(masked.includes("***@tamado.hu"));
  });
  it("cuts the text at 700 characters and collapses white space", () => {
    const masked = maskHeader(`mx.google.com;\r\n\t${"a".repeat(2000)}`);
    assert.equal(masked.length, 700);
    assert.ok(!/[\r\n\t]/.test(masked));
  });
});

describe("headerShape", () => {
  it("reads the authserv-id, the methods and the domains of a typical Gmail header", () => {
    const shape = headerShape(PASS);
    assert.equal(shape.authservId, "mx.google.com");
    assert.deepEqual(
      shape.entries.map((e) => [e.method, e.result]),
      [
        ["dkim", "pass"],
        ["spf", "pass"],
        ["dmarc", "pass"],
      ],
    );
    assert.equal(shape.entries[2]!.headerFrom, "acropora.hu");
    // the envelope sender is an address: only its domain is kept
    assert.equal(shape.entries[1]!.headerD, null);
    assert.equal(shape.entries[0]!.headerD, null);
  });
  it("keeps only the domain of a value that is an address", () => {
    const shape = headerShape(
      "mx.google.com; dkim=pass header.d=acropora.hu header.from=anna@acropora.hu",
    );
    assert.equal(shape.entries[0]!.headerD, "acropora.hu");
    assert.equal(shape.entries[0]!.headerFrom, "acropora.hu");
  });
  it("a malformed header has no authserv-id and no entries, and still has the masked text", () => {
    const shape = headerShape("mx.google.com; this is (not closed");
    assert.equal(shape.authservId, null);
    assert.deepEqual(shape.entries, []);
    assert.ok(shape.masked.length > 0);
  });
  it("a foreign authserv-id that is an address is masked, not printed", () => {
    const shape = headerShape(
      "victim@example.com; dmarc=pass header.from=acropora.hu",
    );
    assert.ok(!(shape.authservId ?? "").includes("victim"));
  });
});

describe("measureMessage", () => {
  it("a verified colleague: the rule's verdict, the header count and the sender's domain", () => {
    const item = measure([PASS], "anna.kovacs@acropora.hu");
    assert.equal(item.verdict.verified, true);
    assert.equal(item.verdict.reason, "DMARC_PASS");
    assert.equal(item.headerCount, 1);
    assert.equal(item.fromDomain, "acropora.hu");
    assert.equal(item.skip, null);
  });
  it("a failing header is not verified, with the rule's own reason", () => {
    const item = measure([FAIL], "anna.kovacs@acropora.hu");
    assert.equal(item.verdict.verified, false);
    assert.notEqual(item.verdict.reason, "DMARC_PASS");
  });
  it("no header at all is not verified (the form the intake would meet on a mail without one)", () => {
    const item = measure([], "anna.kovacs@acropora.hu");
    assert.equal(item.verdict.verified, false);
    assert.equal(item.headerCount, 0);
  });
  it("a machine's mail shows its skip reason", () => {
    assert.equal(measure([PASS], "no-reply@acropora.hu").skip, "NO_REPLY");
    assert.equal(measure([PASS], "ticket@acropora.hu").skip, "OWN_ADDRESS");
    assert.equal(measure([PASS], null).skip, "NO_FROM");
  });
  it("PRIVACY: the printed line carries no address, no IP, no Gmail id and no name", () => {
    const line = JSON.stringify(
      measure([PASS, FAIL], "anna.kovacs@acropora.hu"),
    );
    assert.ok(!line.includes("anna"));
    assert.ok(!line.includes("kovacs"));
    assert.ok(!/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/.test(line));
    assert.ok(!line.includes("18c2f0a1b3d4e5f6"));
    assert.ok(!/@(?!acropora\.hu)/.test(line.replace(/\*\*\*@/g, "")));
  });
  it("the id hash is stable for one id and differs for two", () => {
    const a = measure([PASS], "anna.kovacs@acropora.hu");
    const b = measure([PASS], "anna.kovacs@acropora.hu");
    const other = measureMessage({
      id: "another-id",
      fromAddress: "anna.kovacs@acropora.hu",
      ownAddress: "ticket@acropora.hu",
      headers: { ...HEADERS, authenticationResults: [PASS] },
    });
    assert.equal(a.idHash, b.idHash);
    assert.notEqual(a.idHash, other.idHash);
    assert.equal(a.idHash.length, 8);
    // a hash, not the first characters of the id
    assert.ok(!"18c2f0a1b3d4e5f6".startsWith(a.idHash));
  });
});

describe("summarizeRun", () => {
  it("counts messages, verified ones, reasons, header counts and authserv-ids", () => {
    const summary = summarizeRun([
      measure([PASS], "anna.kovacs@acropora.hu"),
      measure([PASS, PASS], "anna.kovacs@acropora.hu"),
      measure([FAIL], "anna.kovacs@acropora.hu"),
      measure([], "anna.kovacs@acropora.hu"),
    ]);
    assert.equal(summary.messages, 4);
    assert.equal(summary.verified, 2);
    assert.deepEqual(summary.byHeaderCount, { "0": 1, "1": 2, "2": 1 });
    assert.equal(summary.authservIds["mx.google.com"], 4);
    assert.equal(
      Object.values(summary.byReason).reduce((a, b) => a + b, 0),
      4,
    );
  });
  it("an empty run is zeros, not an error", () => {
    assert.deepEqual(summarizeRun([]), {
      messages: 0,
      verified: 0,
      byReason: {},
      byHeaderCount: {},
      authservIds: {},
    });
  });
});

describe("parseArguments", () => {
  it("defaults to ten messages and the mailbox query", () => {
    assert.deepEqual(parseArguments([]), { limit: 10, query: null });
  });
  it("reads --limit and --query", () => {
    assert.deepEqual(
      parseArguments(["--limit", "3", "--query", "newer_than:2d in:anywhere"]),
      { limit: 3, query: "newer_than:2d in:anywhere" },
    );
  });
  it("CONTROL: a limit outside 1 to 50, a fraction, a missing value, an over-long query and an unknown argument are refused", () => {
    for (const bad of [
      ["--limit", "0"],
      ["--limit", "51"],
      ["--limit", "2.5"],
      ["--limit"],
      ["--query"],
      ["--query", "x".repeat(301)],
      ["--send"],
    ])
      assert.throws(() => parseArguments(bad), Error, bad.join(" "));
  });
});

describe("main (the printed output, with a fake mailbox)", () => {
  const KEYS = [
    "GMAIL_TICKET_READ_CLIENT_ID",
    "GMAIL_TICKET_READ_CLIENT_SECRET",
    "GMAIL_TICKET_READ_REFRESH_TOKEN",
    "GMAIL_TICKET_READ_QUERY",
    "GMAIL_TICKET_READ_USER",
  ] as const;
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  const restore = () => {
    for (const k of KEYS)
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
  };
  const configure = () => {
    process.env.GMAIL_TICKET_READ_CLIENT_ID = "id-secret-1";
    process.env.GMAIL_TICKET_READ_CLIENT_SECRET = "secret-secret-2";
    process.env.GMAIL_TICKET_READ_REFRESH_TOKEN = "refresh-secret-3";
    delete process.env.GMAIL_TICKET_READ_USER;
  };
  const message = (id: string) => ({
    id,
    fromAddress: "anna.kovacs@acropora.hu",
    headers: { ...HEADERS, authenticationResults: [PASS] },
  });
  const fake = (ids: string[], failWith?: unknown) => {
    const out: string[] = [];
    const err: string[] = [];
    const calls = { list: 0, get: [] as string[] };
    return {
      out,
      err,
      calls,
      io: {
        client: {
          listMessageIds: async () => {
            calls.list++;
            if (failWith) throw failWith;
            return ids;
          },
          getMessage: async (id: string) => {
            calls.get.push(id);
            return message(id) as never;
          },
        },
        log: (line: string) => out.push(line),
        error: (line: string) => err.push(line),
      },
    };
  };

  it("not configured: names the EMPTY variables (never a value), exit 3, no mailbox call", async () => {
    try {
      for (const k of KEYS) delete process.env[k];
      process.env.GMAIL_TICKET_READ_CLIENT_ID = "id-secret-1";
      const f = fake(["m1"]);
      assert.equal(await main([], f.io), 3);
      assert.equal(f.calls.list, 0);
      const text = f.err.join("\n");
      assert.ok(text.includes("GMAIL_TICKET_READ_CLIENT_SECRET"));
      assert.ok(text.includes("GMAIL_TICKET_READ_REFRESH_TOKEN"));
      assert.ok(!text.includes("id-secret-1"));
    } finally {
      restore();
    }
  });

  it("prints one line per message and a summary, and nothing personal or secret", async () => {
    try {
      configure();
      const f = fake(["m1", "m2"]);
      assert.equal(await main([], f.io), 0);
      assert.equal(f.out.length, 3);
      assert.ok(f.out[0]!.startsWith("AUTH-MEASURE {"));
      assert.ok(f.out[2]!.startsWith("AUTH-MEASURE-SUMMARY {"));
      const all = f.out.join("\n");
      assert.ok(all.includes('"mailboxDomain":"acropora.hu"'));
      assert.ok(!all.includes("anna"));
      assert.ok(!all.includes("ticket@"));
      assert.ok(!all.includes("secret"));
      assert.ok(!/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/.test(all));
    } finally {
      restore();
    }
  });

  it("reads at most --limit messages and sets the query for the run", async () => {
    try {
      configure();
      const f = fake(["m1", "m2", "m3", "m4", "m5"]);
      assert.equal(
        await main(["--limit", "2", "--query", "newer_than:2d"], f.io),
        0,
      );
      assert.deepEqual(f.calls.get, ["m1", "m2"]);
      assert.equal(process.env.GMAIL_TICKET_READ_QUERY, "newer_than:2d");
    } finally {
      restore();
    }
  });

  it("a failed read prints only the client's fixed code, never the error text", async () => {
    try {
      configure();
      const coded = fake(
        [],
        new TicketMailGmailError("TICKET_MAIL_GMAIL_AUTH_FAILED"),
      );
      assert.equal(await main([], coded.io), 1);
      assert.deepEqual(coded.err, [
        "read failed: TICKET_MAIL_GMAIL_AUTH_FAILED",
      ]);
      const other = fake([], new Error("Bearer ya29.secret-token leaked"));
      assert.equal(await main([], other.io), 1);
      assert.deepEqual(other.err, ["read failed: UNKNOWN"]);
    } finally {
      restore();
    }
  });

  it("a bad argument is exit 2 and the mailbox is not called", async () => {
    const f = fake(["m1"]);
    assert.equal(await main(["--limit", "0"], f.io), 2);
    assert.equal(f.calls.list, 0);
  });
});
