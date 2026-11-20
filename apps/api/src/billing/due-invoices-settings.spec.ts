import "reflect-metadata";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BadRequestException } from "@nestjs/common";
import { PERMISSIONS } from "@acropora/types";

import { REQUIRED_PERMISSIONS_KEY } from "../auth/decorators/require-permissions.decorator.js";
import {
  DueInvoicesSettingsController,
  dueInvoicesSettingsView,
} from "./due-invoices-settings.controller.js";
import {
  checkDueInvoicesSettings,
  DEFAULT_DUE_INVOICES_SETTINGS,
  isMailAddress,
  MAX_RECIPIENTS,
} from "./due-invoices-settings.js";
import type {
  DueInvoicesSettingsRepository,
  DueInvoicesSettingsRow,
} from "./due-invoices-settings.repository.js";

/*
  A LEJÁRÓ SZÁMLÁK LEVELÉNEK BEÁLLÍTÁSA (Balázs, 2026-11-20; acrobot 58227, 58274; barracuda 58276). MI PIROSÍT: ha egy rossz alakú cím (szóköz, vessző,
  nyitó zárójel, sortörés, kettős @, pont nélküli tartomány) átmegy; ha a kis- és nagybetűs azonos cím két levél; ha a címzettek számát nem korlátozza;
  ha a hibás nap vagy időpont, vagy a legkorábbinál korábbi legkésőbbi időpont átmegy; ha a hiba nem mondat; ha az üres feladó nem „alapértelmezés”
  (`null`); ha a mentés a hibás bemenetre ír; ha a beállítás jog nélkül elérhető; ha a lap nem mutatja az alapértelmezett feladót és az utolsó küldést.
*/
const good = {
  enabled: true,
  recipients: ["Balazs@Acropora.hu", " penzugy@acropora.hu "],
  fromAddress: "" as string | null,
  weekday: 1,
  earliest: "07:00",
  latest: "12:00",
};

describe("checking the settings before a save", () => {
  it("takes good settings: the recipients lower-cased, trimmed and deduplicated, an empty sender is null", () => {
    const out = checkDueInvoicesSettings({
      ...good,
      recipients: [...good.recipients, "BALAZS@acropora.hu"],
    });
    assert.deepEqual(out, {
      ok: true,
      value: {
        enabled: true,
        recipients: ["balazs@acropora.hu", "penzugy@acropora.hu"],
        fromAddress: null,
        weekday: 1,
        earliest: "07:00",
        latest: "12:00",
      },
    });
  });

  it("a sender address is kept lower-cased; no recipients is allowed (nothing is sent then)", () => {
    const out = checkDueInvoicesSettings({
      ...good,
      recipients: [],
      fromAddress: " Info@Acropora.hu ",
    });
    assert.equal(out.ok, true);
    if (out.ok) {
      assert.equal(out.value.fromAddress, "info@acropora.hu");
      assert.deepEqual(out.value.recipients, []);
    }
  });

  it("refuses a malformed address as a recipient and as the sender, with a sentence", () => {
    for (const bad of [
      "nem cim",
      "a@b",
      "a@@b.hu",
      "a b@c.hu",
      "a,b@c.hu",
      "<a@c.hu>",
      "a@c.hu\nBcc: x@y.hu",
      '"a"@c.hu',
      "",
      "@c.hu",
    ]) {
      assert.equal(isMailAddress(bad), false, JSON.stringify(bad));
      const out = checkDueInvoicesSettings({ ...good, recipients: [bad] });
      assert.equal(out.ok, false, JSON.stringify(bad));
      if (!out.ok) assert.match(out.errors[0]!, /^Érvénytelen címzett/);
    }
    const sender = checkDueInvoicesSettings({
      ...good,
      fromAddress: "nem cim",
    });
    assert.deepEqual(sender, {
      ok: false,
      errors: ["Érvénytelen feladó cím."],
    });
  });

  it("caps the number of recipients", () => {
    const many = Array.from(
      { length: MAX_RECIPIENTS + 1 },
      (_, i) => `a${i}@acropora.hu`,
    );
    const out = checkDueInvoicesSettings({ ...good, recipients: many });
    assert.equal(out.ok, false);
    assert.equal(
      checkDueInvoicesSettings({
        ...good,
        recipients: many.slice(0, MAX_RECIPIENTS),
      }).ok,
      true,
    );
  });

  it("refuses a weekday outside 1..7 and a time that is not HH:MM", () => {
    for (const weekday of [0, 8, 1.5, "1", null])
      assert.equal(
        checkDueInvoicesSettings({ ...good, weekday }).ok,
        false,
        String(weekday),
      );
    for (const weekday of [1, 7])
      assert.equal(checkDueInvoicesSettings({ ...good, weekday }).ok, true);
    for (const earliest of ["7:00", "24:00", "07:60", "", "nem idő"])
      assert.equal(
        checkDueInvoicesSettings({ ...good, earliest }).ok,
        false,
        earliest,
      );
    const bothBad = checkDueInvoicesSettings({
      ...good,
      earliest: "x",
      latest: "y",
    });
    assert.equal(bothBad.ok, false);
    if (!bothBad.ok) assert.equal(bothBad.errors.length, 2);
  });

  it("refuses a latest time before the earliest, and allows the same time", () => {
    const out = checkDueInvoicesSettings({
      ...good,
      earliest: "09:00",
      latest: "08:59",
    });
    assert.deepEqual(out, {
      ok: false,
      errors: ["A legkésőbbi időpont nem lehet a legkorábbinál korábbi."],
    });
    assert.equal(
      checkDueInvoicesSettings({ ...good, earliest: "09:00", latest: "09:00" })
        .ok,
      true,
    );
  });

  it("refuses a missing or non-boolean switch and a missing recipient list", () => {
    assert.equal(
      checkDueInvoicesSettings({ ...good, enabled: "true" }).ok,
      false,
    );
    assert.equal(
      checkDueInvoicesSettings({ ...good, recipients: undefined }).ok,
      false,
    );
  });

  it("the no-row state is the defaults with no recipients, so nothing is sent", () => {
    assert.deepEqual(DEFAULT_DUE_INVOICES_SETTINGS, {
      enabled: true,
      weekday: 1,
      earliest: "07:00",
      latest: "12:00",
      recipients: [],
      fromAddress: null,
    });
  });
});

describe("the settings endpoint", () => {
  const row = (
    over: Partial<DueInvoicesSettingsRow> = {},
  ): DueInvoicesSettingsRow => ({
    ...DEFAULT_DUE_INVOICES_SETTINGS,
    lastSentDay: null,
    lastSentAt: null,
    lastSentRecipients: null,
    ...over,
  });
  const repo = (state: { row: DueInvoicesSettingsRow; saved: unknown[] }) =>
    ({
      get: async () => state.row,
      save: async (value: unknown) => {
        state.saved.push(value);
      },
    }) as unknown as DueInvoicesSettingsRepository;

  it("asks for finance.manage, on reading and on writing", () => {
    assert.deepEqual(
      Reflect.getMetadata(
        REQUIRED_PERMISSIONS_KEY,
        DueInvoicesSettingsController,
      ),
      [PERMISSIONS.FINANCE_MANAGE],
    );
  });

  it("the view carries the default sender from the environment and the last send", () => {
    const view = dueInvoicesSettingsView(
      row({
        lastSentDay: "2026-11-23",
        lastSentAt: new Date("2026-11-23T07:15:00Z"),
        lastSentRecipients: 2,
      }),
      { DUE_INVOICES_MAIL_FROM: "info@acropora.example" },
    );
    assert.equal(view.defaultFromAddress, "info@acropora.example");
    assert.deepEqual(view.lastSent, {
      day: "2026-11-23",
      at: "2026-11-23T07:15:00.000Z",
      recipients: 2,
    });
    assert.equal(dueInvoicesSettingsView(row(), {}).lastSent, null);
    assert.equal(dueInvoicesSettingsView(row(), {}).defaultFromAddress, null);
  });

  it("saves the cleaned value, and a bad body is a 400 that writes nothing", async () => {
    const state = { row: row(), saved: [] as unknown[] };
    const controller = new DueInvoicesSettingsController(repo(state));
    const user = { id: "user-1" } as never;
    await controller.save({ ...good, fromAddress: null } as never, user);
    assert.deepEqual(state.saved, [
      {
        enabled: true,
        recipients: ["balazs@acropora.hu", "penzugy@acropora.hu"],
        fromAddress: null,
        weekday: 1,
        earliest: "07:00",
        latest: "12:00",
      },
    ]);
    await assert.rejects(
      controller.save({ ...good, recipients: ["rossz cim"] } as never, user),
      BadRequestException,
    );
    assert.equal(state.saved.length, 1);
  });
});
