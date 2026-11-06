import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { BekuldesBemenet, JatekApi } from "./jatek-api.ts";
import { bekuldesKezeles, megerositesKezeles } from "./kezelok.ts";
import { BEKULDES_RENDBEN, NEM_ELERHETO } from "./uzenetek.ts";

/*
  WHAT TURNS THIS RED. A bad request reaching the api; the visitor's address not forwarded, or the FRONT entry of
  X-Forwarded-For forwarded; an api status the browser should not see (a 500, a 502) passed through; the answer
  telling whether the answer was right or whether the address had played (the success body has two keys and a
  fixed sentence); a repeated confirmation shown as an error.
*/
type Rogzites = {
  bekuldes: Array<{ bemenet: BekuldesBemenet; ip: string | null }>;
  megerosites: Array<{ token: string; ip: string | null }>;
};

function rogzitoApi(valaszok: {
  bekuldes?: Awaited<ReturnType<JatekApi["bekuldes"]>>;
  megerosites?: Awaited<ReturnType<JatekApi["megerosites"]>>;
}) {
  const r: Rogzites = { bekuldes: [], megerosites: [] };
  const api: JatekApi = {
    hamis: false,
    async aktualis() {
      return { ok: true, question: null };
    },
    async bekuldes(bemenet, ip) {
      r.bekuldes.push({ bemenet, ip });
      return valaszok.bekuldes ?? { ok: true };
    },
    async megerosites(token, ip) {
      r.megerosites.push({ token, ip });
      return (
        valaszok.megerosites ?? {
          ok: true,
          status: "CONFIRMED",
          week: "2026-W46",
        }
      );
    },
  };
  return { api, r };
}

const JO = {
  questionId: "q1",
  email: "j@example.com",
  name: "Kovács Péter",
  answer: "acropora",
  website: "",
};

describe("bekuldesKezeles", () => {
  it("passes a good request on with the proxy-appended address, and answers with the fixed sentence only", async () => {
    const { api, r } = rogzitoApi({});
    const v = await bekuldesKezeles(JO, "198.51.100.77, 203.0.113.9", api);
    assert.deepEqual(v, {
      status: 200,
      body: { ok: true, message: BEKULDES_RENDBEN },
    });
    assert.deepEqual(r.bekuldes, [{ bemenet: JO, ip: "203.0.113.9" }]);
  });

  it("a bad request never reaches the api", async () => {
    const { api, r } = rogzitoApi({});
    const v = await bekuldesKezeles({ ...JO, email: "nem" }, null, api);
    assert.equal(v.status, 400);
    assert.equal(v.body.code, "INVALID_EMAIL");
    assert.equal(r.bekuldes.length, 0);
  });

  it("the honeypot is passed on unchanged (the api decides), and the answer to a bot is the same sentence", async () => {
    const { api, r } = rogzitoApi({});
    const v = await bekuldesKezeles(
      { ...JO, website: "http://spam.example" },
      null,
      api,
    );
    assert.equal(v.status, 200);
    assert.equal(v.body.message, BEKULDES_RENDBEN);
    assert.equal(r.bekuldes[0]!.bemenet.website, "http://spam.example");
  });

  it("passes on only the statuses the browser may see; everything else is 503 'not available'", async () => {
    for (const status of [400, 404, 409, 429]) {
      const { api } = rogzitoApi({
        bekuldes: { ok: false, status, code: "CLOSED", message: "" },
      });
      assert.equal((await bekuldesKezeles(JO, null, api)).status, status);
    }
    for (const status of [401, 500, 502, 503, 504]) {
      const { api } = rogzitoApi({
        bekuldes: { ok: false, status, code: "UNAVAILABLE", message: "" },
      });
      const v = await bekuldesKezeles(JO, null, api);
      assert.equal(v.status, 503, String(status));
      assert.equal(v.body.message, NEM_ELERHETO);
    }
  });

  it("the success body has exactly two keys: nothing about the answer's correctness or an earlier play", async () => {
    const { api } = rogzitoApi({});
    const v = await bekuldesKezeles(JO, null, api);
    assert.deepEqual(Object.keys(v.body).sort(), ["message", "ok"]);
  });
});

describe("megerositesKezeles", () => {
  it("passes the token on with the address; CONFIRMED and ALREADY_CONFIRMED are both successes with their own sentence", async () => {
    const tok = "abcdefgh12345678";
    const uj = rogzitoApi({});
    const a = await megerositesKezeles({ token: tok }, "203.0.113.9", uj.api);
    assert.equal(a.status, 200);
    assert.equal(a.body.status, "CONFIRMED");
    assert.deepEqual(uj.r.megerosites, [{ token: tok, ip: "203.0.113.9" }]);
    const mar = rogzitoApi({
      megerosites: { ok: true, status: "ALREADY_CONFIRMED", week: "2026-W46" },
    });
    const b = await megerositesKezeles({ token: tok }, null, mar.api);
    assert.equal(b.status, 200);
    assert.equal(b.body.status, "ALREADY_CONFIRMED");
    assert.notEqual(a.body.message, b.body.message);
  });

  it("a bad token never reaches the api; INVALID_TOKEN and CLOSED keep their statuses", async () => {
    const { api, r } = rogzitoApi({});
    assert.equal(
      (await megerositesKezeles({ token: "rovid" }, null, api)).status,
      400,
    );
    assert.equal(r.megerosites.length, 0);
    for (const [status, code] of [
      [400, "INVALID_TOKEN"],
      [409, "CLOSED"],
    ] as const) {
      const e = rogzitoApi({
        megerosites: { ok: false, status, code, message: "" },
      });
      const v = await megerositesKezeles(
        { token: "abcdefgh12345678" },
        null,
        e.api,
      );
      assert.equal(v.status, status);
      assert.equal(v.body.code, code);
    }
  });
});
