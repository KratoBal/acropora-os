import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CHALLENGE_PAGE,
  fakeClock,
  productPage,
  scriptedNetwork,
} from "./enrichment-test-fixtures.js";
import {
  ENRICHMENT_USER_AGENT,
  HOST_DELAY_MS,
  PoliteFetcher,
  RequestLimitReached,
} from "./polite-fetcher.js";

const BRS = "https://www.bulkreefsupply.com";
const anyHost = () => true;

function fetcher(
  table: Parameters<typeof scriptedNetwork>[0],
  requestLimit = 100,
) {
  const network = scriptedNetwork(table);
  const clock = fakeClock();
  return {
    network,
    clock,
    fetcher: new PoliteFetcher({
      fetch: network.fetch,
      sleep: clock.sleep,
      now: clock.now,
      requestLimit,
    }),
  };
}

describe("udvarias olvasás", () => {
  // PD-013 calibration: a path robots.txt disallows is not requested.
  it("a robots.txt által tiltott útvonalat le sem kéri", async () => {
    const { fetcher: f, network } = fetcher({
      [`${BRS}/robots.txt`]: {
        status: 200,
        body: "User-agent: *\nDisallow: /private/\n",
      },
      [`${BRS}/private/p1`]: { status: 200, body: productPage({ name: "x" }) },
    });
    const page = await f.page(`${BRS}/private/p1`, anyHost);
    assert.deepEqual(
      [page.ok, !page.ok && page.reason],
      [false, "ROBOTS_DISALLOWED"],
    );
    assert.deepEqual(
      network.requests.map((r) => r.url),
      [`${BRS}/robots.txt`],
    );
  });

  it("csak GET, azonosítható user-agenttel; a robots.txt-t gazdánként egyszer olvassa", async () => {
    const { fetcher: f, network } = fetcher({
      [`${BRS}/p/1`]: { status: 200, body: productPage({ name: "a" }) },
      [`${BRS}/p/2`]: { status: 200, body: productPage({ name: "b" }) },
    });
    await f.page(`${BRS}/p/1`, anyHost);
    await f.page(`${BRS}/p/2`, anyHost);
    assert.deepEqual(
      network.requests.map((r) => r.url),
      [`${BRS}/robots.txt`, `${BRS}/p/1`, `${BRS}/p/2`],
    );
    assert.ok(network.requests.every((r) => r.method === "GET"));
    assert.ok(
      network.requests.every((r) => r.userAgent === ENRICHMENT_USER_AGENT),
    );
  });

  it("egy futáson belül ugyanazt az oldalt nem kéri le újra", async () => {
    const { fetcher: f, network } = fetcher({
      [`${BRS}/p/1`]: { status: 200, body: productPage({ name: "a" }) },
    });
    await f.page(`${BRS}/p/1`, anyHost);
    await f.page(`${BRS}/p/1`, anyHost);
    assert.equal(
      network.requests.filter((r) => r.url === `${BRS}/p/1`).length,
      1,
    );
  });

  it("gazdánként vár két lekérés között; a nagyobb Crawl-delay-t betartja", async () => {
    const { fetcher: f, clock } = fetcher({
      [`${BRS}/robots.txt`]: {
        status: 200,
        body: "User-agent: *\nCrawl-delay: 9\n",
      },
      [`${BRS}/p/1`]: { status: 200, body: productPage({}) },
      [`${BRS}/p/2`]: { status: 200, body: productPage({}) },
    });
    await f.page(`${BRS}/p/1`, anyHost);
    await f.page(`${BRS}/p/2`, anyHost);
    // robots.txt first, then each page waits the longer Crawl-delay
    assert.deepEqual(clock.slept, [9000, 9000]);
    const plain = fetcher({
      [`${BRS}/p/1`]: { status: 200, body: productPage({}) },
      [`${BRS}/p/2`]: { status: 200, body: productPage({}) },
    });
    await plain.fetcher.page(`${BRS}/p/1`, anyHost);
    await plain.fetcher.page(`${BRS}/p/2`, anyHost);
    assert.deepEqual(plain.clock.slept, [HOST_DELAY_MS, HOST_DELAY_MS]);
  });

  // PD-013 calibration: a refusing or captcha page gives "unavailable".
  it("elutasítás és captcha: nem elérhető, okkal, nem hiba és nem üres oldal", async () => {
    const { fetcher: f } = fetcher({
      [`${BRS}/p/403`]: { status: 403, body: "nem" },
      [`${BRS}/p/429`]: { status: 429 },
      [`${BRS}/p/captcha`]: { status: 200, body: CHALLENGE_PAGE },
      [`${BRS}/p/pdf`]: {
        status: 200,
        body: "%PDF",
        headers: { "content-type": "application/pdf" },
      },
    });
    const reasons = [];
    for (const path of ["403", "429", "captcha", "pdf"]) {
      const page = await f.page(`${BRS}/p/${path}`, anyHost);
      assert.equal(page.ok, false);
      reasons.push(!page.ok && page.reason);
    }
    assert.deepEqual(reasons, [
      "HTTP_403",
      "HTTP_429",
      "CHALLENGE",
      "NOT_HTML",
    ]);
  });

  it("a robots.txt 403-a mindent tilt; olvashatatlan robots.txt mellett a gazda nem elérhető", async () => {
    const forbidden = fetcher({ [`${BRS}/robots.txt`]: { status: 403 } });
    const a = await forbidden.fetcher.page(`${BRS}/p/1`, anyHost);
    assert.equal(!a.ok && a.reason, "ROBOTS_DISALLOWED");
    const broken = fetcher({ [`${BRS}/robots.txt`]: { status: 503 } });
    const b = await broken.fetcher.page(`${BRS}/p/1`, anyHost);
    assert.equal(!b.ok && b.reason, "ROBOTS_UNREADABLE");
  });

  // First live round, 2026-10-03: tunze.com sends www -> bare, and every page
  // was ROBOTS_UNREADABLE because the robots.txt redirect was not followed.
  it("a robots.txt ugyanazon az oldalon belüli átirányítását követi (www és csupasz gazda)", async () => {
    const TUNZE = "https://www.tunze.com";
    const { fetcher: f, network } = fetcher({
      [`${TUNZE}/robots.txt`]: {
        status: 301,
        headers: { location: "https://tunze.com/robots.txt" },
      },
      ["https://tunze.com/robots.txt"]: {
        status: 200,
        body: "User-agent: *\nDisallow: /checkout/\n",
      },
      [`${TUNZE}/p/1`]: { status: 200, body: productPage({}) },
    });
    const page = await f.page(`${TUNZE}/p/1`, anyHost);
    assert.equal(page.ok, true);
    const blocked = await f.page(`${TUNZE}/checkout/x`, anyHost);
    assert.equal(!blocked.ok && blocked.reason, "ROBOTS_DISALLOWED");
    assert.deepEqual(
      network.requests.map((r) => r.url),
      [`${TUNZE}/robots.txt`, "https://tunze.com/robots.txt", `${TUNZE}/p/1`],
    );
  });

  it("a robots.txt más oldalra vagy http-re mutató átirányítását nem követi", async () => {
    for (const location of [
      "https://masik.example.invalid/robots.txt",
      "http://bulkreefsupply.com/robots.txt",
    ]) {
      const { fetcher: f, network } = fetcher({
        [`${BRS}/robots.txt`]: { status: 301, headers: { location } },
      });
      const page = await f.page(`${BRS}/p/1`, anyHost);
      assert.equal(!page.ok && page.reason, "ROBOTS_UNREADABLE");
      assert.equal(network.requests.length, 1);
    }
  });

  it("a robots.txt átirányítási láncát a korlátnál elvágja", async () => {
    const { fetcher: f, network } = fetcher({
      [`${BRS}/robots.txt`]: {
        status: 301,
        headers: { location: "https://bulkreefsupply.com/robots.txt" },
      },
      ["https://bulkreefsupply.com/robots.txt"]: {
        status: 301,
        headers: { location: `${BRS}/robots.txt` },
      },
    });
    const page = await f.page(`${BRS}/p/1`, anyHost);
    assert.equal(!page.ok && page.reason, "ROBOTS_UNREADABLE");
    assert.equal(network.requests.length, 4);
  });

  it("más oldalra mutató átirányítást nem követ", async () => {
    const { fetcher: f, network } = fetcher({
      [`${BRS}/p/1`]: {
        status: 301,
        headers: { location: "https://masik.example.invalid/p" },
      },
    });
    const page = await f.page(`${BRS}/p/1`, (url) => url.startsWith(BRS));
    assert.equal(!page.ok && page.reason, "REDIRECT_OFF_SOURCE");
    assert.ok(!network.requests.some((r) => r.url.startsWith("https://masik")));
  });

  it("a lekérés-korlátnál megáll: a korlát fölötti lekérés ki sem megy", async () => {
    const { fetcher: f, network } = fetcher(
      { [`${BRS}/p/1`]: { status: 200, body: productPage({}) } },
      1,
    );
    await assert.rejects(
      () => f.page(`${BRS}/p/1`, anyHost),
      RequestLimitReached,
    );
    assert.equal(network.requests.length, 1);
    assert.equal(f.requestCount, 1);
  });
});
