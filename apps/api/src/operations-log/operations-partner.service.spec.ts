import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import type { AuthenticatedUser } from "@acropora/types";

import { OperationsPartnerService } from "./operations-partner.service.js";
import type { OperationsReportRepository } from "./operations-report.repository.js";
import type { OperationsReportService } from "./operations-report.service.js";

/*
  A PARTNER-NÉZET (task os-uzemeltetesi-naplo, S5). MI PIROSIT: ha a belső (partner-hatókör nélküli) felhasználó ezen az úton
  olvashatna; ha a hozzárendelés nélküli partner-fiók látna helyszínt; ha a hozzá nem rendelt vagy idegen helyszín 404 helyett
  kimutatást adna (vagy másfajta választ, mint a nem létező: a válasz nem árulhatja el, hogy létezik); ha a kimutatás nem PARTNER
  nézővel készülne (a nevek kiszivárognának); ha a partner a saját ügyfelén kívüli egységeket kapná.
*/
function user(over: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    id: "u1",
    email: "p@partner.hu",
    displayName: "Partner Péter",
    role: "PARTNER_SERVICE",
    customerId: "c1",
    supplierId: null,
    ...over,
  } as AuthenticatedUser;
}

function fixture(
  over: {
    unitIds?: string[];
    sites?: { id: string; parentId: string | null; name: string }[];
  } = {},
) {
  const calls: {
    partnerSites?: [string, readonly string[]];
    build?: { query: unknown; audience: string };
  } = {};
  const repository = {
    assignedUnitIds: async () => over.unitIds ?? ["d1", "d2"],
    partnerSites: async (customerId: string, unitIds: readonly string[]) => {
      calls.partnerSites = [customerId, unitIds];
      return (
        over.sites ?? [
          { id: "d1", parentId: null, name: "Biodóm" },
          { id: "d2", parentId: "d1", name: "Nagy medence" },
        ]
      );
    },
  } as unknown as OperationsReportRepository;
  const reports = {
    build: async (query: unknown, audience: string) => {
      calls.build = { query, audience };
      return {
        report: { audience },
        siteLabel: "Partner · Biodóm",
        generatedAt: "x",
      };
    },
  } as unknown as OperationsReportService;
  return { service: new OperationsPartnerService(repository, reports), calls };
}

describe("az üzemeltetési napló partner-nézete", () => {
  it("a partner a hozzárendelt helyszíneit kapja, a saját ügyfelére szűrve", async () => {
    const { service, calls } = fixture();
    const result = await service.sites(user());
    assert.deepEqual(
      result.items.map((site) => site.id),
      ["d1", "d2"],
    );
    assert.deepEqual(calls.partnerSites, ["c1", ["d1", "d2"]]);
  });

  it("hozzárendelés nélkül a lista üres, és a kimutatás 404", async () => {
    const empty = fixture({ unitIds: [], sites: [] });
    assert.deepEqual(await empty.service.sites(user()), { items: [] });
    await assert.rejects(
      () =>
        empty.service.report(user(), { month: "2026-11", departmentId: "d1" }),
      NotFoundException,
    );
  });

  it("belső felhasználó és szállító-hatókör nem olvashat: 403", async () => {
    const { service } = fixture();
    for (const over of [
      { customerId: null, supplierId: null },
      { customerId: null, supplierId: "s1" },
    ])
      await assert.rejects(() => service.sites(user(over)), ForbiddenException);
    await assert.rejects(
      () =>
        service.report(user({ customerId: null }), {
          month: "2026-11",
          departmentId: "d1",
        }),
      ForbiddenException,
    );
  });

  it("a látható helyszínre PARTNER nézővel készül; a hozzá nem rendelt, az idegen és a hiányzó helyszín ugyanaz a 404", async () => {
    const { service, calls } = fixture();
    const ok = await service.report(user(), {
      month: "2026-11",
      departmentId: "d2",
    });
    assert.equal(calls.build?.audience, "PARTNER");
    assert.deepEqual(calls.build?.query, {
      month: "2026-11",
      departmentId: "d2",
    });
    assert.equal(ok.siteLabel, "Partner · Biodóm");
    const messages = new Set<string>();
    for (const departmentId of ["d9", "idegen", "", undefined])
      await assert.rejects(
        () => service.report(user(), { month: "2026-11", departmentId }),
        (error: Error) => {
          messages.add(error.message);
          return error instanceof NotFoundException;
        },
      );
    assert.equal(messages.size, 1);
  });
});
