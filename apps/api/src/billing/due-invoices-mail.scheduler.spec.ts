import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DueInvoicesMailScheduler,
  dueInvoicesSchedulerEnabled,
} from "./due-invoices-mail.scheduler.js";
import type { DueInvoicesMailService } from "./due-invoices-mail.service.js";
import { DEFAULT_DUE_INVOICES_SETTINGS } from "./due-invoices-settings.js";
import type {
  DueInvoicesSettingsRepository,
  DueInvoicesSettingsRow,
} from "./due-invoices-settings.repository.js";

/*
  A LEJÁRÓ SZÁMLÁK LEVELÉNEK ÜTEMEZŐJE (Balázs, 2026-11-20; acrobot 58230; barracuda 58276, 3. megjegyzés). MI PIROSÍT: ha a kikapcsolt vagy a
  címzett nélküli beállítás küld; ha a döntés várakozást mond, és mégis megy levél; ha a nap NEM a küldés előtt foglalódik, vagy a sikertelen
  foglalás (másik folyamat már lefoglalta) mégis küld; ha két egymás utáni kör ugyanazon a napon kétszer küld; ha a hibás küldés után a nap
  nem szabadul fel (a levél aznap soha nem menne ki); ha a hiba kidobja az ütemezőt; ha a sikeres küldés nyoma nem íródik; ha a feladó és a
  késői értesítés nem jut el a levélhez; ha a kill-switch nem kapcsolja ki a folyamatot.
*/
// 2026-11-23 hétfő, 07:30 Budapest (CET = UTC+1)
const MONDAY_0730 = new Date("2026-11-23T06:30:00Z");
const MONDAY_1230 = new Date("2026-11-23T11:30:00Z");
const BANK_LOAD = new Date("2026-11-23T06:20:00Z");

function setup(
  over: {
    row?: Partial<DueInvoicesSettingsRow>;
    load?: Date | null;
    sendFails?: boolean;
    claimable?: boolean;
  } = {},
) {
  const state = {
    row: {
      ...DEFAULT_DUE_INVOICES_SETTINGS,
      recipients: ["a@acropora.hu"],
      lastSentDay: null as string | null,
      lastSentAt: null as Date | null,
      lastSentRecipients: null as number | null,
      ...over.row,
    } as DueInvoicesSettingsRow,
    events: [] as string[],
    sends: [] as {
      recipients: readonly string[];
      lateNotice: boolean;
      from?: string;
    }[],
  };
  const settings = {
    get: async () => state.row,
    claimDay: async (day: string) => {
      state.events.push(`claim ${day}`);
      if (over.claimable === false || state.row.lastSentDay === day)
        return false;
      state.row = { ...state.row, lastSentDay: day };
      return true;
    },
    releaseDay: async (day: string, previous: string | null) => {
      state.events.push(`release ${day} -> ${previous}`);
      if (state.row.lastSentDay === day)
        state.row = { ...state.row, lastSentDay: previous };
    },
    markSent: async (_at: Date, recipients: number) => {
      state.events.push(`marked ${recipients}`);
    },
  } as unknown as DueInvoicesSettingsRepository;
  const mail = {
    send: async (input: {
      recipients: readonly string[];
      lateNotice: boolean;
      from?: string;
    }) => {
      state.events.push("send");
      if (over.sendFails) throw new Error("A küldés nem sikerült");
      state.sends.push(input);
      return { kind: "sent", recipients: input.recipients.length, count: 1 };
    },
  } as unknown as DueInvoicesMailService;
  const scheduler = new DueInvoicesMailScheduler(settings, mail);
  scheduler.firstBankLoad = async () =>
    "load" in over ? (over.load ?? null) : BANK_LOAD;
  return { scheduler, state };
}

describe("the due-invoices mail scheduler round", () => {
  it("a disabled setting and a setting without recipients send nothing", async () => {
    assert.deepEqual(
      await setup({ row: { enabled: false } }).scheduler.runOnce(MONDAY_0730),
      { kind: "disabled" },
    );
    const noRecipients = setup({ row: { recipients: [] } });
    assert.deepEqual(await noRecipients.scheduler.runOnce(MONDAY_0730), {
      kind: "no-recipients",
    });
    assert.deepEqual(noRecipients.state.events, []);
  });

  it("waits when the rule says wait: nothing is claimed, nothing is sent", async () => {
    const { scheduler, state } = setup({ load: null });
    assert.deepEqual(await scheduler.runOnce(MONDAY_0730), {
      kind: "wait",
      reason: "NO_BANK_LOAD_YET",
    });
    assert.deepEqual(state.events, []);
  });

  it("claims the day BEFORE the send, sends once, and writes the trace after", async () => {
    const { scheduler, state } = setup();
    assert.deepEqual(await scheduler.runOnce(MONDAY_0730), {
      kind: "sent",
      recipients: 1,
      late: false,
    });
    assert.deepEqual(state.events, ["claim 2026-11-23", "send", "marked 1"]);
    assert.deepEqual(state.sends[0]!.recipients, ["a@acropora.hu"]);
    assert.equal(state.sends[0]!.lateNotice, false);
  });

  it("a second round the same day does not send again", async () => {
    const { scheduler, state } = setup();
    await scheduler.runOnce(MONDAY_0730);
    assert.deepEqual(
      await scheduler.runOnce(new Date("2026-11-23T07:00:00Z")),
      { kind: "wait", reason: "ALREADY_SENT" },
    );
    assert.equal(state.sends.length, 1);
  });

  it("a day another process already claimed is not sent: no send without the claim", async () => {
    const { scheduler, state } = setup({ claimable: false });
    assert.deepEqual(await scheduler.runOnce(MONDAY_0730), {
      kind: "not-claimed",
    });
    assert.deepEqual(state.events, ["claim 2026-11-23"]);
    assert.equal(state.sends.length, 0);
  });

  it("a failed send releases the day (back to the previous one), says failed, and does not throw", async () => {
    const { scheduler, state } = setup({
      sendFails: true,
      row: { lastSentDay: "2026-11-16" },
    });
    assert.deepEqual(await scheduler.runOnce(MONDAY_0730), { kind: "failed" });
    assert.deepEqual(state.events, [
      "claim 2026-11-23",
      "send",
      "release 2026-11-23 -> 2026-11-16",
    ]);
    assert.equal(state.row.lastSentDay, "2026-11-16");
    // the next round tries again
    const retry = setup({ row: { lastSentDay: "2026-11-16" } });
    assert.equal((await retry.scheduler.runOnce(MONDAY_0730)).kind, "sent");
  });

  it("the late send carries the late notice; the configured sender reaches the mail", async () => {
    const { scheduler, state } = setup({
      load: null,
      row: { fromAddress: "info@acropora.example" },
    });
    assert.deepEqual(await scheduler.runOnce(MONDAY_1230), {
      kind: "sent",
      recipients: 1,
      late: true,
    });
    assert.equal(state.sends[0]!.lateNotice, true);
    assert.match(state.sends[0]!.from ?? "", /info@acropora\.example/);
  });

  it("the kill-switch is exactly 'off'", () => {
    assert.equal(
      dueInvoicesSchedulerEnabled({ DUE_INVOICES_MAIL_SCHEDULER: "off" }),
      false,
    );
    for (const value of [undefined, "", "on", "false", "OFF"])
      assert.equal(
        dueInvoicesSchedulerEnabled({ DUE_INVOICES_MAIL_SCHEDULER: value }),
        true,
        String(value),
      );
  });
});
