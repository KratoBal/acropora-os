import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { FoxpostSettlementController } from "./foxpost/foxpost-settlement.controller.js";
import { FoxpostSettlementScheduler } from "./foxpost/foxpost-settlement.scheduler.js";
import type { FoxpostSettlementService } from "./foxpost/foxpost-settlement.service.js";
import { GlsGmailSyncScheduler } from "./gls/gls-gmail-sync.scheduler.js";
import type { GlsGmailSyncService } from "./gls/gls-gmail-sync.service.js";
import { GlsSettlementController } from "./gls/gls-settlement.controller.js";
import type { GlsSettlementService } from "./gls/gls-settlement.service.js";

/**
 * WHO STARTED THE RUN, SAID BY THE ONE WHO STARTS IT (2026-09-29).
 *
 * The pages show the last AUTOMATIC run, because "does the pull run by
 * itself" was a question acrobot answered by hand that morning: the Foxpost
 * pull had not, for seven weeks. The timer must record SCHEDULED and the
 * button MANUAL; if the two were swapped or both said the same, the page
 * would answer the question wrongly and look sure of it.
 */
function recorder() {
  const triggers: string[] = [];
  const sync = async (trigger: string) => {
    triggers.push(trigger);
    return {};
  };
  return { triggers, sync };
}

describe("the Gmail pull records who started it", () => {
  it("the GLS timer says SCHEDULED, the GLS button MANUAL", async () => {
    const { triggers, sync } = recorder();
    const service = { sync } as unknown as GlsGmailSyncService;
    await new GlsGmailSyncScheduler(service).runOnce();
    await new GlsSettlementController(
      {} as GlsSettlementService,
      service,
    ).syncNow();
    assert.deepEqual(triggers, ["SCHEDULED", "MANUAL"]);
  });

  it("the Foxpost timer says SCHEDULED, the Foxpost button MANUAL", async () => {
    const { triggers, sync } = recorder();
    const service = { sync } as unknown as FoxpostSettlementService;
    await new FoxpostSettlementScheduler(service).runOnce();
    await new FoxpostSettlementController(service).sync();
    assert.deepEqual(triggers, ["SCHEDULED", "MANUAL"]);
  });
});
