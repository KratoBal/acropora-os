import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  budapestClock,
  DEFAULT_DUE_INVOICES_MAIL_SETTINGS,
  decideDueInvoicesMail,
  minutesOf,
  type DueInvoicesMailSettings,
} from "./due-invoices-send-rule.js";

/*
  A HETI LEVÉL KÜLDÉSI SZABÁLYA (Balázs, 2026-11-20 14:52 UTC; acrobot 58230). MI PIROSÍT: ha a levél a legkorábbi időpont előtt megy;
  ha az aznapi első banki betöltés előtt megy (a legkésőbbi időpontig); ha a betöltés nélküli nap a legkésőbbi időpontnál sem megy ki;
  ha a legkésőbbi időponti küldés nem jelöli a „nem jött új banki adat” értesítést, vagy a betöltés utáni igen; ha egy nap kétszer megy;
  ha nem a beállított napon megy; ha a kikapcsolt beállítás is küld; ha a budapesti fali órát nem követi (nyári és téli idő); ha a hibás
  időpont-szöveg elrontja a döntést; ha a legkésőbbi a legkorábbinál korábbra állítva a legkorábbi előtt küld.
*/
// 2026-11-23 hétfő, téli idő (CET = UTC+1): 07:00 Budapest = 06:00 UTC
const at = (hhmm: string, day = "2026-11-23") => {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return new Date(
    `${day}T${String(h - 1).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`,
  );
};
const settings = (
  over: Partial<DueInvoicesMailSettings> = {},
): DueInvoicesMailSettings => ({
  ...DEFAULT_DUE_INVOICES_MAIL_SETTINGS,
  ...over,
});
const load = new Date("2026-11-23T07:15:00Z");
const decide = (
  now: Date,
  over: Partial<DueInvoicesMailSettings> = {},
  state: { lastSentDay?: string | null; firstBankLoadToday?: Date | null } = {},
) =>
  decideDueInvoicesMail({
    now,
    settings: settings(over),
    lastSentDay: state.lastSentDay ?? null,
    firstBankLoadToday: state.firstBankLoadToday ?? null,
  });

describe("the weekly due-invoices mail rule", () => {
  it("the defaults are Monday, 07:00 earliest, 12:00 latest, on", () => {
    assert.deepEqual(DEFAULT_DUE_INVOICES_MAIL_SETTINGS, {
      enabled: true,
      weekday: 1,
      earliest: "07:00",
      latest: "12:00",
    });
  });

  it("nothing goes before the earliest time, even with a bank load already in", () => {
    assert.deepEqual(decide(at("06:59"), {}, { firstBankLoadToday: load }), {
      action: "WAIT",
      reason: "BEFORE_EARLIEST",
    });
  });

  it("from the earliest time on, the first bank load of the day sends it, without the late notice", () => {
    assert.deepEqual(decide(at("07:00"), {}, { firstBankLoadToday: load }), {
      action: "SEND",
      reason: "FIRST_BANK_LOAD",
      lateNotice: false,
    });
    assert.deepEqual(decide(at("11:59"), {}, { firstBankLoadToday: load }), {
      action: "SEND",
      reason: "FIRST_BANK_LOAD",
      lateNotice: false,
    });
  });

  it("without a bank load it waits until the latest time, then sends with the late notice", () => {
    assert.deepEqual(decide(at("07:00")), {
      action: "WAIT",
      reason: "NO_BANK_LOAD_YET",
    });
    assert.deepEqual(decide(at("11:59")), {
      action: "WAIT",
      reason: "NO_BANK_LOAD_YET",
    });
    assert.deepEqual(decide(at("12:00")), {
      action: "SEND",
      reason: "LATEST_TIME",
      lateNotice: true,
    });
    assert.deepEqual(decide(at("16:30")), {
      action: "SEND",
      reason: "LATEST_TIME",
      lateNotice: true,
    });
  });

  it("a bank load after the latest time still sends once, without the late notice (the load came the same day)", () => {
    assert.deepEqual(decide(at("13:00"), {}, { firstBankLoadToday: load }), {
      action: "SEND",
      reason: "FIRST_BANK_LOAD",
      lateNotice: false,
    });
  });

  it("once a day: a day that already went does not go again", () => {
    assert.deepEqual(
      decide(
        at("13:00"),
        {},
        { lastSentDay: "2026-11-23", firstBankLoadToday: load },
      ),
      { action: "WAIT", reason: "ALREADY_SENT" },
    );
    // last week's day does not block this week
    assert.equal(
      decide(
        at("13:00"),
        {},
        { lastSentDay: "2026-11-16", firstBankLoadToday: load },
      ).action,
      "SEND",
    );
  });

  it("only on the configured weekday", () => {
    // 2026-11-24 is a Tuesday
    assert.deepEqual(
      decide(at("09:00", "2026-11-24"), {}, { firstBankLoadToday: load }),
      {
        action: "WAIT",
        reason: "NOT_THE_DAY",
      },
    );
    assert.equal(
      decide(
        at("09:00", "2026-11-24"),
        { weekday: 2 },
        { firstBankLoadToday: load },
      ).action,
      "SEND",
    );
  });

  it("switched off sends nothing", () => {
    assert.deepEqual(
      decide(at("13:00"), { enabled: false }, { firstBankLoadToday: load }),
      {
        action: "WAIT",
        reason: "DISABLED",
      },
    );
  });

  it("a latest time before the earliest falls to the earliest, and a bad time text falls to the defaults", () => {
    assert.equal(
      decide(at("08:00"), { earliest: "09:00", latest: "07:00" }).action,
      "WAIT",
    );
    assert.equal(
      decide(at("09:00"), { earliest: "09:00", latest: "07:00" }).action,
      "SEND",
    );
    assert.equal(decide(at("06:59"), { earliest: "nem idő" }).action, "WAIT");
    assert.equal(decide(at("12:00"), { latest: "25:99" }).action, "SEND");
  });

  it("follows the Budapest wall clock in summer and winter", () => {
    // 2026-07-06 is a Monday in summer time (CEST = UTC+2): 07:00 Budapest = 05:00 UTC
    const summer = (utc: string) => new Date(`2026-07-06T${utc}:00Z`);
    assert.equal(
      decide(summer("04:59"), {}, { firstBankLoadToday: summer("05:30") })
        .action,
      "WAIT",
    );
    assert.equal(
      decide(summer("05:00"), {}, { firstBankLoadToday: summer("05:30") })
        .action,
      "SEND",
    );
    // winter: 06:00 UTC is 07:00
    assert.equal(
      decide(new Date("2026-11-23T05:59:00Z"), {}, { firstBankLoadToday: load })
        .action,
      "WAIT",
    );
    assert.equal(
      decide(new Date("2026-11-23T06:00:00Z"), {}, { firstBankLoadToday: load })
        .action,
      "SEND",
    );
    assert.deepEqual(budapestClock(new Date("2026-11-23T06:00:00Z")), {
      day: "2026-11-23",
      weekday: 1,
      minutes: 420,
    });
    // the Budapest day, not the UTC day, at night
    assert.equal(
      budapestClock(new Date("2026-11-23T23:30:00Z")).day,
      "2026-11-24",
    );
  });

  it("just after midnight the clock reads 00:30, not 24:30 (an ICU that counts midnight as 24 would send before the earliest time)", () => {
    // 2026-11-22T23:30:00Z is Monday 00:30 in Budapest
    const night = new Date("2026-11-22T23:30:00Z");
    assert.deepEqual(budapestClock(night), {
      day: "2026-11-23",
      weekday: 1,
      minutes: 30,
    });
    assert.deepEqual(decide(night, {}, { firstBankLoadToday: night }), {
      action: "WAIT",
      reason: "BEFORE_EARLIEST",
    });
  });

  it("minutesOf reads only HH:MM", () => {
    assert.equal(minutesOf("07:00"), 420);
    assert.equal(minutesOf("23:59"), 1439);
    for (const bad of ["7:00", "24:00", "07:60", "", "07-00", "07:00:00"])
      assert.equal(minutesOf(bad), null, bad);
  });
});
