import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { JEV_ENDPOINT, jevChoice, type FetchLike } from "./jev-client.js";

const KULCS = "titkos-kulcs-SOHA-NEM-LATSZIK";

const KERES = {
  apiKey: KULCS,
  model: "jev-1.13.0",
  state: '{"name":"Szivattyú"}',
  instructions: "Melyik kategória?",
  criteria: { cat1: "Szivattyú", cat2: "Lámpa", NONE: "Nem dönthető el." },
};

interface Hivas {
  url: string;
  init: Parameters<FetchLike>[1];
}

/** Egy sorban valaszolo dupla: minden hivas a kovetkezo elore megadott valaszt kapja. */
function dupla(
  valaszok: readonly (
    { status: number; body: string; retryAfter?: string } | Error
  )[],
) {
  const hivasok: Hivas[] = [];
  let i = 0;
  const fetch: FetchLike = async (url, init) => {
    hivasok.push({ url, init });
    const v = valaszok[Math.min(i++, valaszok.length - 1)] as
      { status: number; body: string; retryAfter?: string } | Error;
    if (v instanceof Error) throw v;
    return {
      status: v.status,
      headers: {
        get: (n: string) =>
          n === "retry-after" ? (v.retryAfter ?? null) : null,
      },
      text: async () => v.body,
    };
  };
  const varakozasok: number[] = [];
  return {
    hivasok,
    varakozasok,
    opciok: {
      fetch,
      sleep: async (ms: number) => {
        varakozasok.push(ms);
      },
      now: (() => {
        let t = 0;
        return () => (t += 100);
      })(),
    },
  };
}

/** A mert valasz (acrobot, 2026-09-28), a mi opcio-kulcsainkkal. */
const JO = JSON.stringify({
  model: "jev-1.13.0",
  answers: {
    q: {
      type: "choice",
      choice: "cat1",
      confidence: 0.97,
      probabilities: { cat1: 0.97, cat2: 0.02, NONE: 0.01 },
    },
  },
  usage: { input_tokens: 458, output_tokens: 64 },
});

describe("a Jev choice-hívás", () => {
  it("a kérés alakja: rögzített modell, egy choice kérdés, a kulcs csak a fejlécben", async () => {
    const d = dupla([{ status: 200, body: JO }]);
    await jevChoice(KERES, d.opciok);
    const hivas = d.hivasok[0] as Hivas;
    assert.equal(hivas.url, JEV_ENDPOINT);
    assert.equal(hivas.init.method, "POST");
    assert.equal(hivas.init.headers.Authorization, `Bearer ${KULCS}`);
    assert.deepEqual(JSON.parse(hivas.init.body), {
      state: KERES.state,
      model: "jev-1.13.0",
      questions: {
        q: {
          type: "choice",
          instructions: KERES.instructions,
          criteria: KERES.criteria,
        },
      },
    });
    assert.doesNotMatch(hivas.init.body, new RegExp(KULCS));
  });

  it("a kérdés kulcsa megadható: kérésben és válaszban is az megy, alapértéke q", async () => {
    // #1199 P-026: a beszállítói sor-párosítás "match" kulccsal küld, mert a
    // policy-jét azzal mértük; az eszköz-pilot alapértéke nem változik
    const matchValasz = JO.replace('"q":', '"match":');
    const d = dupla([{ status: 200, body: matchValasz }]);
    const eredmeny = await jevChoice(
      { ...KERES, questionKey: "match" },
      d.opciok,
    );
    assert.deepEqual(
      Object.keys(JSON.parse((d.hivasok[0] as Hivas).init.body).questions),
      ["match"],
    );
    assert.equal(eredmeny.ok && eredmeny.choice, "cat1");
    // a q kulcsú válasz a match kérdésre nem fogadható el
    const rossz = dupla([{ status: 200, body: JO }]);
    const r = await jevChoice({ ...KERES, questionKey: "match" }, rossz.opciok);
    assert.equal(r.ok, false);
  });

  it("a sikeres válaszból a választás, a bizonyosság, a modell és a token", async () => {
    const d = dupla([{ status: 200, body: JO }]);
    assert.deepEqual(await jevChoice(KERES, d.opciok), {
      ok: true,
      choice: "cat1",
      confidence: 0.97,
      probabilities: { cat1: 0.97, cat2: 0.02, NONE: 0.01 },
      respondedModel: "jev-1.13.0",
      inputTokens: 458,
      latencyMs: 100,
      attempts: 1,
    });
  });

  /**
   * AZ ELTUNT MODELL NEM ATMENETI HIBA: nincs ujraprobalas, es a kod megnevezi,
   * hogy a kiertekelo megallhasson (Q-004 H).
   */
  it("ismeretlen modellnél MODEL_UNAVAILABLE, újrapróbálás nélkül", async () => {
    const d = dupla([
      {
        status: 400,
        body: '{"error_type":"api_usage_error","message":"Unknown model: jev-1.13.0"}',
      },
    ]);
    const eredmeny = await jevChoice(KERES, d.opciok);
    assert.equal(eredmeny.ok, false);
    assert.equal(!eredmeny.ok && eredmeny.errorCode, "MODEL_UNAVAILABLE");
    assert.equal(d.hivasok.length, 1);
  });

  it("429 és 529 után visszalép és újrapróbál, a retry-after fejlécet követve", async () => {
    const d = dupla([
      { status: 429, body: "rate", retryAfter: "3" },
      { status: 529, body: "overloaded" },
      { status: 200, body: JO },
    ]);
    const eredmeny = await jevChoice(KERES, d.opciok);
    assert.equal(eredmeny.ok, true);
    assert.equal(eredmeny.attempts, 3);
    assert.deepEqual(d.varakozasok, [3000, 2000]);
  });

  it("a hálózati hiba is újrapróbálás, és a végén NETWORK_ERROR", async () => {
    const d = dupla([new Error("ECONNRESET")]);
    const eredmeny = await jevChoice(KERES, { ...d.opciok, maxAttempts: 3 });
    assert.equal(!eredmeny.ok && eredmeny.errorCode, "NETWORK_ERROR");
    assert.equal(d.hivasok.length, 3);
  });

  it("egy másik 4xx nem javul újrapróbálástól: egy hívás, PROVIDER_ERROR", async () => {
    const d = dupla([{ status: 401, body: '{"message":"bad key"}' }]);
    const eredmeny = await jevChoice(KERES, d.opciok);
    assert.equal(!eredmeny.ok && eredmeny.errorCode, "PROVIDER_ERROR");
    assert.equal(d.hivasok.length, 1);
  });

  /**
   * A FEL NEM KINALT KULCS NEM VALASZ: ha a modell mast ad vissza, mint az
   * opciok egyike, az a merest hamisitana.
   */
  it("a fel nem kínált választás BAD_RESPONSE", async () => {
    const rossz = JO.replace('"choice":"cat1"', '"choice":"cat9"');
    const eredmeny = await jevChoice(
      KERES,
      dupla([{ status: 200, body: rossz }]).opciok,
    );
    assert.equal(!eredmeny.ok && eredmeny.errorCode, "BAD_RESPONSE");
  });

  it("a szolgáltató hibaüzenete legfeljebb 500 karakter, és a kulcs nincs benne", async () => {
    const hosszu = "x".repeat(2000);
    const d = dupla([{ status: 500, body: hosszu }]);
    const eredmeny = await jevChoice(KERES, { ...d.opciok, maxAttempts: 1 });
    assert.ok(!eredmeny.ok && eredmeny.errorMessage.length <= 501);
    assert.doesNotMatch(JSON.stringify(eredmeny), new RegExp(KULCS));
  });
});
