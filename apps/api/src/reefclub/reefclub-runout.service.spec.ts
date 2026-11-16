import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  RUNOUT_CONSENT_IS_DRAFT,
  RUNOUT_CONSENT_TEXT,
  RUNOUT_CONSENT_VERSION,
  reminderIdFromKey,
  runOutAvailability,
  unsubscribeKeyFor,
} from "./reefclub-runout-consent.js";
import { ReefClubRunOutService } from "./reefclub-runout.service.js";

/*
  THE RUN-OUT REMINDER'S CONSENT (ReefClub V3.2, slice 2). WHAT TURNS THIS RED: a consent recorded while the switch is off or the
  consent text is not given (either one alone must stop it, and today the text IS not given); a row that does not name the text
  version and the time it was given at; an aquarium with no litres taking the reminder; a foreign aquarium answering anything but
  the 404; the unsubscribe key not unique-looking, or a second click on it an error; turning it on again not clearing the
  unsubscribe; a product off the run-out list turned on; a product that does not exist (the foreign key) not a named refusal, and an aquarium that vanished mid-write reported
  as a missing product; the key stored in a row, or an old mail's link ending (a copy of the table must not unsubscribe, and every sent link must work); no secret still recording a consent.
*/
const NOW = new Date("2026-11-09T10:00:00Z");
const TEXT = "Hozzájárulok, hogy emlékeztető levelet kapjak.";
const SECRET = "proba-nem-valodi".padEnd(40, "-");
const ON = {
  REEFCLUB_RUNOUT_ENABLED: "true",
  REEFCLUB_RUNOUT_UNSUBSCRIBE_SECRET: SECRET,
};

type Row = {
  id: string;
  accountId: string;
  productId: string;
  aquariumId: string;
  consentVersion: string;
  consentAt: Date;
  unsubscribedAt: Date | null;
};

function setup(
  over: { litres?: unknown; fkField?: string; unlisted?: string[] } = {},
) {
  const rows: Row[] = [];
  const database = {
    aquarium: {
      findUnique: async () => ({
        systemVolumeLiters: over.litres === undefined ? "300" : over.litres,
      }),
    },
    reefClubRunOutReminder: {
      upsert: async ({ where, create, update }: any) => {
        if (over.fkField !== undefined)
          throw Object.assign(new Error("fk"), {
            code: "P2003",
            meta: { field_name: over.fkField },
          });
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
            (where.id === undefined || r.id === where.id) &&
            r.unsubscribedAt === where.unsubscribedAt,
        );
        for (const r of hit) Object.assign(r, data);
        return { count: hit.length };
      },
      findUnique: async ({ where }: any) =>
        rows.find((r) => r.id === where.id) ?? null,
      findMany: async ({ where }: any) =>
        rows
          .filter(
            (r) =>
              r.accountId === where.accountId &&
              r.unsubscribedAt === where.unsubscribedAt,
          )
          .sort((x, y) => x.consentAt.getTime() - y.consentAt.getTime()),
    },
    reefClubRunOutProduct: {
      // the run-out list: p1, p2, p3 and "nincs-fk" (listed, but its foreign key fails) are on it, "nincs" is not
      findUnique: async ({ where }: any) =>
        ["p1", "p2", "p3", "nincs-fk"].includes(where.productId) &&
        !over.unlisted?.includes(where.productId)
          ? { productId: where.productId }
          : null,
      findMany: async ({ where }: any) =>
        [
          {
            productId: "p1",
            productName: "Kalcium oldat 500 ml",
            packageText: "500 ml",
          },
          { productId: "p9", productName: "Másik", packageText: "1 l" },
        ]
          .filter((row) => !where || where.productId.in.includes(row.productId))
          .map((row) =>
            where
              ? { productId: row.productId, productName: row.productName }
              : row,
          ),
    },
  };
  const access = {
    aquariumForAccount: async (_accountId: string, aquariumId: string) => {
      if (aquariumId === "foreign") throw new Error("NOT_FOUND_404");
      return { aquariumId, origin: "OWN" as const };
    },
  };
  const service = new ReefClubRunOutService(access as never, database as never);
  service.environment = ON;
  return { service, rows };
}

describe("the two locks: the switch and the consent text", () => {
  it("is off with the switch unset, with anything but exactly 'true', and while there is no text", () => {
    assert.deepEqual(runOutAvailability({}, TEXT), { kind: "off" });
    for (const value of ["1", "True", "on", "yes", ""])
      assert.deepEqual(
        runOutAvailability({ REEFCLUB_RUNOUT_ENABLED: value }, TEXT),
        { kind: "off" },
        value,
      );
    // the switch on, but no text: still nothing
    assert.deepEqual(runOutAvailability(ON, null), { kind: "no-text" });
    assert.deepEqual(runOutAvailability(ON, "  "), { kind: "no-text" });
    assert.deepEqual(runOutAvailability(ON, TEXT, "kifogyas-1.0"), {
      kind: "available",
      text: TEXT,
      version: "kifogyas-1.0",
    });
  });

  it("without a usable secret (missing, or under 32 characters) nothing is recorded: the third lock", () => {
    for (const secret of [undefined, "", "rovid", "x".repeat(31)])
      assert.deepEqual(
        runOutAvailability(
          {
            REEFCLUB_RUNOUT_ENABLED: "true",
            REEFCLUB_RUNOUT_UNSUBSCRIBE_SECRET: secret,
          },
          TEXT,
        ),
        { kind: "no-secret" },
        String(secret),
      );
  });

  it("the unsubscribe key is the row id and an HMAC of it: stable, secret-bound, and one id's key opens no other row", () => {
    const key = unsubscribeKeyFor("r1", SECRET);
    assert.match(key, /^r1\.[A-Za-z0-9_-]{43}$/);
    assert.equal(unsubscribeKeyFor("r1", SECRET), key, "the same every time");
    assert.notEqual(unsubscribeKeyFor("r2", SECRET), key);
    assert.equal(reminderIdFromKey(key, SECRET), "r1");
    // another secret does not accept it, a swapped id does not, nor does a cut or padded key
    assert.equal(reminderIdFromKey(key, SECRET + "x"), null);
    assert.equal(reminderIdFromKey(key.replace("r1.", "r2."), SECRET), null);
    for (const bad of [
      "",
      "r1",
      "r1.",
      ".abc",
      key.slice(0, -1),
      key + "A",
      `${key}.x`,
      "r1.%%%",
    ])
      assert.equal(reminderIdFromKey(bad, SECRET), null, bad);
    assert.throws(() => unsubscribeKeyFor("r1", "rovid"), /UNSUBSCRIBE_SECRET/);
    assert.throws(() => unsubscribeKeyFor("a.b", SECRET), /reminder id/);
  });
});

describe("turning it on", () => {
  it("records NOTHING while the switch is off, and nothing while the text is not given", async () => {
    const off = setup();
    off.service.environment = {};
    off.service.availability = () => runOutAvailability({}, TEXT);
    const a = await off.service.enable(
      "a1",
      {
        productId: "p1",
        aquariumId: "q1",
        consentVersion: RUNOUT_CONSENT_VERSION,
      },
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
      {
        productId: "p1",
        aquariumId: "q1",
        consentVersion: RUNOUT_CONSENT_VERSION,
      },
      NOW,
    );
    assert.equal(b.outcome === "REFUSED" && b.code, "CONSENT_TEXT_MISSING");
    assert.equal(noText.rows.length, 0);
    // and with the real defaults of today: the switch on is still not enough
    const today = setup();
    today.service.environment = ON;
    const c = await today.service.enable(
      "a1",
      {
        productId: "p1",
        aquariumId: "q1",
        consentVersion: RUNOUT_CONSENT_VERSION,
      },
      NOW,
    );
    assert.equal(c.outcome === "REFUSED" && c.code, "CONSENT_TEXT_MISSING");
    assert.equal(today.rows.length, 0);
    // switch and text given, but no unsubscribe secret: nothing is recorded either
    const noSecret = setup();
    noSecret.service.environment = { REEFCLUB_RUNOUT_ENABLED: "true" };
    noSecret.service.availability = () =>
      runOutAvailability(noSecret.service.environment, TEXT);
    const d = await noSecret.service.enable(
      "a1",
      {
        productId: "p1",
        aquariumId: "q1",
        consentVersion: RUNOUT_CONSENT_VERSION,
      },
      NOW,
    );
    assert.equal(
      d.outcome === "REFUSED" && d.code,
      "UNSUBSCRIBE_SECRET_MISSING",
    );
    assert.equal(noSecret.rows.length, 0);
  });

  it("records the time, the text version, the aquarium and a key; a second turn-on updates the same row and clears the unsubscribe", async () => {
    const { service, rows } = setup();
    service.availability = () => runOutAvailability(ON, TEXT, "kifogyas-1.0");
    const first = await service.enable(
      "a1",
      { productId: "p1", aquariumId: "q1", consentVersion: "kifogyas-1.0" },
      NOW,
    );
    assert.equal(first.outcome, "ENABLED");
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.consentVersion, "kifogyas-1.0");
    assert.equal(rows[0]!.consentAt, NOW);
    assert.equal(rows[0]!.aquariumId, "q1");
    assert.equal(rows[0]!.unsubscribedAt, null);
    const firstKey = service.unsubscribeKeyFor(rows[0]!.id);
    await service.disable("a1", "p1", NOW);
    assert.ok(rows[0]!.unsubscribedAt);
    const later = new Date("2026-11-20T10:00:00Z");
    const again = await service.enable(
      "a1",
      { productId: "p1", aquariumId: "q2", consentVersion: "kifogyas-1.0" },
      later,
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.unsubscribedAt, null);
    assert.equal(rows[0]!.consentAt, later);
    assert.equal(rows[0]!.aquariumId, "q2");
    assert.equal(again.outcome, "ENABLED");
    // the key is the same after a turn-on again: every mail ever sent keeps a working link
    assert.equal(service.unsubscribeKeyFor(rows[0]!.id), firstKey);
  });

  it("an aquarium with no litres is refused (the days are counted from them), a foreign one is the 404, a missing product a named refusal", async () => {
    for (const litres of [null, "0", 0]) {
      const { service, rows } = setup({ litres });
      service.availability = () => runOutAvailability(ON, TEXT);
      const r = await service.enable(
        "a1",
        {
          productId: "p1",
          aquariumId: "q1",
          consentVersion: RUNOUT_CONSENT_VERSION,
        },
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
        {
          productId: "p1",
          aquariumId: "foreign",
          consentVersion: RUNOUT_CONSENT_VERSION,
        },
        NOW,
      ),
      /NOT_FOUND_404/,
    );
    for (const field of [
      "ReefClubRunOutReminder_productId_fkey (index)",
      "productId",
    ]) {
      const missing = setup({ fkField: field });
      missing.service.availability = () => runOutAvailability(ON, TEXT);
      const m = await missing.service.enable(
        "a1",
        {
          productId: "nincs-fk",
          aquariumId: "q1",
          consentVersion: RUNOUT_CONSENT_VERSION,
        },
        NOW,
      );
      assert.equal(
        m.outcome === "REFUSED" && m.code,
        "PRODUCT_NOT_FOUND",
        field,
      );
    }
  });

  it("a product that is not on the run-out list is refused BEFORE anything is written (barracuda, #2344): the sender could not count it", async () => {
    const { service, rows } = setup({ unlisted: ["p1"] });
    service.availability = () => runOutAvailability(ON, TEXT);
    for (const productId of ["p1", "nincs"]) {
      const r = await service.enable(
        "a1",
        { productId, aquariumId: "q1", consentVersion: RUNOUT_CONSENT_VERSION },
        NOW,
      );
      assert.equal(
        r.outcome === "REFUSED" && r.code,
        "PRODUCT_NOT_FOUND",
        productId,
      );
    }
    assert.equal(rows.length, 0);
    // a foreign aquarium still answers the one 404 first, whatever the product
    await assert.rejects(
      service.enable(
        "a1",
        {
          productId: "nincs",
          aquariumId: "foreign",
          consentVersion: RUNOUT_CONSENT_VERSION,
        },
        NOW,
      ),
      /NOT_FOUND_404/,
    );
  });

  it("a foreign key failure on the AQUARIUM is the 404 (not a missing product), and one it cannot place is rethrown, never labelled", async () => {
    const gone = setup({
      fkField: "ReefClubRunOutReminder_aquariumId_fkey (index)",
    });
    gone.service.availability = () => runOutAvailability(ON, TEXT);
    await assert.rejects(
      gone.service.enable(
        "a1",
        {
          productId: "p1",
          aquariumId: "q1",
          consentVersion: RUNOUT_CONSENT_VERSION,
        },
        NOW,
      ),
      (error: Error) => error.name === "NotFoundException",
    );
    for (const field of ["ReefClubRunOutReminder_accountId_fkey (index)", ""]) {
      const odd = setup({ fkField: field });
      odd.service.availability = () => runOutAvailability(ON, TEXT);
      await assert.rejects(
        odd.service.enable(
          "a1",
          {
            productId: "p1",
            aquariumId: "q1",
            consentVersion: RUNOUT_CONSENT_VERSION,
          },
          NOW,
        ),
        /fk/,
        field,
      );
    }
  });
});

describe("the page's view and the text version", () => {
  it("shows the state of the locks, and the text and its version ONLY when every lock is open", () => {
    const { service } = setup();
    service.availability = () => runOutAvailability({}, TEXT);
    assert.deepEqual(service.status(), {
      state: "off",
      text: null,
      version: null,
    });
    service.availability = () => runOutAvailability(ON, null);
    assert.deepEqual(service.status(), {
      state: "no-text",
      text: null,
      version: null,
    });
    service.availability = () =>
      runOutAvailability({ REEFCLUB_RUNOUT_ENABLED: "true" }, TEXT);
    assert.deepEqual(service.status(), {
      state: "no-secret",
      text: null,
      version: null,
    });
    service.availability = () => runOutAvailability(ON, TEXT, "kifogyas-1.0");
    assert.deepEqual(service.status(), {
      state: "available",
      text: TEXT,
      version: "kifogyas-1.0",
    });
    // and with the real text (today a draft) where the draft is not allowed, the page gets no text to ask consent for
    service.availability = () => runOutAvailability(ON);
    assert.equal(service.status().text, null);
  });

  it("a page that showed another text version records NOTHING, before the aquarium is even looked at", async () => {
    const { service, rows } = setup();
    service.availability = () => runOutAvailability(ON, TEXT, "kifogyas-2.0");
    for (const consentVersion of ["kifogyas-1.0", RUNOUT_CONSENT_VERSION, ""]) {
      const r = await service.enable(
        "a1",
        { productId: "p1", aquariumId: "foreign", consentVersion },
        NOW,
      );
      assert.equal(
        r.outcome === "REFUSED" && r.code,
        "CONSENT_VERSION_CHANGED",
        consentVersion,
      );
    }
    assert.equal(rows.length, 0);
  });

  it("offers the run-out list's products only while every lock is open", async () => {
    const { service } = setup();
    service.availability = () => runOutAvailability(ON, null);
    assert.deepEqual(await service.products(), []);
    service.availability = () => runOutAvailability(ON, TEXT);
    assert.deepEqual(
      (await service.products()).map((p) => p.productId),
      ["p1", "p9"],
    );
  });

  it("lists only the member's reminders that are on, with the dose list's product name (null where it has none)", async () => {
    const { service, rows } = setup();
    service.availability = () => runOutAvailability(ON, TEXT, "v1");
    assert.deepEqual(await service.list("a1"), []);
    const later = new Date("2026-11-10T10:00:00Z");
    await service.enable(
      "a1",
      { productId: "p2", aquariumId: "q1", consentVersion: "v1" },
      later,
    );
    await service.enable(
      "a1",
      { productId: "p1", aquariumId: "q2", consentVersion: "v1" },
      NOW,
    );
    await service.enable(
      "a1",
      { productId: "p3", aquariumId: "q1", consentVersion: "v1" },
      NOW,
    );
    await service.enable(
      "masik",
      { productId: "p1", aquariumId: "q9", consentVersion: "v1" },
      NOW,
    );
    await service.disable("a1", "p3", NOW);
    assert.equal(rows.length, 4);
    assert.deepEqual(await service.list("a1"), [
      {
        id: rows.find((r) => r.productId === "p1" && r.accountId === "a1")!.id,
        productId: "p1",
        productName: "Kalcium oldat 500 ml",
        aquariumId: "q2",
        consentAt: NOW.toISOString(),
      },
      {
        id: rows.find((r) => r.productId === "p2")!.id,
        productId: "p2",
        productName: null,
        aquariumId: "q1",
        consentAt: later.toISOString(),
      },
    ]);
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
      {
        productId: "p1",
        aquariumId: "q1",
        consentVersion: RUNOUT_CONSENT_VERSION,
      },
      NOW,
    );
    assert.equal(on.outcome, "ENABLED");
    const id = on.outcome === "ENABLED" ? on.id : "";
    const key = service.unsubscribeKeyFor(id);
    // NOTHING IN THE ROW COULD UNSUBSCRIBE: the key is in no field, and the row's own id alone is not a key
    assert.ok(!JSON.stringify(rows).includes(key));
    assert.deepEqual(await service.unsubscribeByKey(id, NOW), {
      outcome: "UNKNOWN_KEY",
    });
    assert.equal(rows[0]!.unsubscribedAt, null);
    assert.deepEqual(await service.unsubscribeByKey("rossz-kulcs", NOW), {
      outcome: "UNKNOWN_KEY",
    });
    assert.deepEqual(await service.unsubscribeByKey("", NOW), {
      outcome: "UNKNOWN_KEY",
    });
    assert.deepEqual(await service.unsubscribeByKey(key, NOW), {
      outcome: "UNSUBSCRIBED",
    });
    assert.equal(rows[0]!.unsubscribedAt, NOW);
    assert.deepEqual(
      await service.unsubscribeByKey(key, new Date("2027-01-01")),
      { outcome: "ALREADY_UNSUBSCRIBED" },
    );
    // the first unsubscribe time stays
    assert.equal(rows[0]!.unsubscribedAt, NOW);
  });

  it("EVERY mail's link keeps working: an old key unsubscribes after a newer mail, and a missing secret is loud, not a silent unknown", async () => {
    const { service } = setup();
    service.availability = () => runOutAvailability(ON, TEXT);
    const on = await service.enable(
      "a1",
      {
        productId: "p1",
        aquariumId: "q1",
        consentVersion: RUNOUT_CONSENT_VERSION,
      },
      NOW,
    );
    const id = on.outcome === "ENABLED" ? on.id : "";
    const older = service.unsubscribeKeyFor(id);
    const newer = service.unsubscribeKeyFor(id);
    assert.equal(older, newer);
    assert.deepEqual(await service.unsubscribeByKey(older, NOW), {
      outcome: "UNSUBSCRIBED",
    });
    service.environment = {};
    assert.throws(() => service.unsubscribeKeyFor(id), /UNSUBSCRIBE_SECRET/);
    await assert.rejects(
      service.unsubscribeByKey(older, NOW),
      /UNSUBSCRIBE_SECRET/,
    );
  });

  it("a valid key of a row that is gone is UNKNOWN_KEY", async () => {
    const { service } = setup();
    assert.deepEqual(
      await service.unsubscribeByKey(unsubscribeKeyFor("torolt", SECRET), NOW),
      { outcome: "UNKNOWN_KEY" },
    );
  });

  it("today's text is the DRAFT, with a version that says so (the final text comes with a new version)", () => {
    assert.equal(RUNOUT_CONSENT_IS_DRAFT, true);
    assert.match(RUNOUT_CONSENT_VERSION, /tervezet/);
    assert.match(
      RUNOUT_CONSENT_TEXT ?? "",
      /^Kérem, hogy a ReefClub e-mailben szóljon/,
    );
  });
});

/*
  THE FOURTH LOCK WHILE THE TEXT IS A DRAFT (acrobot 48513): WHAT TURNS THIS RED: the draft text recordable where
  `REEFCLUB_RUNOUT_ALLOW_DRAFT_TEXT` is not exactly "true" (production never sets it), even with the other three open; the
  draft not recordable on the test site; the permission changing anything for a text that is not a draft.
*/
describe("the draft text: only where the draft is allowed", () => {
  it("with the switch and the secret set, the draft is still no text without the permission, or with anything but exactly 'true'", () => {
    assert.deepEqual(runOutAvailability(ON), { kind: "no-text" });
    for (const value of ["1", "True", "yes", ""])
      assert.deepEqual(
        runOutAvailability({ ...ON, REEFCLUB_RUNOUT_ALLOW_DRAFT_TEXT: value }),
        { kind: "no-text" },
        value,
      );
  });

  it("on the test site (the permission set) the draft is offered, with the draft version", () => {
    assert.deepEqual(
      runOutAvailability({ ...ON, REEFCLUB_RUNOUT_ALLOW_DRAFT_TEXT: "true" }),
      {
        kind: "available",
        text: RUNOUT_CONSENT_TEXT,
        version: RUNOUT_CONSENT_VERSION,
      },
    );
  });

  it("the permission alone opens nothing: the switch still decides", () => {
    assert.deepEqual(
      runOutAvailability({ REEFCLUB_RUNOUT_ALLOW_DRAFT_TEXT: "true" }),
      { kind: "off" },
    );
  });

  it("a final text (not a draft) does not need the permission", () => {
    assert.deepEqual(runOutAvailability(ON, TEXT, "kifogyas-1.0", false), {
      kind: "available",
      text: TEXT,
      version: "kifogyas-1.0",
    });
  });
});
