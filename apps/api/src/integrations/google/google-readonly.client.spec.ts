import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  GOOGLE_PDF_MAX_BYTES,
  GoogleReadonlyClient,
  GoogleReadonlyError,
} from "./google-readonly.client.js";

function base64Url(value: string | Buffer): string {
  return Buffer.from(value)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

const SETTINGS = {
  credentials: { clientId: "c", clientSecret: "s", refreshToken: "r" },
  gmailApiUrl: "https://gmail.test/gmail/v1",
  driveApiUrl: "https://drive.test/drive/v3",
  tokenUrl: "https://oauth.test/token",
};

function client(
  routes: (url: URL) => Response | undefined,
  requested: string[] = [],
) {
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    requested.push(url.pathname + url.search);
    if (url.href === SETTINGS.tokenUrl)
      return Response.json({ access_token: "access", expires_in: 3600 });
    return routes(url) ?? new Response("{}", { status: 404 });
  };
  return new GoogleReadonlyClient(SETTINGS, fetcher);
}

// Ami pirosít: ha a kliens rögzített fiókot olvasna a paraméter helyett; ha a
// nevében PDF-nek látszó octet-stream melléklet kimaradna; ha egy túl nagy
// melléklet az egész levelet megállítaná; ha a mappa-azonosító szűretlenül a
// Drive-keresésbe kerülne; ha a hiba a válasz szövegét vinné a naplóba.
describe("GoogleReadonlyClient", () => {
  it("reads the mailbox it is given, and takes a PDF by its name too", async () => {
    const requested: string[] = [];
    const google = client((url) => {
      if (url.pathname.endsWith("/messages/m-1"))
        return Response.json({
          id: "m-1",
          internalDate: "1790000000000",
          payload: {
            headers: [
              { name: "From", value: "Szállító Kft. <Szamla@Szallito.HU>" },
              { name: "Subject", value: "Számla" },
            ],
            parts: [
              { mimeType: "text/plain", body: { data: base64Url("szia") } },
              {
                mimeType: "application/octet-stream",
                filename: "SZ-1.pdf",
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
        return Response.json({ data: base64Url("%PDF-1.4 szamla") });
    }, requested);
    const message = await google.gmailPdfMessage("balazs@acropora.hu", "m-1");
    assert.deepEqual(
      [
        message.sender,
        message.pdfs.map((pdf) => [pdf.fileName, pdf.buffer.toString()]),
      ],
      ["szamla@szallito.hu", [["SZ-1.pdf", "%PDF-1.4 szamla"]]],
    );
    assert.ok(
      requested.some((path) =>
        path.startsWith("/gmail/v1/users/balazs%40acropora.hu/messages/m-1"),
      ),
    );
  });

  it("skips a too large attachment but keeps the rest of the mail", async () => {
    const google = client((url) => {
      if (url.pathname.endsWith("/messages/m-2"))
        return Response.json({
          id: "m-2",
          payload: {
            parts: [
              {
                filename: "nagy.pdf",
                mimeType: "application/pdf",
                body: { attachmentId: "big", size: GOOGLE_PDF_MAX_BYTES + 1 },
              },
              {
                filename: "kicsi.pdf",
                mimeType: "application/pdf",
                body: { data: base64Url("%PDF-1.4") },
              },
            ],
          },
        });
    });
    const message = await google.gmailPdfMessage("info@acropora.hu", "m-2");
    assert.deepEqual(
      [message.pdfs.map((pdf) => pdf.fileName), message.skippedTooLarge],
      [["kicsi.pdf"], 1],
    );
  });

  it("lists a Drive folder's PDFs by a checked folder id, page by page", async () => {
    const requested: string[] = [];
    const google = client((url) => {
      if (url.pathname === "/drive/v3/files")
        return url.searchParams.get("pageToken")
          ? Response.json({ files: [{ id: "f-2", name: "b.pdf" }] })
          : Response.json({
              files: [
                {
                  id: "f-1",
                  name: "a.pdf",
                  modifiedTime: "2026-09-30T10:00:00Z",
                  size: "1234",
                },
              ],
              nextPageToken: "p2",
            });
    }, requested);
    const files = await google.driveFolderPdfs(
      "1YKyszRhtpaGh4302QYFielF5wjQi4oHI",
    );
    assert.deepEqual(
      files.map((file) => [file.id, file.sizeBytes]),
      [
        ["f-1", 1234],
        ["f-2", null],
      ],
    );
    const query = new URL(`https://x${requested[1]}`).searchParams.get("q");
    assert.equal(
      query,
      "'1YKyszRhtpaGh4302QYFielF5wjQi4oHI' in parents and mimeType = 'application/pdf' and trashed = false",
    );
    await assert.rejects(
      google.driveFolderPdfs("x' or name contains 'a"),
      (error: unknown) =>
        error instanceof GoogleReadonlyError &&
        error.code === "GOOGLE_DRIVE_FOLDER_ID_INVALID",
    );
  });

  it("fails with a code, never with the response text", async () => {
    const google = client(
      () =>
        new Response('{"error":"secret detail refresh_token=abc"}', {
          status: 403,
        }),
    );
    await assert.rejects(
      google.gmailMessageIds("info@acropora.hu", "has:attachment"),
      (error: unknown) =>
        error instanceof GoogleReadonlyError &&
        error.message === "GOOGLE_AUTH_FAILED",
    );
  });
});

/*
  A 403 NEM MIND HITELESÍTÉSI HIBA (Balázs éles próbája, 2026-10-01: az info@ és
  a balazs@ egy perc munka után GOOGLE_AUTH_FAILED-del állt le, pedig a kulcs jó
  volt). MI PIROSÍT: ha a rate-limit 403 (bármelyik ismert törzs-alakban)
  hitelesítési hibának számítana; ha egy valódi jogosultsági 403, egy üres
  vagy nem JSON törzs rate limitnek; ha nem lenne újrapróba, vagy korlátlan
  lenne; ha a Retry-After nem számítana.
*/
describe("GoogleReadonlyClient, a 403 és a 429", () => {
  const forbidden = (body: unknown) =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  const rateLimitBody = {
    error: {
      code: 403,
      message: "Rate Limit Exceeded",
      errors: [{ domain: "usageLimits", reason: "rateLimitExceeded" }],
    },
  };
  const make = (answers: Array<() => Response>) => {
    const sleeps: number[] = [];
    let calls = 0;
    const fetcher: typeof fetch = async (input) => {
      const url = new URL(String(input));
      if (url.href === SETTINGS.tokenUrl)
        return Response.json({ access_token: "access", expires_in: 3600 });
      const next = answers[Math.min(calls, answers.length - 1)]!;
      calls++;
      return next();
    };
    const google = new GoogleReadonlyClient(
      {
        ...SETTINGS,
        rateLimitDelaysMs: [10, 20, 40],
        sleep: async (ms) => {
          sleeps.push(ms);
        },
      },
      fetcher,
    );
    return { google, sleeps, calls: () => calls };
  };
  const ids = (google: GoogleReadonlyClient) =>
    google.gmailMessageIds("info@acropora.hu", "has:attachment");
  const code = async (promise: Promise<unknown>) => {
    try {
      await promise;
      return "ok";
    } catch (error) {
      return error instanceof GoogleReadonlyError ? error.code : String(error);
    }
  };

  it("a rate-limit 403 is waited out and retried", async () => {
    const t = make([
      () => forbidden(rateLimitBody),
      () => Response.json({ messages: [{ id: "m-1" }] }),
    ]);
    assert.deepEqual(await ids(t.google), ["m-1"]);
    assert.deepEqual(t.sleeps, [10]);
    assert.equal(t.calls(), 2);
  });

  it("the newer body shape (details[].reason) and userRateLimitExceeded count too", async () => {
    for (const body of [
      {
        error: {
          code: 403,
          status: "PERMISSION_DENIED",
          details: [{ reason: "RATE_LIMIT_EXCEEDED" }],
        },
      },
      { error: { code: 403, errors: [{ reason: "userRateLimitExceeded" }] } },
    ]) {
      const t = make([
        () => forbidden(body),
        () => Response.json({ messages: [] }),
      ]);
      assert.deepEqual(await ids(t.google), []);
      assert.equal(t.calls(), 2);
    }
  });

  it("a rate limit that does not end: bounded retries, then GOOGLE_RATE_LIMITED", async () => {
    const t = make([() => forbidden(rateLimitBody)]);
    assert.equal(await code(ids(t.google)), "GOOGLE_RATE_LIMITED");
    assert.deepEqual(t.sleeps, [10, 20, 40]);
    assert.equal(t.calls(), 4);
  });

  it("a real permission 403, an empty or non-JSON body: GOOGLE_AUTH_FAILED, no retry", async () => {
    for (const body of [
      { error: { code: 403, errors: [{ reason: "insufficientPermissions" }] } },
      "",
      "<html>Forbidden</html>",
    ]) {
      const t = make([() => forbidden(body)]);
      assert.equal(await code(ids(t.google)), "GOOGLE_AUTH_FAILED");
      assert.equal(t.calls(), 1);
      assert.deepEqual(t.sleeps, []);
    }
  });

  it("a 401 stays GOOGLE_AUTH_FAILED", async () => {
    const t = make([() => new Response("{}", { status: 401 })]);
    assert.equal(await code(ids(t.google)), "GOOGLE_AUTH_FAILED");
    assert.equal(t.calls(), 1);
  });

  /*
    A MEGÁLLÁS MÉRT OKA (acrobot 25629). MI PIROSÍT: ha a végső hiba nem vinné a
    Google okát, tartományát és a Retry-After értékeket; ha szabad szöveg (a
    hibaüzenet, egy nem azonosító alakú ok) a naplóba jutna.
  */
  const detail = async (promise: Promise<unknown>) => {
    try {
      await promise;
      return "ok";
    } catch (error) {
      return error instanceof GoogleReadonlyError
        ? error.detail
        : String(error);
    }
  };

  it("the final rate-limit error names Google's reason, domain and the retry times", async () => {
    const t = make([
      () =>
        new Response(
          JSON.stringify({
            error: {
              code: 403,
              message:
                "User-rate limit exceeded.  Retry after 2026-10-01T09:30:00.123Z (info@acropora.hu)",
              errors: [
                { domain: "usageLimits", reason: "userRateLimitExceeded" },
                { domain: "global", reason: "free text, not an id" },
              ],
            },
          }),
          { status: 403, headers: { "Retry-After": "30" } },
        ),
    ]);
    assert.equal(
      await detail(ids(t.google)),
      "403 userRateLimitExceeded usageLimits+global retry-after=30 retry-at=2026-10-01T09:30:00.123Z",
    );
  });

  it("a permission 403 carries its reason too, and a 429 without a body its status", async () => {
    const forbiddenT = make([
      () =>
        forbidden({ error: { errors: [{ reason: "dailyLimitExceeded" }] } }),
    ]);
    assert.equal(
      await detail(ids(forbiddenT.google)),
      "403 dailyLimitExceeded -",
    );
    const tooMany = make([() => new Response("{}", { status: 429 })]);
    assert.equal(await detail(ids(tooMany.google)), "429 - -");
  });

  it("a 429 is retried, and Retry-After is honoured up to 10 seconds", async () => {
    const t = make([
      () =>
        new Response("{}", { status: 429, headers: { "Retry-After": "3" } }),
      () =>
        new Response("{}", { status: 429, headers: { "Retry-After": "60" } }),
      () => Response.json({ messages: [] }),
    ]);
    assert.deepEqual(await ids(t.google), []);
    assert.deepEqual(t.sleeps, [3_000, 10_000]);
  });
});

/*
  A KÉRÉSEK KÖZÖTT SZÜNET (acrobot 25605, éles 2026-10-01: a szünet nélküli
  letöltés a Gmail kvótájába futott). MI PIROSÍT: ha két egymás utáni API-kérés
  között nem várna; ha a már eltelt időt nem számítaná be; ha a token-kérés is
  várna; ha alapból (a beállítás nélkül) is lassítana.
*/
describe("GoogleReadonlyClient pacing", () => {
  const listing = () => Response.json({ messages: [{ id: "m" }] });
  const make = (gap: number | undefined, clock: number[]) => {
    const sleeps: number[] = [];
    let tick = 0;
    const fetcher: typeof fetch = async (input) =>
      String(input) === SETTINGS.tokenUrl
        ? Response.json({ access_token: "access", expires_in: 3600 })
        : listing();
    const google = new GoogleReadonlyClient(
      {
        ...SETTINGS,
        requestGapMs: gap,
        now: () => clock[Math.min(tick++, clock.length - 1)]!,
        sleep: async (ms) => {
          sleeps.push(ms);
        },
      },
      fetcher,
    );
    return { google, sleeps };
  };

  it("waits out the gap between two requests, counting the time already gone", async () => {
    // óra-olvasások: 1. kérés bélyege; 2. kérés: döntés 100 ms múlva (150-et
    // vár), bélyeg a várakozás után; 3. kérés 400 ms-mal később: nem vár
    const t = make(250, [1_000, 1_100, 1_250, 1_650, 1_650]);
    for (let i = 0; i < 3; i++) await t.google.gmailMessageIds("a@b.hu", "q");
    assert.deepEqual(t.sleeps, [150]);
  });

  it("no gap set: no waiting", async () => {
    const t = make(undefined, [1_000]);
    for (let i = 0; i < 3; i++) await t.google.gmailMessageIds("a@b.hu", "q");
    assert.deepEqual(t.sleeps, []);
  });
});
