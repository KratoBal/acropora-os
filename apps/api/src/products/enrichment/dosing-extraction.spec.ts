import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  dosingExtractorFromEnv,
  dosingStatement,
  extractorAnswerOf,
  visiblePageText,
  type DosingExtractorAnswer,
} from "./dosing-extraction.js";

/**
 * THE AI'S DOSING ANSWER, CHECKED IN THE OS (Product Knowledge, card 85c38ab1).
 * WHAT TURNS IT RED: an answer whose excerpt this page does not hold becomes a
 * value; a fixed dose the deterministic reader reads differently becomes a
 * value (barracuda's two-dose sentence, #41); the three states do not come out
 * as their fields. Invented page text only.
 */
const answer = (
  over: Partial<Extract<DosingExtractorAnswer, { kind: "ANSWER" }>>,
): DosingExtractorAnswer => ({
  kind: "ANSWER",
  mode: "NO_DATA",
  dose: null,
  tests: [],
  guidance: null,
  excerpt: null,
  reason: "",
  ...over,
});
const fields = (r: ReturnType<typeof dosingStatement>) =>
  r.values.map((v) => [v.field, v.raw]);

describe("az AI adagolás-válasza az OS-ben", () => {
  it("fix adag: a két független olvasás egyezik, és két mező jön belőle", () => {
    const page = "Kitalált Jód\nAdagolás: napi 1 csepp 100 liter vízre.";
    const r = dosingStatement(
      answer({
        mode: "FIXED",
        dose: "1 drop/100 L/day",
        excerpt: "Adagolás: napi 1 csepp 100 liter vízre.",
      }),
      page,
    );
    assert.deepEqual(fields(r), [
      ["dosing", "1 drop/100 L/day"],
      ["dosingMode", "FIXED"],
    ]);
    assert.match(r.values[0]!.excerpt, /AI-kivonat = "Adagolás: napi 1 csepp/);
  });

  // barracuda, #41: two doses in one excerpt, the roles crossed
  it("két adag egy kivonatban: az olvasó nem ad értéket, tehát az AI adagja sem megy át", () => {
    const sentence = "Dose 5 ml per 100 l daily, or 30 ml per 100 l weekly.";
    const r = dosingStatement(
      answer({ mode: "FIXED", dose: "5 ml/100 L/week", excerpt: sentence }),
      sentence,
    );
    assert.deepEqual(r.values, []);
    assert.match(
      r.notes[0]!,
      /a saját olvasás eltér \(AI 5 ml\/100 L\/week, olvasó nincs érték/,
    );
  });

  // barracuda, #1805: the model picks the excerpt; the page holds three ways to dose
  it("a kivonat egyadagos, de a lap nem: a teljes lap olvasása visszatartja", () => {
    const first = "Dose 5 ml per 100 l once a week.";
    const page = `${first} Alternatively dose 1 ml per 100 l for every 20 ppm of calcium consumed.`;
    const r = dosingStatement(
      answer({ mode: "FIXED", dose: "5 ml/100 L/week", excerpt: first }),
      page,
    );
    assert.deepEqual(r.values, []);
    assert.match(
      r.notes[0]!,
      /a teljes lap olvasása eltér \(AI 5 ml\/100 L\/week, lap nincs érték/,
    );
    // control: the same excerpt on a page that holds only this dose
    assert.equal(
      dosingStatement(
        answer({ mode: "FIXED", dose: "5 ml/100 L/week", excerpt: first }),
        `Kitalált. ${first}`,
      ).values.length,
      2,
    );
  });

  it("nincs adat, miközben az olvasó adagot talált: ellentmondás, nem állapot", () => {
    const page = "Kitalált. Dose 1 ml per 100 l daily.";
    const onPage = dosingStatement(answer({ reason: "nincs" }), page);
    assert.deepEqual(onPage.values, []);
    assert.match(
      onPage.notes[0]!,
      /az AI szerint nincs adat, az olvasó 1 ml\/100 L\/day adagot olvasott/,
    );
    // the description's dose (JSON-LD, #1800) counts the same
    assert.deepEqual(
      dosingStatement(
        answer({ reason: "nincs" }),
        "Kitalált.",
        "1 drop/100 L/day",
      ).values,
      [],
    );
  });

  it("a nincs-adat indoklása nem kivonatként áll", () => {
    const r = dosingStatement(
      answer({ reason: "a lapon nincs adag" }),
      "Kitalált.",
    );
    assert.equal(
      r.values[0]!.excerpt,
      'AI-indoklás (nem lapszöveg) = "a lapon nincs adag"',
    );
  });

  it("eltérő számú adag: az olvasó mást olvas, emberhez megy", () => {
    const sentence = "Dose 1 ml per 100 l daily.";
    const r = dosingStatement(
      answer({ mode: "FIXED", dose: "1 ml/50 L/day", excerpt: sentence }),
      sentence,
    );
    assert.deepEqual(r.values, []);
    assert.match(r.notes[0]!, /AI 1 ml\/50 L\/day, olvasó 1 ml\/100 L\/day/);
  });

  it("a lapon nem álló kivonat: nincs érték, akármit mond", () => {
    const r = dosingStatement(
      answer({
        mode: "FIXED",
        dose: "1 ml/100 L/day",
        excerpt: "Dose 1 ml per 100 l daily.",
      }),
      "Kitalált lap, adag nélkül.",
    );
    assert.deepEqual(
      [r.values, r.notes],
      [[], ["adagolás (AI): a kivonat nincs a lapon"]],
    );
  });

  it("tesztfüggő: mód, útmutató és a mérendő kódok kanonikusan", () => {
    const guidance = "Dose according to your weekly KH and calcium tests.";
    const r = dosingStatement(
      answer({
        mode: "TEST_DEPENDENT",
        tests: ["KH", "KALCIUM"],
        guidance,
        excerpt: guidance,
      }),
      `Kitalált.\n${guidance}`,
    );
    assert.deepEqual(fields(r), [
      ["dosingMode", "TEST_DEPENDENT"],
      ["dosingGuidance", guidance],
      ["dosingTests", "KALCIUM;KH"],
    ]);
    assert.deepEqual(
      dosingStatement(
        answer({
          mode: "TEST_DEPENDENT",
          tests: ["CALCIUM"],
          guidance,
          excerpt: guidance,
        }),
        guidance,
      ).values,
      [],
    );
  });

  it("nincs adat, elutasítás, elérhetetlenség", () => {
    assert.deepEqual(
      fields(dosingStatement(answer({ reason: "nincs adag" }), "x")),
      [["dosingMode", "NO_DATA"]],
    );
    assert.deepEqual(
      dosingStatement({ kind: "REFUSED", refusal: "AMOUNT_ROLE" }, "x"),
      {
        values: [],
        notes: ["adagolás (AI): az AI őre elutasította (AMOUNT_ROLE)"],
      },
    );
    assert.deepEqual(
      dosingStatement({ kind: "UNAVAILABLE", reason: "HTTP 503" }, "x").values,
      [],
    );
  });

  it("a válasz teste: válasz, elutasítás, és ami egyik sem", () => {
    assert.equal(
      extractorAnswerOf({ mode: "FIXED", dose: "1 ml/100 L/day" }).kind,
      "ANSWER",
    );
    assert.deepEqual(extractorAnswerOf({ refusal: "EXCERPT_NOT_IN_PAGE" }), {
      kind: "REFUSED",
      refusal: "EXCERPT_NOT_IN_PAGE",
    });
    assert.equal(extractorAnswerOf({ mode: "DAILY" }).kind, "UNAVAILABLE");
    assert.equal(extractorAnswerOf(null).kind, "UNAVAILABLE");
  });

  it("az út vagy az AI beállítás nélkül nincs kivonó, tehát nincs hívás és nincs költség", () => {
    const ai = {
      ACROPORA_AI_BASE_URL: "https://ai.example.invalid",
      ACROPORA_AI_ACCESS_TOKEN: "t",
    };
    assert.equal(dosingExtractorFromEnv({}), null);
    assert.equal(dosingExtractorFromEnv(ai), null);
    assert.equal(
      dosingExtractorFromEnv({
        ACROPORA_AI_DOSING_PATH: "v1/dosing-extractions",
      }),
      null,
    );
    assert.ok(
      dosingExtractorFromEnv({
        ...ai,
        ACROPORA_AI_DOSING_PATH: "v1/dosing-extractions",
      }),
    );
  });

  it("a lap látható szövege: szkript, stílus és menü nélkül, blokkonként sor", () => {
    assert.equal(
      visiblePageText(
        '<html><head><script>var x = "1 ml";</script><style>p{}</style></head><body><nav>Menü</nav><h1>Kitalált</h1><p>Napi&nbsp;1 csepp</p></body></html>',
      ),
      "Kitalált\nNapi 1 csepp",
    );
  });
});
