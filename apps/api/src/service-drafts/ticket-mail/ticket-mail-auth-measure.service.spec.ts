import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
} from "@nestjs/common";
import { PERMISSIONS } from "@acropora/types";

import {
  REQUIRED_ANY_PERMISSIONS_KEY,
  REQUIRED_PERMISSIONS_KEY,
} from "../../auth/decorators/require-permissions.decorator.js";
import {
  parseMeasureQuery,
  TicketMailAuthMeasureService,
} from "./ticket-mail-auth-measure.service.js";
import { TicketMailGmailError } from "./ticket-mail-gmail.client.js";
import { TicketMailController } from "./ticket-mail.controller.js";

/**
 * THE AUTHENTICATION-RESULTS MEASUREMENT AS A READ-ONLY ENDPOINT (task t-20261117-authres-mero). WHAT TURNS RED: the endpoint open to a role
 * below SERVICE_MANAGE; a limit or query outside the bounds read as defaults; an unconfigured mailbox answered with anything but the NAMES of the
 * empty variables; two measurements at once; a failed read answered with the client's text instead of its fixed code, or leaving the guard locked;
 * the answer carrying an address, a Gmail id, the query or a token; the query written into the process environment.
 */
const PASS =
  "mx.google.com; dkim=pass header.i=@acropora.hu; spf=pass (google.com: domain of anna.kovacs@acropora.hu designates 209.85.220.41 as permitted sender) smtp.mailfrom=anna.kovacs@acropora.hu; dmarc=pass (p=REJECT) header.from=acropora.hu";

const KEYS = [
  "GMAIL_TICKET_READ_CLIENT_ID",
  "GMAIL_TICKET_READ_CLIENT_SECRET",
  "GMAIL_TICKET_READ_REFRESH_TOKEN",
  "GMAIL_TICKET_READ_QUERY",
  "GMAIL_TICKET_READ_USER",
] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
beforeEach(() => {
  for (const k of KEYS) delete process.env[k];
  process.env.GMAIL_TICKET_READ_CLIENT_ID = "id-secret-1";
  process.env.GMAIL_TICKET_READ_CLIENT_SECRET = "secret-secret-2";
  process.env.GMAIL_TICKET_READ_REFRESH_TOKEN = "refresh-secret-3";
});
afterEach(() => {
  for (const k of KEYS)
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
});

function fakeClient(
  ids: string[],
  options: { fail?: unknown; gate?: Promise<void> } = {},
) {
  const calls = { query: undefined as string | undefined, get: 0 };
  const client = {
    listMessageIds: async (query?: string) => {
      calls.query = query;
      if (options.gate) await options.gate;
      if (options.fail) throw options.fail;
      return ids;
    },
    getMessage: async (id: string) => {
      calls.get++;
      return {
        id,
        fromAddress: "anna.kovacs@acropora.hu",
        headers: {
          autoSubmitted: null,
          precedence: null,
          listId: null,
          authenticationResults: [PASS],
        },
      };
    },
  };
  return { client: client as never, calls };
}

describe("parseMeasureQuery", () => {
  it("defaults to five messages and no query", () => {
    assert.deepEqual(parseMeasureQuery({}), { limit: 5, query: null });
  });
  it("reads a limit and a query, and a blank query is no query", () => {
    assert.deepEqual(
      parseMeasureQuery({ limit: "3", query: " newer_than:2d " }),
      {
        limit: 3,
        query: "newer_than:2d",
      },
    );
    assert.equal(parseMeasureQuery({ query: "   " }).query, null);
  });
  it("CONTROL: a limit outside 1 to 20, a fraction, a blank, an array, and a query that is over-long or repeated are refused, never read as defaults", () => {
    for (const bad of [
      { limit: "0" },
      { limit: "21" },
      { limit: "2.5" },
      { limit: "" },
      { limit: "abc" },
      { limit: ["1", "2"] },
      { query: "x".repeat(301) },
      { query: ["a", "b"] },
    ])
      assert.throws(
        () => parseMeasureQuery(bad),
        BadRequestException,
        JSON.stringify(bad),
      );
  });
});

describe("TicketMailAuthMeasureService", () => {
  it("answers the masked measure: the summary, the items, the mailbox DOMAIN, and nothing personal or secret", async () => {
    const { client } = fakeClient(["gmail-id-1", "gmail-id-2"]);
    const result = await new TicketMailAuthMeasureService(client).measure(
      5,
      "from:anna.kovacs@acropora.hu",
    );
    assert.equal(result.mailboxDomain, "acropora.hu");
    assert.equal(result.summary.messages, 2);
    assert.equal(result.items.length, 2);
    const text = JSON.stringify(result);
    for (const leak of [
      "anna",
      "kovacs",
      "ticket@",
      "gmail-id",
      "209.85",
      "secret",
      "from:",
    ])
      assert.ok(!text.includes(leak), `leaked ${leak}`);
  });

  it("hands the limit and the query to the client, and leaves the process environment alone", async () => {
    const { client, calls } = fakeClient(["a", "b", "c"]);
    const result = await new TicketMailAuthMeasureService(client).measure(
      2,
      "newer_than:2d",
    );
    assert.equal(calls.get, 2);
    assert.equal(result.items.length, 2);
    assert.equal(calls.query, "newer_than:2d");
    assert.equal(process.env.GMAIL_TICKET_READ_QUERY, undefined);
  });

  it("unconfigured: 409 with the NAMES of the empty variables, never a value, and no mailbox call", async () => {
    delete process.env.GMAIL_TICKET_READ_CLIENT_SECRET;
    const { client, calls } = fakeClient(["a"]);
    await assert.rejects(
      () => new TicketMailAuthMeasureService(client).measure(5, null),
      (error: ConflictException) => {
        assert.ok(error instanceof ConflictException);
        const body = JSON.stringify(error.getResponse());
        assert.ok(body.includes("GMAIL_TICKET_READ_CLIENT_SECRET"));
        assert.ok(!body.includes("id-secret-1"));
        return true;
      },
    );
    assert.equal(calls.get, 0);
  });

  it("one measurement at a time: a second call while the first runs is 409 at once, and the guard is free again afterwards", async () => {
    let open!: () => void;
    const gate = new Promise<void>((resolve) => (open = resolve));
    const { client } = fakeClient(["a"], { gate });
    const service = new TicketMailAuthMeasureService(client);
    const first = service.measure(5, null);
    try {
      // without the guard the second call would wait on the same gate: the race turns that into a plain failed assertion, not a hung test
      const outcome = await Promise.race([
        service.measure(5, null).then(
          () => "ran",
          (error: unknown) => error,
        ),
        new Promise((resolve) => setTimeout(() => resolve("waited"), 100)),
      ]);
      assert.ok(
        outcome instanceof ConflictException,
        `the second call was not refused: ${String(outcome)}`,
      );
    } finally {
      open();
    }
    await first;
    assert.equal((await service.measure(5, null)).summary.messages, 1);
  });

  it("a failed read is 502 with the client's fixed code only, never its text, and releases the guard", async () => {
    const failing = fakeClient([], {
      fail: new TicketMailGmailError("TICKET_MAIL_GMAIL_AUTH_FAILED"),
    });
    const service = new TicketMailAuthMeasureService(failing.client);
    await assert.rejects(
      () => service.measure(5, null),
      (error: BadGatewayException) => {
        assert.ok(error instanceof BadGatewayException);
        assert.deepEqual(error.getResponse(), {
          code: "TICKET_MAIL_GMAIL_AUTH_FAILED",
        });
        return true;
      },
    );
    // the guard is free: a later call is not 409
    const ok = new TicketMailAuthMeasureService(fakeClient(["a"]).client);
    assert.equal((await ok.measure(5, null)).summary.messages, 1);
    await assert.rejects(
      () => service.measure(5, null),
      (error: unknown) => !(error instanceof ConflictException),
    );
  });
});

describe("TicketMailController guard", () => {
  it("the whole controller needs SERVICE_MANAGE, and the measure route adds no weaker override", () => {
    assert.deepEqual(
      Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, TicketMailController),
      [PERMISSIONS.SERVICE_MANAGE],
    );
    const handler = TicketMailController.prototype.authMeasureRead;
    assert.equal(
      Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, handler),
      undefined,
    );
    assert.equal(
      Reflect.getMetadata(REQUIRED_ANY_PERMISSIONS_KEY, handler),
      undefined,
    );
  });
});

describe("TicketMailController.authMeasureRead", () => {
  it("hands the CHECKED limit and query to the service, the defaults when none is given, and refuses a bad one before the service is called", () => {
    const calls: unknown[][] = [];
    const controller = new TicketMailController(
      {} as never,
      {
        measure: (...args: unknown[]) => {
          calls.push(args);
          return Promise.resolve({});
        },
      } as never,
    );
    controller.authMeasureRead("3", " newer_than:2d ");
    controller.authMeasureRead();
    assert.deepEqual(calls, [
      [3, "newer_than:2d"],
      [5, null],
    ]);
    assert.throws(() => controller.authMeasureRead("99"), BadRequestException);
    assert.equal(calls.length, 2);
  });
});
