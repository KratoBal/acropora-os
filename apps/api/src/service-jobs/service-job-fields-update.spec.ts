import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BadRequestException } from "@nestjs/common";
import type { AuthenticatedUser } from "@acropora/types";

import { ServiceJobsService } from "./service-jobs.service.js";
import type { ServiceJobsRepository } from "./service-jobs.repository.js";

/**
 * A CIM TRIM UTANI URESSEGE -- AMIT A DTO NEM TUD MEGFOGNI.
 *
 * A `@MinLength(1)` a NYERS erteket nezi, tehat a csupa szokoz ATMEGY rajta. A
 * `title` viszont a semaban `String`, nem `String?`: egy szokozokre irt cim
 * URES cimet tarolna, es a jegy a listaban nevtelenul allna.
 *
 * A VARRAT VALODI TIPUSAT KAPJA a dupla (`Pick<ServiceJobsRepository, ...>`):
 * ha barmelyik tarolo-metodus szignaturaja elmozdul, a fordito szoljon, ne a
 * felhasznalo.
 */

type Iras = Parameters<ServiceJobsRepository["updateFields"]>[0];

function keszit(options?: { hasWorksheet?: boolean }) {
  const irasok: Iras[] = [];
  const repository: Pick<
    ServiceJobsRepository,
    | "detail"
    | "documentRemovals"
    | "assignedUnitIds"
    | "assignmentContext"
    | "hasWorksheet"
    | "updateFields"
  > = {
    detail: async () =>
      ({
        id: "job-1",
        status: "IN_PROGRESS",
        title: "Eredeti cím",
        description: null,
        hiddenAt: null,
        customerId: null,
        departmentId: null,
        departmentPath: null,
        customer: null,
        /*
          A DATUM-MEZOK NEM DISZ: az `internalDetail` `toISOString()`-ot hiv
          rajtuk. A dupla elso valtozatabol hianyoztak, es a teszt NEM a
          szandekolt allitason bukott, hanem egy TypeError-on -- pontosan az a
          hibafajta, amirol a teszt-duplakrol szolo lapunk beszel: a HIVO tobbet
          hasznal, mint amit a teszt megnez.
        */
        createdAt: new Date("2026-09-22T10:00:00.000Z"),
        scheduledAt: null,
        startedAt: null,
        completedAt: null,
        events: [],
        worksheets: [],
        assets: [],
        assignees: [],
        documents: [],
      }) as never,
    documentRemovals: async () => [],
    assignedUnitIds: async () => [],
    assignmentContext: async () => ({}) as never,
    hasWorksheet: async () => options?.hasWorksheet ?? false,
    updateFields: async (input) => {
      irasok.push(input);
      return true;
    },
  };
  return {
    service: new ServiceJobsService(repository as ServiceJobsRepository),
    irasok,
  };
}

const BELSOS: AuthenticatedUser = {
  id: "user-1",
  email: "belsos@acropora.local",
  displayName: "Belsős",
  role: "OWNER",
  customerId: null,
  supplierId: null,
} as never;

describe("a hibajegy mezőinek szerkesztése", () => {
  it("T1: a csupa szóközből álló cím ELUTASÍTÁS, és nem ír semmit", async () => {
    const { service, irasok } = keszit();

    await assert.rejects(
      () => service.updateFields("job-1", { title: "   " }, BELSOS),
      BadRequestException,
    );
    assert.deepEqual(
      irasok,
      [],
      "az őrzőt nem az bizonyítja, hogy szól, hanem hogy NEM TÖRTÉNT SEMMI",
    );
  });

  it("T2: KONTROLL -- a körülvágott cím átmegy", async () => {
    const { service, irasok } = keszit();

    await service.updateFields("job-1", { title: "  Javított cím  " }, BELSOS);

    assert.equal(irasok.length, 1);
    assert.deepEqual(irasok[0]?.fields, { title: "Javított cím" });
  });

  /**
   * T3: A HIANYZO MEZOHOZ NEM NYULUNK. Enelkul a fenti ketto zold lenne egy
   * olyan megvalositason is, ami MINDIG mind a ket mezot irja -- es akkor egy
   * cim-javitas csendben kiuritene a leirast.
   */
  it("T3: a meg nem küldött mező nem kerül az írásba", async () => {
    const { service, irasok } = keszit();

    await service.updateFields("job-1", { description: "Új leírás" }, BELSOS);

    assert.deepEqual(irasok[0]?.fields, { description: "Új leírás" });
  });

  /**
   * T4: A NAPLOSOR MEGNEVEZI, MI VALTOZOTT. Egy allando "modosult" mondat
   * ugyanazt mondana egy cim-javitasra es egy leiras-uritesre.
   */
  it("T4: a naplósor szövege megnevezi a módosult mezőket", async () => {
    const { service, irasok } = keszit();

    await service.updateFields(
      "job-1",
      { title: "Cím", description: "Leírás" },
      BELSOS,
    );

    assert.equal(irasok[0]?.note, "A hibajegy címe és leírása módosult.");
  });

  it("T5: üres törzsre nem ír és nem naplóz", async () => {
    const { service, irasok } = keszit();

    await service.updateFields("job-1", {}, BELSOS);

    assert.deepEqual(irasok, []);
  });
});
