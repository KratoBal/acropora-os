import "reflect-metadata";

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  DIAG_MAX_AHEAD_MS,
  DIAG_UNTIL_ENV,
  clientAddressDiag,
  diagOpen,
  diagState,
} from "./reefclub-diag.js";
import { ReefClubHealthController } from "./reefclub-health.controller.js";

/**
 * THE CLIENT-ADDRESS DIAGNOSTIC (ReefClub opening precondition, card
 * 3a8b5bde). Made-up addresses. What matters: it is OFF unless the variable is
 * exactly `true`, it closes by itself after an hour, and it shows addresses
 * and nothing else.
 */
const START = 1_000_000_000_000;

const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();
const env = (value: string | undefined) => ({ [DIAG_UNTIL_ENV]: value });

describe("mikor nyitott", () => {
  it("alapból ki: nincs változó vagy üres", () => {
    assert.equal(diagState({}, START, START + 1000).state, "OFF");
    assert.equal(diagState(env(""), START, START + 1000).state, "OFF");
    assert.equal(diagOpen({}, START, START + 1000), false);
  });

  it("a régi igen/nem kapcsoló nem nyit: csak az abszolút lejárat", () => {
    for (const value of ["true", "1", "yes", "TRUE"])
      assert.notEqual(
        diagState({ REEFCLUB_DIAG_CLIENT_ADDRESS: value }, START, START + 1000)
          .state,
        "OPEN",
      );
  });

  it("érvényes, közeli időpontig nyitott, az időpontban már zárt", () => {
    const until = iso(START + HOUR);
    assert.equal(diagState(env(until), START, START).state, "OPEN");
    assert.equal(diagOpen(env(until), START, START + HOUR - 1), true);
    assert.equal(diagState(env(until), START, START + HOUR).state, "EXPIRED");
    assert.equal(diagOpen(env(until), START, START + 5 * HOUR), false);
  });

  it("egy elfelejtett érték ÓRA szerint jár le, nem újraindítások szerint: később, új folyamattal is zárt", () => {
    const until = iso(START + HOUR);
    // the process restarted a day later with the same value in the environment
    const restart = START + 24 * HOUR;
    assert.equal(
      diagState(env(until), restart, restart + 1000).state,
      "EXPIRED",
    );
    assert.equal(diagOpen(env(until), restart, restart + 1000), false);
  });

  it("az indulástól legfeljebb két órával későbbi időpont nyit; a távolabbi (2099 is) zárt", () => {
    assert.equal(
      diagState(env(iso(START + DIAG_MAX_AHEAD_MS)), START, START).state,
      "OPEN",
    );
    assert.equal(
      diagState(env(iso(START + DIAG_MAX_AHEAD_MS + 1)), START, START).state,
      "TOO_FAR",
    );
    assert.equal(
      diagState(env("2099-01-01T00:00:00Z"), START, START).state,
      "TOO_FAR",
    );
    assert.equal(diagOpen(env("2099-01-01T00:00:00Z"), START, START), false);
  });

  it("érvénytelen érték zárt: nem dátum, időzóna nélküli, természetellenes dátum", () => {
    for (const value of [
      "holnap",
      "2026-10-21T14:00:00",
      "2026-10-21",
      "1761051600000",
      "2026-13-40T99:99:99Z",
      "true",
    ])
      assert.equal(diagState(env(value), START, START).state, "INVALID", value);
    assert.equal(diagOpen(env("2026-10-21T14:00:00"), START, START), false);
  });

  it("időzónás időpont is érvényes (a +02:00 ugyanaz a pillanat)", () => {
    const until = new Date(START + HOUR);
    const local = `${until.toISOString().slice(0, 19)}+00:00`;
    assert.equal(diagState(env(local), START, START).state, "OPEN");
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
    until: process.env[DIAG_UNTIL_ENV],
    hops: process.env.REEFCLUB_TRUSTED_PROXY_HOPS,
  };
  afterEach(() => {
    for (const [name, value] of [
      [DIAG_UNTIL_ENV, original.until],
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
  const soon = () => new Date(Date.now() + HOUR).toISOString();

  it("kapcsoló nélkül pontosan {status: ok}: a diag kulcs sincs", async () => {
    delete process.env[DIAG_UNTIL_ENV];
    assert.deepEqual(await controller.health(request), { status: "ok" });
    process.env[DIAG_UNTIL_ENV] = "hamis";
    assert.deepEqual(await controller.health(request), { status: "ok" });
    process.env[DIAG_UNTIL_ENV] = "2099-01-01T00:00:00Z";
    assert.deepEqual(await controller.health(request), { status: "ok" });
  });

  it("nyitva a számolt címet és a láncot mutatja (alap 1 hop: a lánc jobb szélső eleme)", async () => {
    process.env[DIAG_UNTIL_ENV] = soon();
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
    process.env[DIAG_UNTIL_ENV] = soon();
    process.env.REEFCLUB_TRUSTED_PROXY_HOPS = "2";
    const answer = await controller.health(request);
    assert.equal(answer.diag?.callerAddress, "203.0.113.7");
    assert.equal(answer.diag?.trustedProxyHops, 2);
  });

  it("minden health-válasz Cache-Control: no-store (a diag a hívó címét tartalmazza: személyes adat)", () => {
    const headers = Reflect.getMetadata(
      "__headers__",
      ReefClubHealthController.prototype.health,
    ) as { name: string; value: string }[];
    assert.deepEqual(headers, [{ name: "Cache-Control", value: "no-store" }]);
  });

  it("az adatbázis nélküli folyamat 503, a diag nélkül is", async () => {
    const broken = new ReefClubHealthController({
      $queryRaw: async () => {
        throw new Error("nincs adatbázis");
      },
    } as never);
    process.env[DIAG_UNTIL_ENV] = soon();
    await assert.rejects(() => broken.health(request));
  });
});
