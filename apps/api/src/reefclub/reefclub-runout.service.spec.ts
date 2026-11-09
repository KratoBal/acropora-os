import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  RUNOUT_CONSENT_TEXT,
  RUNOUT_CONSENT_VERSION,
  newUnsubscribeToken,
  runOutAvailability,
} from "./reefclub-runout-consent.js";
import { ReefClubRunOutService } from "./reefclub-runout.service.js";

/*
  THE RUN-OUT REMINDER'S CONSENT (ReefClub V3.2, slice 2). WHAT TURNS THIS RED: a consent recorded while the switch is off or the
  consent text is not given (either one alone must stop it, and today the text IS not given); a row that does not name the text
  version and the time it was given at; an aquarium with no litres taking the reminder; a foreign aquarium answering anything but
  the 404; the unsubscribe key not unique-looking, or a second click on it an error; turning it on again not clearing the
  unsubscribe; a product that does not exist (the foreign key) not a named refusal.
*/
const NOW = new Date("2026-11-09T10:00:00Z");
const TEXT = "Hozzájárulok, hogy emlékeztető levelet kapjak.";
const ON = { REEFCLUB_RUNOUT_ENABLED: "true" };

type Row = {
  id: string;
  accountId: string;
  productId: string;
  aquariumId: string;
  consentVersion: string;
  consentAt: Date;
  unsubscribedAt: Date | null;
  unsubscribeToken: string;
};

function setup(over: { litres?: unknown; missingProduct?: boolean } = {}) {
  const rows: Row[] = [];
  const database = {
    aquarium: {
      findUnique: async () => ({
        systemVolumeLiters: over.litres === undefined ? "300" : over.litres,
      }),
    },
    reefClubRunOutReminder: {
      upsert: async ({ where, create, update }: any) => {
        if (over.missingProduct)
          throw Object.assign(new Error("fk"), { code: "P2003" });
        const key = where.accountId_productId;
        const row = rows.find(
          (r) => r.accountId === key.accountId && r.productId === key.productId,
        );
        if (row) return Object.assign(row, update);
        const created = {
          id: `r${rows.length + 1}`,
          unsubscribedAt: null,
          ...create,
        };
        rows.push(created);
        return created;
      },
      updateMany: async ({ where, data }: any) => {
        const hit = rows.filter(
          (r) =>
            (where.accountId === undefined ||
              r.accountId === where.accountId) &&
            (where.productId === undefined ||
              r.productId === where.productId) &&
            (where.unsubscribeToken === undefined ||
              r.unsubscribeToken === where.unsubscribeToken) &&
            r.unsubscribedAt === where.unsubscribedAt,
        );
        for (const r of hit) Object.assign(r, data);
        return { count: hit.length };
      },
      findUnique: async ({ where }: any) =>
        rows.find((r) => r.unsubscribeToken === where.unsubscribeToken) ?? null,
    },
  };
  const access = {
    aquariumForAccount: async (_accountId: string, aquariumId: string) => {
      if (aquariumId === "foreign") throw new Error("NOT_FOUND_404");
      return { aquariumId, origin: "OWN" as const };
    },
  };
  const service = new ReefClubRunOutService(access as never, database as never);
  return { service, rows };
}

describe("the two locks: the switch and the consent text", () => {
  it("is off with the switch unset, with anything but exactly 'true', and while the text is not given (today)", () => {
    assert.equal(RUNOUT_CONSENT_TEXT, null);
    assert.deepEqual(runOutAvailability({}, TEXT), { kind: "off" });
    for (const value of ["1", "True", "on", "yes", ""])
      assert.deepEqual(
        runOutAvailability({ REEFCLUB_RUNOUT_ENABLED: value }, TEXT),
        { kind: "off" },
        value,
      );
    // the switch on, but today's text (null): still nothing
    assert.deepEqual(runOutAvailability(ON), { kind: "no-text" });
    assert.deepEqual(runOutAvailability(ON, "  "), { kind: "no-text" });
    assert.deepEqual(runOutAvailability(ON, TEXT, "kifogyas-1.0"), {
      kind: "available",
      text: TEXT,
      version: "kifogyas-1.0",
    });
  });

  it("the unsubscribe key is 32 random bytes, base64url, never the same twice", () => {
    const keys = new Set(Array.from({ length: 50 }, newUnsubscribeToken));
    assert.equal(keys.size, 50);
    for (const key of keys) assert.match(key, /^[A-Za-z0-9_-]{43}$/);
  });
});

describe("turning it on", () => {
  it("records NOTHING while the switch is off, and nothing while the text is not given", async () => {
    const off = setup();
    off.service.environment = {};
    off.service.availability = () => runOutAvailability({}, TEXT);
    const a = await off.service.enable(
      "a1",
      { productId: "p1", aquariumId: "q1" },
      NOW,
    );
    assert.deepEqual(a, {
      outcome: "REFUSED",
      code: "FEATURE_OFF",
      message: a.outcome === "REFUSED" ? a.message : "",
    });
    assert.equal(off.rows.length, 0);
    const noText = setup();
    noText.service.availability = () => runOutAvailability(ON, null);
    const b = await noText.service.enable(
      "a1",
      { productId: "p1", aquariumId: "q1" },
      NOW,
    );
    assert.equal(b.outcome === "REFUSED" && b.code, "CONSENT_TEXT_MISSING");
    assert.equal(noText.rows.length, 0);
    // and with the real defaults of today: the switch on is still not enough
    const today = setup();
    today.service.environment = ON;
    const c = await today.service.enable(
      "a1",
      { productId: "p1", aquariumId: "q1" },
      NOW,
    );
    assert.equal(c.outcome === "REFUSED" && c.code, "CONSENT_TEXT_MISSING");
    assert.equal(today.rows.length, 0);
  });

  it("records the time, the text version, the aquarium and a key; a second turn-on updates the same row and clears the unsubscribe", async () => {
    const { service, rows } = setup();
    service.availability = () => runOutAvailability(ON, TEXT, "kifogyas-1.0");
    const first = await service.enable(
      "a1",
      { productId: "p1", aquariumId: "q1" },
      NOW,
    );
    assert.equal(first.outcome, "ENABLED");
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.consentVersion, "kifogyas-1.0");
    assert.equal(rows[0]!.consentAt, NOW);
    assert.equal(rows[0]!.aquariumId, "q1");
    assert.equal(rows[0]!.unsubscribedAt, null);
    await service.disable("a1", "p1", NOW);
    assert.ok(rows[0]!.unsubscribedAt);
    const later = new Date("2026-11-20T10:00:00Z");
    const again = await service.enable(
      "a1",
      { productId: "p1", aquariumId: "q2" },
      later,
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.unsubscribedAt, null);
    assert.equal(rows[0]!.consentAt, later);
    assert.equal(rows[0]!.aquariumId, "q2");
    assert.notEqual(
      again.outcome === "ENABLED" && again.unsubscribeToken,
      first.outcome === "ENABLED" && first.unsubscribeToken,
    );
  });

  it("an aquarium with no litres is refused (the days are counted from them), a foreign one is the 404, a missing product a named refusal", async () => {
    for (const litres of [null, "0", 0]) {
      const { service, rows } = setup({ litres });
      service.availability = () => runOutAvailability(ON, TEXT);
      const r = await service.enable(
        "a1",
        { productId: "p1", aquariumId: "q1" },
        NOW,
      );
      assert.equal(
        r.outcome === "REFUSED" && r.code,
        "NO_VOLUME",
        String(litres),
      );
      assert.equal(rows.length, 0);
    }
    const foreign = setup();
    foreign.service.availability = () => runOutAvailability(ON, TEXT);
    await assert.rejects(
      foreign.service.enable(
        "a1",
        { productId: "p1", aquariumId: "foreign" },
        NOW,
      ),
      /NOT_FOUND_404/,
    );
    const missing = setup({ missingProduct: true });
    missing.service.availability = () => runOutAvailability(ON, TEXT);
    const m = await missing.service.enable(
      "a1",
      { productId: "nincs", aquariumId: "q1" },
      NOW,
    );
    assert.equal(m.outcome === "REFUSED" && m.code, "PRODUCT_NOT_FOUND");
  });
});

describe("turning it off and the unsubscribe link", () => {
  it("disable answers NOT_ACTIVE for a row that is not on, and the link unsubscribes once, then says already, then says unknown for a wrong key", async () => {
    const { service, rows } = setup();
    service.availability = () => runOutAvailability(ON, TEXT);
    assert.deepEqual(await service.disable("a1", "p1", NOW), {
      outcome: "NOT_ACTIVE",
    });
    const on = await service.enable(
      "a1",
      { productId: "p1", aquariumId: "q1" },
      NOW,
    );
    assert.equal(on.outcome, "ENABLED");
    const key = on.outcome === "ENABLED" ? on.unsubscribeToken : "";
    assert.deepEqual(await service.unsubscribeByToken("rossz-kulcs", NOW), {
      outcome: "UNKNOWN_KEY",
    });
    assert.deepEqual(await service.unsubscribeByToken("", NOW), {
      outcome: "UNKNOWN_KEY",
    });
    assert.deepEqual(await service.unsubscribeByToken(key, NOW), {
      outcome: "UNSUBSCRIBED",
    });
    assert.equal(rows[0]!.unsubscribedAt, NOW);
    assert.deepEqual(
      await service.unsubscribeByToken(key, new Date("2027-01-01")),
      { outcome: "ALREADY_UNSUBSCRIBED" },
    );
    // the first unsubscribe time stays
    assert.equal(rows[0]!.unsubscribedAt, NOW);
  });

  it("the placeholder version label exists and the text is still null (a text is given together with a new version)", () => {
    assert.equal(RUNOUT_CONSENT_VERSION, "kifogyas-emlekezteto-helyorzo");
  });
});
