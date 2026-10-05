import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AuthenticatedUser } from "@acropora/types";

import { ServiceJobsRepository } from "./service-jobs.repository.js";
import { ServiceJobsService } from "./service-jobs.service.js";

/**
 * A "DELEGÁLVA" OSZLOP ÉS A HELYSZÍN-KÓD A LISTÁN -- Szerviz / Hibajegyek
 * Figma-kör (murena, 2026-09-24). A `list()` válasz mostantól a jegy
 * delegáltjait és a helyszín saját kódját is hordozza, ugyanúgy, mint a
 * részletlap -- ez az az állítás, ami ezt méri a repository-fal való
 * összekapcsolás nélkül (azt a batch-kötegelést integrációs szinten kell
 * mérni, ez itt a SZOLGÁLTATÁS-réteg leképezését fedi).
 */
describe("a hibajegy-lista delegáltak és helyszín-kód mezői", () => {
  it("a departmentCode változatlanul átmegy, az assignees a becenevet használja", async () => {
    const repository: Pick<ServiceJobsRepository, "list" | "countsByStatus"> = {
      list: async () => ({
        rows: [
          {
            id: "job-1",
            jobNumber: "HJ-2026-001",
            title: "Szivattyú zúg",
            kind: "REPAIR",
            status: "NEW",
            customerName: "Cápárium",
            departmentPath: ["Cápárium", "Nagy cápás medence"],
            departmentCode: "CAP-SHK",
            assignees: [
              {
                userId: "user-1",
                assignedAt: new Date("2026-09-24T10:00:00.000Z"),
                // A BECENÉV VAN, TEHÁT AZ MEGY -- ugyanaz a szabály, mint a
                // részletlapon (`personDisplayName`).
                user: { displayName: "Tóth Gábor", nickname: "Gabi" },
              },
              {
                userId: "user-2",
                assignedAt: new Date("2026-09-24T11:00:00.000Z"),
                // BECENÉV NÉLKÜL A TELJES NÉV MEGY -- a másik ág, ugyanabban
                // a listában, hogy a kettő ne keveredjen össze egy közös
                // adaton.
                user: { displayName: "Nagy Diána", nickname: null },
              },
            ],
            createdAt: new Date("2026-09-24T09:00:00.000Z"),
            worksheetCount: 0,
            hiddenAt: null,
          },
        ],
        truncated: false,
      }),
      countsByStatus: async () => ({
        NEW: 1,
        TRIAGED: 0,
        SCHEDULED: 0,
        IN_PROGRESS: 0,
        WAITING_FOR_PARTS: 0,
        WAITING_FOR_CUSTOMER: 0,
        COMPLETED: 0,
        CANCELLED: 0,
      }),
    };
    const service = new ServiceJobsService(repository as ServiceJobsRepository);
    const user = { id: "office-user", role: "ADMIN" } as AuthenticatedUser;

    const response = await service.list({}, user);

    assert.equal(response.items.length, 1);
    const item = response.items[0]!;
    assert.equal(item.departmentCode, "CAP-SHK");
    assert.deepEqual(
      item.assignees!.map((assignee) => assignee.name),
      ["Gabi", "Nagy Diána"],
    );
    assert.deepEqual(
      item.assignees!.map((assignee) => assignee.userId),
      ["user-1", "user-2"],
    );
    assert.equal(item.assignees![0]?.assignedAt, "2026-09-24T10:00:00.000Z");
  });

  /*
    NEGATÍV KONTROLL: HELYSZÍN NÉLKÜLI JEGYNÉL MINDKÉT MEZŐ `null`/ÜRES --
    enélkül az előző állítás azt is fedhetné, hogy a mezők MINDIG kitöltve
    jönnek, függetlenül attól, mit ad a repository.
  */
  it("helyszín és delegált nélkül departmentCode null, assignees üres tömb", async () => {
    const repository: Pick<ServiceJobsRepository, "list" | "countsByStatus"> = {
      list: async () => ({
        rows: [
          {
            id: "job-2",
            jobNumber: "HJ-2026-002",
            title: "Nincs helyszín",
            kind: "REPAIR",
            status: "NEW",
            customerName: null,
            departmentPath: null,
            departmentCode: null,
            assignees: [],
            createdAt: new Date("2026-09-24T09:00:00.000Z"),
            worksheetCount: 0,
            hiddenAt: null,
          },
        ],
        truncated: false,
      }),
      countsByStatus: async () => ({
        NEW: 1,
        TRIAGED: 0,
        SCHEDULED: 0,
        IN_PROGRESS: 0,
        WAITING_FOR_PARTS: 0,
        WAITING_FOR_CUSTOMER: 0,
        COMPLETED: 0,
        CANCELLED: 0,
      }),
    };
    const service = new ServiceJobsService(repository as ServiceJobsRepository);
    const user = { id: "office-user", role: "ADMIN" } as AuthenticatedUser;

    const response = await service.list({}, user);

    assert.equal(response.items[0]?.departmentCode, null);
    assert.deepEqual(response.items[0]?.assignees, []);
  });
});

/*
  A PARTNER NEM KAPJA MEG A BELSO FELELOSOKET (kartya a0660885, 2026-10-05).
  A 10-04-i szerviz-felmeres: a lista partnernek is kiadta a delegaltak nevet,
  mig a reszletlap partner alakja nem. MI PIROSIT: ha a partner (vevo VAGY
  szallito) valaszaban az `assignees` kulcs barmilyen alakban ott all, akar
  ures tombkent is; vagy ha a vetites a belso valaszbol is kivenne, vagy a
  partner tobbi mezojet is elvinne.
*/
describe("a hibajegy-lista partner alakja", () => {
  const sor = {
    id: "job-3",
    jobNumber: "HJ-2026-003",
    title: "Szivattyú zúg",
    kind: "REPAIR" as const,
    status: "IN_PROGRESS" as const,
    customerName: "Cápárium",
    departmentPath: ["Cápárium", "Nagy cápás medence"],
    departmentCode: "CAP-SHK",
    assignees: [
      {
        userId: "user-1",
        assignedAt: new Date("2026-10-04T10:00:00.000Z"),
        user: { displayName: "Tóth Gábor", nickname: "Gabi" },
      },
    ],
    createdAt: new Date("2026-10-04T09:00:00.000Z"),
    worksheetCount: 1,
    hiddenAt: null,
  };
  const counts = {
    NEW: 0,
    TRIAGED: 0,
    SCHEDULED: 0,
    IN_PROGRESS: 1,
    WAITING_FOR_PARTS: 0,
    WAITING_FOR_CUSTOMER: 0,
    COMPLETED: 0,
    CANCELLED: 0,
  };
  const service = () =>
    new ServiceJobsService({
      list: async () => ({ rows: [sor], truncated: false }),
      countsByStatus: async () => counts,
      // a partner lathatosaga a kiosztott egysegeken all; itt nincs egyseg
      assignedUnitIds: async () => [],
    } as unknown as ServiceJobsRepository);

  for (const [nev, user] of [
    ["vevő-partner", { id: "p-1", role: "PARTNER_SERVICE", customerId: "c-1" }],
    [
      "szállító-partner",
      { id: "p-2", role: "PARTNER_SERVICE", supplierId: "s-1" },
    ],
  ] as const)
    it(`${nev}: a sorban nincs assignees kulcs, a többi mező megvan`, async () => {
      const response = await service().list(
        {},
        user as unknown as AuthenticatedUser,
      );
      const item = response.items[0]!;
      assert.equal("assignees" in item, false);
      assert.doesNotMatch(JSON.stringify(response), /Gabi|Tóth|user-1/);
      assert.equal(item.jobNumber, "HJ-2026-003");
      assert.equal(item.departmentCode, "CAP-SHK");
      assert.equal(item.partnerStatusLabel.length > 0, true);
    });

  it("a belső felhasználó változatlanul megkapja", async () => {
    const response = await service().list({}, {
      id: "office-user",
      role: "ADMIN",
    } as AuthenticatedUser);
    assert.deepEqual(
      response.items[0]!.assignees!.map((a) => a.name),
      ["Gabi"],
    );
  });
});
