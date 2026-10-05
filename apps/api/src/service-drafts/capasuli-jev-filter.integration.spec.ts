import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { after, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { ServiceJobsRepository } from "../service-jobs/service-jobs.repository.js";
import { extractCapasuliReports } from "./capasuli-extractor.js";
import { capasuliConfig } from "./capasuli-gmail.config.js";
import {
  ServiceDraftsRepository,
  draftFilterKey,
  type DraftFilter,
} from "./service-drafts.repository.js";

/**
 * A JEV-SZŰRÉS AZ ADATBÁZISBAN (Cápasuli, Balázs 2026-10-05; brief 3-4.
 * pont). MI PIROSÍT: ha a kiszűrt tétel a függő listában is áll, vagy a
 * "Kiszűrve" szakaszból hiányzik; ha törlődik; ha a "Mégis piszkozat" nem
 * írja vissza a döntést a futásra; ha nem kiszűrt tételt is visszahozna.
 */
const gate = integrationDatabaseGate(process.env);
if (gate.mode === "refuse") throw new Error(gate.reason);
const repository = new ServiceDraftsRepository(new ServiceJobsRepository());
const fixture = readFileSync(
  new URL(
    "../../src/service-drafts/fixtures/capasuli-2026-10-03.txt",
    import.meta.url,
  ),
  "utf8",
);

describe(
  "Cápasuli Jev filter in the database",
  {
    skip: gate.mode === "skip",
  },
  () => {
    const suffix = randomUUID();
    const mailbox = `jev-filter-${suffix}@example.test`;
    const runIds: string[] = [];
    const config = () => capasuliConfig({ GMAIL_CAPASULI_USER: mailbox });

    async function run(entityId: string, choice: string) {
      const created = await prisma.decisionRun.create({
        data: {
          policyKey: "service-drafts.capasuli-item",
          policyVersion: 1,
          projectionHash: `test-${randomUUID()}`,
          optionsHash: "test",
          requestedModel: "jev-1.13.0",
          exposure: "HIDDEN",
          status: "OK",
          selectedValue: choice,
          confidence: 0.92,
          entityType: "ServiceTicketDraft",
          entityId,
        },
      });
      runIds.push(created.id);
      return created.id;
    }

    it("stores the filter state, keeps the filtered item, and lists it apart", async () => {
      const [report] = extractCapasuliReports(fixture);
      const reportDate = report!.reportDate.toISOString().slice(0, 10);
      const [kept, dropped] = report!.problems;
      const filters = new Map<string, DraftFilter>([
        [
          draftFilterKey(reportDate, kept!.fingerprint),
          {
            filterState: "PASSED",
            jevClass: "OUR_TECHNICAL_FAULT",
            jevConfidence: 0.92,
            decisionRunId: await run(`kept-${suffix}`, "OUR_TECHNICAL_FAULT"),
          },
        ],
        [
          draftFilterKey(reportDate, dropped!.fingerprint),
          {
            filterState: "FILTERED",
            jevClass: "NOT_OURS",
            jevConfidence: 0.92,
            decisionRunId: await run(`dropped-${suffix}`, "NOT_OURS"),
          },
        ],
      ]);
      const result = await repository.ingest(
        {
          id: `jev-${suffix}`,
          subject: "Napi jelentő",
          receivedAt: new Date(),
          text: fixture,
          attachments: [],
        },
        config(),
        filters,
      );
      assert.equal(result.added, 2);

      const pending = (await repository.list("PENDING")).items.filter(
        (item) => item.mailbox === mailbox,
      );
      assert.deepEqual(
        pending.map((item) => item.filterState),
        ["PASSED"],
      );
      const filtered = (await repository.filtered()).filter(
        (item) => item.title === dropped!.title,
      );
      assert.equal(filtered.length, 1);
      assert.equal(filtered[0]!.jevClass, "NOT_OURS");
      assert.equal(
        await prisma.serviceTicketDraft.count({ where: { mailbox } }),
        2,
      );
    });

    it("'Mégis piszkozat' brings it back and writes the correction to the run", async () => {
      const draft = await prisma.serviceTicketDraft.findFirstOrThrow({
        where: { mailbox, filterState: "FILTERED" },
      });
      await repository.promote(draft.id);
      const after = await prisma.serviceTicketDraft.findUniqueOrThrow({
        where: { id: draft.id },
      });
      assert.equal(after.filterState, "PROMOTED");
      const decision = await prisma.decisionRun.findUniqueOrThrow({
        where: { id: draft.decisionRunId! },
      });
      assert.equal(decision.resolution, "OVERRIDDEN");
      assert.equal(decision.resolvedValue, "OUR_TECHNICAL_FAULT");
      assert.equal(decision.exposure, "SHOWN");

      // ugyanazt még egyszer, és egy nem kiszűrt tételt: egyik sem hozható vissza
      await assert.rejects(() => repository.promote(draft.id));
      const passed = await prisma.serviceTicketDraft.findFirstOrThrow({
        where: { mailbox, filterState: "PASSED" },
      });
      await assert.rejects(() => repository.promote(passed.id));
    });

    after(async () => {
      await prisma.serviceTicketDraft.deleteMany({ where: { mailbox } });
      await prisma.serviceDraftMail.deleteMany({ where: { mailbox } });
      await prisma.decisionRun.deleteMany({ where: { id: { in: runIds } } });
      await prisma.$disconnect();
    });
  },
);
