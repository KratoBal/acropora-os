import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  FEJLEC_IP,
  FEJLEC_TITOK,
  HAMIS_KERDES,
  UTVONALAK,
  hamisJatekApi,
  httpJatekApi,
  jatekApiKornyezetbol,
  kerdesEllenorzott,
} from "./jatek-api.ts";

/*
  WHAT TURNS THIS RED. A path, a field name or a status that differs from the contract (nautilus, 2026-11-05);
  the visitor's address not passed in X-Forwarded-For; the correct/incorrect answer or "played already" leaking out
  of a result; a gateway's HTML page or a dead connection treated as an answer; the fake api starting in
  production, or an invalid api address falling back to the fake one.
*/
type Hivas = {
  url: string;
  method?: string;
  headers: Record<string, string>;
  body?: string;
};

function hamisFetch(
  valasz: { status: number; body?: unknown; text?: string } | Error,
) {
  const hivasok: Hivas[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    hivasok.push({
      url,
      method: init?.method,
      headers: init?.headers as Record<string, string>,
      body: init?.body as string | undefined,
    });
    if (valasz instanceof Error) throw valasz;
    return new Response(valasz.text ?? JSON.stringify(valasz.body ?? null), {
      status: valasz.status,
    });
  }) as unknown as typeof fetch;
  return { hivasok, fetchImpl };
}

const BEMENET = {
  questionId: "q1",
  email: "j@example.com",
  answer: "a",
  website: "",
};

describe("a szerzodes utvonalai", () => {
  it("are the three /jatek paths", () => {
    assert.deepEqual(UTVONALAK, {
      aktualis: "/jatek/aktualis",
      bekuldes: "/jatek/bekuldes",
      megerosites: "/jatek/megerosites",
    });
  });
});

describe("httpJatekApi.aktualis", () => {
  it("reads the question from GET /jatek/aktualis, and a null question is 'no open question'", async () => {
    const k = { question: HAMIS_KERDES };
    const a = hamisFetch({ status: 200, body: k });
    const eredmeny = await httpJatekApi(
      "https://api.example/",
      a.fetchImpl,
    ).aktualis();
    assert.deepEqual(eredmeny, { ok: true, question: HAMIS_KERDES });
    assert.equal(a.hivasok[0]!.url, "https://api.example/jatek/aktualis");
    assert.equal(a.hivasok[0]!.method, "GET");
    const nincs = hamisFetch({ status: 200, body: { question: null } });
    assert.deepEqual(
      await httpJatekApi("https://api.example", nincs.fetchImpl).aktualis(),
      {
        ok: true,
        question: null,
      },
    );
  });

  it("a malformed question, a gateway page and a dead connection are 'unavailable', never a question", async () => {
    const cases = [
      hamisFetch({ status: 200, body: { question: { id: 1 } } }),
      hamisFetch({ status: 502, text: "<html>Bad Gateway</html>" }),
      hamisFetch(new TypeError("fetch failed")),
    ];
    for (const c of cases) {
      const r = await httpJatekApi(
        "https://api.example",
        c.fetchImpl,
      ).aktualis();
      assert.equal(r.ok, false);
      assert.ok(!r.ok && r.code === "UNAVAILABLE");
    }
  });
});

describe("httpJatekApi.bekuldes", () => {
  it("POSTs the contract's body and forwards the visitor's address; a 202 is accepted", async () => {
    const a = hamisFetch({ status: 202, body: { status: "CHECK_EMAIL" } });
    const r = await httpJatekApi("https://api.example", a.fetchImpl).bekuldes(
      BEMENET,
      "203.0.113.9",
    );
    assert.deepEqual(r, { ok: true });
    const h = a.hivasok[0]!;
    assert.equal(h.url, "https://api.example/jatek/bekuldes");
    assert.equal(h.method, "POST");
    assert.deepEqual(JSON.parse(h.body!), BEMENET);
    assert.equal(h.headers["X-Forwarded-For"], "203.0.113.9");
    assert.equal(h.headers["Content-Type"], "application/json");
  });

  it("sends no X-Forwarded-For when the address is unknown", async () => {
    const a = hamisFetch({ status: 202, body: { status: "CHECK_EMAIL" } });
    await httpJatekApi("https://api.example", a.fetchImpl).bekuldes(
      BEMENET,
      null,
    );
    assert.equal("X-Forwarded-For" in a.hivasok[0]!.headers, false);
  });

  it("an error keeps the api's code and status; a body without a code is 'unavailable'", async () => {
    const hiba = hamisFetch({
      status: 429,
      body: { statusCode: 429, code: "TOO_MANY", message: "Túl sok." },
    });
    assert.deepEqual(
      await httpJatekApi("https://api.example", hiba.fetchImpl).bekuldes(
        BEMENET,
        null,
      ),
      {
        ok: false,
        status: 429,
        code: "TOO_MANY",
        message: "Túl sok.",
      },
    );
    const kapu = hamisFetch({ status: 504, text: "gateway timeout" });
    const r = await httpJatekApi(
      "https://api.example",
      kapu.fetchImpl,
    ).bekuldes(BEMENET, null);
    assert.ok(!r.ok && r.code === "UNAVAILABLE" && r.status === 504);
  });

  it("nothing in the success result says whether the answer was right or whether the address played before", async () => {
    const a = hamisFetch({
      status: 202,
      body: { status: "CHECK_EMAIL", correct: true, alreadyPlayed: true },
    });
    const r = await httpJatekApi("https://api.example", a.fetchImpl).bekuldes(
      BEMENET,
      null,
    );
    assert.deepEqual(Object.keys(r), ["ok"]);
  });
});

describe("a hitelesített fejlécek (nautilus, 2026-11-05 22:58)", () => {
  const TITOK = "proba-titok-nem-valodi";

  it("all three calls carry the proxy secret and the visitor's address under the same names (the GET too: without the address the key falls to the last hop)", async () => {
    const a = hamisFetch({ status: 202, body: { status: "CHECK_EMAIL" } });
    const api = httpJatekApi("https://api.example", a.fetchImpl, TITOK);
    await api.aktualis("203.0.113.9");
    await api.bekuldes(BEMENET, "203.0.113.9");
    await api.megerosites("tok", "203.0.113.9");
    assert.equal(a.hivasok.length, 3);
    for (const h of a.hivasok) assert.equal(h.headers[FEJLEC_TITOK], TITOK);
    assert.equal(FEJLEC_IP, "X-Jatek-Client-IP");
    assert.equal(FEJLEC_TITOK, "X-Jatek-Proxy-Secret");
    for (const h of a.hivasok) {
      assert.equal(h.headers[FEJLEC_IP], "203.0.113.9");
      assert.equal(h.headers["X-Forwarded-For"], "203.0.113.9");
    }
  });

  it("a GET without a known address sends no address header, only the secret", async () => {
    const a = hamisFetch({ status: 200, body: { question: null } });
    await httpJatekApi("https://api.example", a.fetchImpl, TITOK).aktualis(
      null,
    );
    assert.equal(FEJLEC_IP in a.hivasok[0]!.headers, false);
    assert.equal(a.hivasok[0]!.headers[FEJLEC_TITOK], TITOK);
  });

  it("without a secret (or a blank one) no secret header goes out, and the call still works", async () => {
    for (const titok of [undefined, "", "   "]) {
      const a = hamisFetch({ status: 202, body: { status: "CHECK_EMAIL" } });
      const r = await httpJatekApi(
        "https://api.example",
        a.fetchImpl,
        titok,
      ).bekuldes(BEMENET, "203.0.113.9");
      assert.deepEqual(r, { ok: true });
      assert.equal(FEJLEC_TITOK in a.hivasok[0]!.headers, false);
    }
  });

  it("the secret comes from JATEK_PROXY_SECRET of the environment, and never from the page", async () => {
    const a = hamisFetch({ status: 200, body: { question: null } });
    await jatekApiKornyezetbol(
      { JATEK_API_URL: "https://api.example", JATEK_PROXY_SECRET: TITOK },
      a.fetchImpl,
    ).aktualis();
    assert.equal(a.hivasok[0]!.headers[FEJLEC_TITOK], TITOK);
  });
});

describe("httpJatekApi.megerosites", () => {
  it("POSTs the token; CONFIRMED and ALREADY_CONFIRMED are both successes, with the week", async () => {
    for (const status of ["CONFIRMED", "ALREADY_CONFIRMED"] as const) {
      const a = hamisFetch({ status: 200, body: { status, week: "2026-W46" } });
      const r = await httpJatekApi(
        "https://api.example",
        a.fetchImpl,
      ).megerosites("tok-123456789", "203.0.113.9");
      assert.deepEqual(r, { ok: true, status, week: "2026-W46" });
      assert.equal(a.hivasok[0]!.url, "https://api.example/jatek/megerosites");
      assert.deepEqual(JSON.parse(a.hivasok[0]!.body!), {
        token: "tok-123456789",
      });
    }
  });

  it("INVALID_TOKEN and CLOSED keep their codes; a 200 of another shape is not a confirmation", async () => {
    for (const [status, code] of [
      [400, "INVALID_TOKEN"],
      [409, "CLOSED"],
    ] as const) {
      const a = hamisFetch({
        status,
        body: { statusCode: status, code, message: "x" },
      });
      const r = await httpJatekApi(
        "https://api.example",
        a.fetchImpl,
      ).megerosites("tok-123456789", null);
      assert.ok(!r.ok && r.code === code && r.status === status);
    }
    const furcsa = hamisFetch({ status: 200, body: { status: "MASIK" } });
    const r = await httpJatekApi(
      "https://api.example",
      furcsa.fetchImpl,
    ).megerosites("tok-123456789", null);
    assert.equal(r.ok, false);
  });
});

describe("kerdesEllenorzott", () => {
  it("accepts the contract's question, and refuses a choice question with fewer than two options", () => {
    assert.ok(kerdesEllenorzott(HAMIS_KERDES));
    assert.ok(
      kerdesEllenorzott({ ...HAMIS_KERDES, type: "TEXT", options: [] }),
    );
    assert.equal(
      kerdesEllenorzott({
        ...HAMIS_KERDES,
        options: [{ id: "a", label: "A" }],
      }),
      false,
    );
    assert.equal(kerdesEllenorzott({ ...HAMIS_KERDES, type: "MASIK" }), false);
    assert.equal(kerdesEllenorzott(null), false);
  });
});

describe("a hamis api", () => {
  it("is marked as fake, serves the contract's example question, and gives the contract's confirmation results", async () => {
    const api = hamisJatekApi();
    assert.equal(api.hamis, true);
    assert.deepEqual(await api.aktualis(), {
      ok: true,
      question: HAMIS_KERDES,
    });
    assert.deepEqual(await api.bekuldes(BEMENET, null), {
      ok: false,
      status: 404,
      code: "NO_QUESTION",
      message: "",
    });
    assert.deepEqual(
      await api.bekuldes({ ...BEMENET, questionId: HAMIS_KERDES.id }, null),
      { ok: true },
    );
    const ok = await api.megerosites("proba-token-ervenyes", null);
    assert.ok(ok.ok && ok.status === "CONFIRMED");
    const mar = await api.megerosites("proba-token-mar", null);
    assert.ok(mar.ok && mar.status === "ALREADY_CONFIRMED");
    const lezart = await api.megerosites("proba-token-lezart", null);
    assert.ok(!lezart.ok && lezart.code === "CLOSED");
    const ismeretlen = await api.megerosites("barmi-mas-token", null);
    assert.ok(!ismeretlen.ok && ismeretlen.code === "INVALID_TOKEN");
  });
});

describe("jatekApiKornyezetbol", () => {
  it("an api address gives the real client", () => {
    assert.equal(
      jatekApiKornyezetbol({ JATEK_API_URL: "https://api-staging.example" })
        .hamis,
      false,
    );
  });

  it("without an address it is the fake api outside production", () => {
    assert.equal(jatekApiKornyezetbol({}).hamis, true);
    assert.equal(jatekApiKornyezetbol({ NODE_ENV: "development" }).hamis, true);
  });

  it("in production the fake api starts only on the explicit switch", () => {
    assert.throws(
      () => jatekApiKornyezetbol({ NODE_ENV: "production" }),
      /JATEK_API_URL/,
    );
    assert.equal(
      jatekApiKornyezetbol({ NODE_ENV: "production", JATEK_ALLOW_FAKE: "true" })
        .hamis,
      true,
    );
    assert.throws(
      () =>
        jatekApiKornyezetbol({
          NODE_ENV: "production",
          JATEK_ALLOW_FAKE: "yes",
        }),
      /JATEK_API_URL/,
    );
  });

  it("an invalid address is an error, not a silent fall back to the fake api", () => {
    for (const v of ["nem url", "ftp://x.example", "javascript:alert(1)"])
      assert.throws(
        () => jatekApiKornyezetbol({ JATEK_API_URL: v }),
        /nem ervenyes/,
        v,
      );
  });
});
