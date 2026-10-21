import "reflect-metadata";

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  DIAG_ENV,
  DIAG_WINDOW_MS,
  clientAddressDiag,
  diagOpen,
} from "./reefclub-diag.js";
import { ReefClubHealthController } from "./reefclub-health.controller.js";

/**
 * THE CLIENT-ADDRESS DIAGNOSTIC (ReefClub opening precondition, card
 * 3a8b5bde). Made-up addresses. What matters: it is OFF unless the variable is
 * exactly `true`, it closes by itself after an hour, and it shows addresses
 * and nothing else.
 */
const START = 1_000_000_000_000;

describe("mikor nyitott", () => {
  it("alapból ki: nincs változó, üres, vagy bármi, ami nem pontosan 'true'", () => {
    for (const value of [
      undefined,
      "",
      "false",
      "TRUE",
      "True",
      "1",
      "yes",
      " true",
      "true ",
    ])
      assert.equal(
        diagOpen({ [DIAG_ENV]: value }, START, START + 1000),
        false,
        String(value),
      );
    assert.equal(diagOpen({}, START, START + 1000), false);
  });

  it("a 'true' az indulástól egy óráig nyitott, utána magától zár", () => {
    const env = { [DIAG_ENV]: "true" };
    assert.equal(diagOpen(env, START, START), true);
    assert.equal(diagOpen(env, START, START + DIAG_WINDOW_MS), true);
    assert.equal(diagOpen(env, START, START + DIAG_WINDOW_MS + 1), false);
  });

  it("az indulás előtti óra (hibás óra) nem nyit", () => {
    assert.equal(diagOpen({ [DIAG_ENV]: "true" }, START, START - 1), false);
  });
});

describe("mit mutat", () => {
  const request = {
    headers: {
      "x-forwarded-for": "203.0.113.7, 10.1.2.3 ,fe80::1",
      cookie: "rc_session=titkos",
      authorization: "Bearer titkos",
      "user-agent": "Mozilla titkos",
    },
    ip: "172.18.0.5",
  };

  it("a számolt címet, a hop-számot, a lánc elemeit és a socket címét; mást nem", () => {
    const diag = clientAddressDiag(request, {
      callerAddress: "10.1.2.3",
      trustedProxyHops: 2,
    });
    assert.deepEqual(diag, {
      callerAddress: "10.1.2.3",
      trustedProxyHops: 2,
      forwardedFor: ["203.0.113.7", "10.1.2.3", "fe80::1"],
      socketAddress: "172.18.0.5",
    });
    assert.doesNotMatch(JSON.stringify(diag), /titkos|Bearer|Mozilla/);
  });

  it("ami nem cím, az '(nem cím)'; legfeljebb tíz elem; a hiányzó fejléc üres lánc", () => {
    const messy = clientAddressDiag(
      {
        headers: {
          "x-forwarded-for":
            "<script>alert(1)</script>, 1.1.1.1, ../../etc/passwd, " +
            Array.from({ length: 20 }, (_, i) => `10.0.0.${i}`).join(","),
        },
        ip: "nem-cim",
      },
      { callerAddress: "x", trustedProxyHops: 1 },
    );
    assert.equal(messy.forwardedFor.length, 10);
    assert.deepEqual(messy.forwardedFor.slice(0, 3), [
      "(nem cím)",
      "1.1.1.1",
      "(nem cím)",
    ]);
    assert.equal(messy.socketAddress, "(nem cím)");
    assert.deepEqual(
      clientAddressDiag(
        { headers: {} },
        { callerAddress: "u", trustedProxyHops: 1 },
      ).forwardedFor,
      [],
    );
  });
});

describe("a /rc/v1/health válasza", () => {
  const original = {
    diag: process.env[DIAG_ENV],
    hops: process.env.REEFCLUB_TRUSTED_PROXY_HOPS,
  };
  afterEach(() => {
    for (const [name, value] of [
      [DIAG_ENV, original.diag],
      ["REEFCLUB_TRUSTED_PROXY_HOPS", original.hops],
    ] as const)
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
  });

  const controller = new ReefClubHealthController({
    $queryRaw: async () => [{ "?column?": 1 }],
  } as never);
  const request = {
    headers: { "x-forwarded-for": "203.0.113.7, 10.1.2.3" },
    ip: "172.18.0.5",
  };

  it("kapcsoló nélkül pontosan {status: ok}: a diag kulcs sincs", async () => {
    delete process.env[DIAG_ENV];
    assert.deepEqual(await controller.health(request), { status: "ok" });
    process.env[DIAG_ENV] = "false";
    assert.deepEqual(await controller.health(request), { status: "ok" });
  });

  it("bekapcsolva a számolt címet és a láncot mutatja (alap 1 hop: a lánc jobb szélső eleme)", async () => {
    process.env[DIAG_ENV] = "true";
    delete process.env.REEFCLUB_TRUSTED_PROXY_HOPS;
    const answer = await controller.health(request);
    assert.equal(answer.status, "ok");
    assert.deepEqual(answer.diag, {
      callerAddress: "10.1.2.3",
      trustedProxyHops: 1,
      forwardedFor: ["203.0.113.7", "10.1.2.3"],
      socketAddress: "172.18.0.5",
    });
  });

  it("a hop-szám a mért érték szerint mozdítja a számolt címet (2 hop: az ügyfél)", async () => {
    process.env[DIAG_ENV] = "true";
    process.env.REEFCLUB_TRUSTED_PROXY_HOPS = "2";
    const answer = await controller.health(request);
    assert.equal(answer.diag?.callerAddress, "203.0.113.7");
    assert.equal(answer.diag?.trustedProxyHops, 2);
  });

  it("az adatbázis nélküli folyamat 503, a diag nélkül is", async () => {
    const broken = new ReefClubHealthController({
      $queryRaw: async () => {
        throw new Error("nincs adatbázis");
      },
    } as never);
    process.env[DIAG_ENV] = "true";
    await assert.rejects(() => broken.health(request));
  });
});
