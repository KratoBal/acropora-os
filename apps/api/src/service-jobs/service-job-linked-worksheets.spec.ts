import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { REQUIRED_PERMISSIONS_KEY } from "../auth/decorators/require-permissions.decorator.js";
import {
  LINK_WORKSHEET_REFUSAL_MESSAGE,
  linkEventNote,
  linkWorksheetRefusal,
  linkableWorksheetWhere,
  linkedWorksheetReadWhere,
} from "./service-job-linked-worksheets.rules.js";
import { ServiceJobLinkedWorksheetsController } from "./service-job-linked-worksheets.controller.js";
import type { ServiceJobLinkedWorksheetsRepository } from "./service-job-linked-worksheets.repository.js";
import { ServiceJobLinkedWorksheetsService } from "./service-job-linked-worksheets.service.js";
import { ServiceJobsModule } from "./service-jobs.module.js";

/*
  WHAT TURNS THIS RED (card 5b366f5d): the rules losing one of the six refusals (a worksheet of another customer, one that lives
  under this very sheet, one linked here or to another sheet, a repair ticket as target, a sheet without a partner); the picker
  filter offering hidden worksheets, worksheets already linked anywhere, or the sheet's own; a partner being able to write or to
  see who linked; the unit rule (`worksheetUnitWhere`) not reaching the list query, or a partner's list showing a worksheet hidden
  since it was linked (card efe02c6f: the PDF and the zip leave it out); a link or unlink without its log entry;
  the unlink refusing after the worksheet changed customer; the module forgetting to register the controller or its providers.
*/

const BASE = {
  jobId: "job-1",
  jobKind: "MAINTENANCE" as const,
  jobCustomerId: "customer-1",
  worksheetCustomerId: "customer-1",
  worksheetServiceJobId: null as string | null,
  existingLinkJobId: null as string | null,
};

describe("a munkalap hozzákapcsolásának szabályai", () => {
  it("egy ugyanazon partner szabad munkalapja kapcsolható", () => {
    assert.equal(linkWorksheetRefusal(BASE), null);
  });

  it("a hibajegy nem fogad hivatkozást", () => {
    assert.equal(
      linkWorksheetRefusal({ ...BASE, jobKind: "REPAIR" }),
      "job-not-maintenance",
    );
  });

  it("partner nélküli lapra nem megy", () => {
    assert.equal(
      linkWorksheetRefusal({ ...BASE, jobCustomerId: null }),
      "job-has-no-partner",
    );
  });

  it("másik partner munkalapja nem megy", () => {
    assert.equal(
      linkWorksheetRefusal({ ...BASE, worksheetCustomerId: "customer-2" }),
      "other-customer",
    );
  });

  it("a lap saját munkalapját nem kell hivatkozni", () => {
    assert.equal(
      linkWorksheetRefusal({ ...BASE, worksheetServiceJobId: "job-1" }),
      "own-worksheet",
    );
  });

  it("egy másik jegy vagy lap alatt álló munkalap kapcsolható (hivatkozás, nem áthelyezés)", () => {
    assert.equal(
      linkWorksheetRefusal({ ...BASE, worksheetServiceJobId: "ticket-9" }),
      null,
    );
  });

  it("amit már ide kapcsoltak, azt nem lehet másodszor", () => {
    assert.equal(
      linkWorksheetRefusal({ ...BASE, existingLinkJobId: "job-1" }),
      "already-linked-here",
    );
  });

  it("amit másik karbantartási laphoz kapcsoltak, azt nem lehet ide is: egy munkalap egy lapon számít", () => {
    assert.equal(
      linkWorksheetRefusal({ ...BASE, existingLinkJobId: "job-2" }),
      "linked-elsewhere",
    );
  });

  it("mind a hat elutasításnak van saját, különböző mondata", () => {
    const messages = Object.values(LINK_WORKSHEET_REFUSAL_MESSAGE);
    assert.equal(messages.length, 6);
    assert.equal(new Set(messages).size, 6);
  });
});

describe("a hozzákapcsolt lista olvasói szűrője (kártya efe02c6f)", () => {
  it("belső felhasználónak minden kapcsolt munkalap, rejtett is", () => {
    assert.deepEqual(linkedWorksheetReadWhere({ kind: "internal" }, []), {});
  });

  it("partnernek a saját egységei, és rejtett munkalap soha", () => {
    assert.deepEqual(
      linkedWorksheetReadWhere({ kind: "customer", customerId: "customer-1" }, [
        "unit-1",
      ]),
      { AND: [{ departmentId: { in: ["unit-1"] } }, { hiddenAt: null }] },
    );
  });
});

describe("a választó szűrője", () => {
  const where = linkableWorksheetWhere({
    jobId: "job-1",
    customerId: "customer-1",
  });

  it("csak a partner saját, nem rejtett, sehova nem kapcsolt munkalapját kínálja", () => {
    assert.equal(where.customerId, "customer-1");
    assert.equal(where.hiddenAt, null);
    assert.equal(where.linkedToJob, null);
  });

  it("a lap saját munkalapját kihagyja, a jegy nélkülit és a más jegy alattit megtartja", () => {
    assert.deepEqual(where.OR, [
      { serviceJobId: null },
      { serviceJobId: { not: "job-1" } },
    ]);
  });
});

describe("a naplósor szövege", () => {
  it("a számot és a tárgyat is kimondja", () => {
    assert.equal(
      linkEventNote({ number: "KAR-2026-022", subject: "lámpák átszerelése" }),
      "KAR-2026-022: lámpák átszerelése",
    );
  });

  it("számozatlan lapnál a számozatlan szót írja, tárgy nélkül csak a számot", () => {
    assert.equal(
      linkEventNote({ number: null, subject: "próba" }),
      "számozatlan munkalap: próba",
    );
    assert.equal(linkEventNote({ number: "KAR-1", subject: "" }), "KAR-1");
  });
});

const INTERNAL = {
  id: "internal-user",
  email: "internal@acropora.hu",
  displayName: "Belső Ember",
  role: "SERVICE",
  customerId: null,
  supplierId: null,
} as AuthenticatedUser;

const PARTNER = {
  id: "partner-user",
  email: "partner@example.test",
  displayName: "Partner",
  role: "PARTNER_SERVICE",
  customerId: "customer-1",
  supplierId: null,
} as AuthenticatedUser;

interface Calls {
  jobState: unknown[][];
  listLinked: unknown[][];
  history: unknown[][];
  linkable: unknown[][];
  link: unknown[][];
  unlink: unknown[][];
}

function fake(
  over: Partial<
    Record<keyof ServiceJobLinkedWorksheetsRepository, unknown>
  > = {},
) {
  const calls: Calls = {
    jobState: [],
    listLinked: [],
    history: [],
    linkable: [],
    link: [],
    unlink: [],
  };
  const repository = {
    assignedUnitIds: async () => ["unit-1"],
    jobState: async (...args: unknown[]) => {
      calls.jobState.push(args);
      return {
        id: "job-1",
        kind: "MAINTENANCE",
        customerId: "customer-1",
        departmentId: "unit-9",
        jobNumber: "KAR-2026-001",
      };
    },
    worksheetState: async () => ({
      id: "ws-1",
      number: "KAR-2026-022",
      customerId: "customer-1",
      serviceJobId: null,
      hidden: false,
      linkedToJobId: null,
      subject: "lámpák átszerelése",
    }),
    listLinked: async (...args: unknown[]) => {
      calls.listLinked.push(args);
      return [
        {
          worksheetId: "ws-1",
          number: "KAR-2026-022",
          subject: "lámpák átszerelése",
          createdAt: new Date("2026-11-10T10:00:00Z"),
          handedOverAt: null,
          status: "SIGNED",
          departmentPath: ["Állatkert", "Középső medence"],
          homeJobNumber: null,
          linkedAt: new Date("2026-11-11T10:00:00Z"),
          linkedByName: "Belső Ember",
        },
      ];
    },
    history: async (...args: unknown[]) => {
      calls.history.push(args);
      return [
        {
          id: "ev-1",
          kind: "WORKSHEET_LINKED",
          worksheetId: "ws-1",
          note: "KAR-2026-022: lámpák átszerelése",
          createdAt: new Date("2026-11-11T10:00:00Z"),
          actor: { displayName: "Belső Ember" },
        },
      ];
    },
    linkable: async (...args: unknown[]) => {
      calls.linkable.push(args);
      return { rows: [], truncated: false };
    },
    link: async (...args: unknown[]) => {
      calls.link.push(args);
      return { ok: true };
    },
    unlink: async (...args: unknown[]) => {
      calls.unlink.push(args);
      return { ok: true };
    },
    ...over,
  } as unknown as ServiceJobLinkedWorksheetsRepository;
  return { service: new ServiceJobLinkedWorksheetsService(repository), calls };
}

describe("a kapcsolódó munkalapok listája", () => {
  it("a belsős látja a naplót és azt, ki kapcsolta", async () => {
    const { service } = fake();
    const result = await service.list("job-1", INTERNAL);
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0]?.linkedByName, "Belső Ember");
    assert.equal(result.history.length, 1);
    assert.equal(result.history[0]?.kind, "LINKED");
  });

  it("a partner a listát látja, de a naplót és a kapcsoló nevét nem", async () => {
    const { service, calls } = fake();
    const result = await service.list("job-1", PARTNER);
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0]?.linkedByName, null);
    assert.deepEqual(result.history, []);
    assert.equal(calls.history.length, 0);
  });

  it("a partner listájára ugyanaz az egység-szabály megy, mint a munkalap-listára, és rejtett munkalap nélkül (kártya efe02c6f)", async () => {
    const { service, calls } = fake();
    await service.list("job-1", PARTNER);
    assert.deepEqual(calls.listLinked[0]?.[2], {
      AND: [{ departmentId: { in: ["unit-1"] } }, { hiddenAt: null }],
    });
  });

  it("a belsősre nem szűkít az egység-szabály", async () => {
    const { service, calls } = fake();
    await service.list("job-1", INTERNAL);
    assert.deepEqual(calls.listLinked[0]?.[2], {});
  });

  it("a nem látható lap úgy néz ki, mint a nem létező: 404", async () => {
    const { service } = fake({ jobState: async () => null });
    await assert.rejects(service.list("job-1", PARTNER), NotFoundException);
  });
});

describe("a munkalap hozzákapcsolása", () => {
  it("a partner nem írhat, és semmi nem íródik: 404", async () => {
    const { service, calls } = fake();
    await assert.rejects(
      service.link("job-1", "ws-1", PARTNER),
      NotFoundException,
    );
    assert.equal(calls.link.length, 0);
    assert.equal(calls.jobState.length, 0);
  });

  it("a sikeres kapcsolás a naplósorral együtt megy, a szám és a tárgy a jegyzetben", async () => {
    const { service, calls } = fake();
    assert.deepEqual(await service.link("job-1", "ws-1", INTERNAL), {
      ok: true,
    });
    assert.deepEqual(calls.link[0]?.[0], {
      jobId: "job-1",
      worksheetId: "ws-1",
      actorUserId: "internal-user",
      note: "KAR-2026-022: lámpák átszerelése",
    });
  });

  it("másik partner munkalapja 400, és nem ír", async () => {
    const { service, calls } = fake({
      worksheetState: async () => ({
        id: "ws-1",
        number: "X",
        customerId: "customer-2",
        serviceJobId: null,
        hidden: false,
        linkedToJobId: null,
        subject: "",
      }),
    });
    await assert.rejects(
      service.link("job-1", "ws-1", INTERNAL),
      BadRequestException,
    );
    assert.equal(calls.link.length, 0);
  });

  it("a másik laphoz már kapcsolt munkalap 409, és nem ír", async () => {
    const { service, calls } = fake({
      worksheetState: async () => ({
        id: "ws-1",
        number: "X",
        customerId: "customer-1",
        serviceJobId: null,
        hidden: false,
        linkedToJobId: "job-2",
        subject: "",
      }),
    });
    await assert.rejects(
      service.link("job-1", "ws-1", INTERNAL),
      ConflictException,
    );
    assert.equal(calls.link.length, 0);
  });

  it("a rejtett munkalap nem létezőnek látszik: 404", async () => {
    const { service } = fake({
      worksheetState: async () => ({
        id: "ws-1",
        number: "X",
        customerId: "customer-1",
        serviceJobId: null,
        hidden: true,
        linkedToJobId: null,
        subject: "",
      }),
    });
    await assert.rejects(
      service.link("job-1", "ws-1", INTERNAL),
      NotFoundException,
    );
  });

  it("a hibajegyre nem megy: 400", async () => {
    const { service } = fake({
      jobState: async () => ({
        id: "job-1",
        kind: "REPAIR",
        customerId: "customer-1",
        departmentId: "unit-9",
        jobNumber: "SRV-1",
      }),
    });
    await assert.rejects(
      service.link("job-1", "ws-1", INTERNAL),
      BadRequestException,
    );
  });

  it("két egyszerre kapcsoló közül a vesztes 409-et kap, nem csendes felülírást", async () => {
    const { service } = fake({
      link: async () => ({ ok: false, reason: "duplicate" }),
    });
    await assert.rejects(
      service.link("job-1", "ws-1", INTERNAL),
      ConflictException,
    );
  });
});

describe("a kapcsolat levétele", () => {
  it("a partner nem vehet le: 404, és semmi nem íródik", async () => {
    const { service, calls } = fake();
    await assert.rejects(
      service.unlink("job-1", "ws-1", PARTNER),
      NotFoundException,
    );
    assert.equal(calls.unlink.length, 0);
  });

  it("a levétel a naplósorral együtt megy", async () => {
    const { service, calls } = fake({
      worksheetState: async () => ({
        id: "ws-1",
        number: "KAR-2026-022",
        customerId: "customer-1",
        serviceJobId: null,
        hidden: false,
        linkedToJobId: "job-1",
        subject: "lámpák átszerelése",
      }),
    });
    assert.deepEqual(await service.unlink("job-1", "ws-1", INTERNAL), {
      ok: true,
    });
    assert.deepEqual(calls.unlink[0]?.[0], {
      jobId: "job-1",
      worksheetId: "ws-1",
      actorUserId: "internal-user",
      note: "KAR-2026-022: lámpák átszerelése",
    });
  });

  it("amit nem ide kapcsoltak, azt nem lehet innen levenni: 409", async () => {
    const { service, calls } = fake();
    await assert.rejects(
      service.unlink("job-1", "ws-1", INTERNAL),
      ConflictException,
    );
    assert.equal(calls.unlink.length, 0);
  });

  it("a levétel nem néz partnert és rejtettséget: a már meglévő kapcsolat mindig levehető", async () => {
    const { service } = fake({
      worksheetState: async () => ({
        id: "ws-1",
        number: "X",
        customerId: "customer-2",
        serviceJobId: null,
        hidden: true,
        linkedToJobId: "job-1",
        subject: "",
      }),
    });
    assert.deepEqual(await service.unlink("job-1", "ws-1", INTERNAL), {
      ok: true,
    });
  });

  it("ha közben más már levette, 409", async () => {
    const { service } = fake({
      worksheetState: async () => ({
        id: "ws-1",
        number: "X",
        customerId: "customer-1",
        serviceJobId: null,
        hidden: false,
        linkedToJobId: "job-1",
        subject: "",
      }),
      unlink: async () => ({ ok: false, reason: "gone" }),
    });
    await assert.rejects(
      service.unlink("job-1", "ws-1", INTERNAL),
      ConflictException,
    );
  });
});

describe("a választó lekérdezése", () => {
  it("a partner nem kap választót: 404", async () => {
    const { service, calls } = fake();
    await assert.rejects(
      service.linkable("job-1", {}, PARTNER),
      NotFoundException,
    );
    assert.equal(calls.linkable.length, 0);
  });

  it("a hibajegyre nincs választó: 400, nem üres lista", async () => {
    const { service } = fake({
      jobState: async () => ({
        id: "job-1",
        kind: "REPAIR",
        customerId: "customer-1",
        departmentId: "unit-9",
        jobNumber: "SRV-1",
      }),
    });
    await assert.rejects(
      service.linkable("job-1", {}, INTERNAL),
      BadRequestException,
    );
  });

  it("a lap partnerét és helyszínét adja át, a keresőszöveg szám és tárgy szerint szűr", async () => {
    const { service, calls } = fake();
    await service.linkable("job-1", { q: " lámpa " }, INTERNAL);
    const input = calls.linkable[0]?.[0] as {
      jobId: string;
      customerId: string;
      departmentId: string;
      search: { AND: unknown[] };
    };
    assert.equal(input.customerId, "customer-1");
    assert.equal(input.departmentId, "unit-9");
    assert.deepEqual(input.search.AND[1], {
      OR: [
        { number: { contains: "lámpa", mode: "insensitive" } },
        {
          versions: {
            some: { subject: { contains: "lámpa", mode: "insensitive" } },
          },
        },
      ],
    });
  });

  it("a hibás dátum 400, nem csendes kihagyás", async () => {
    const { service } = fake();
    await assert.rejects(
      service.linkable("job-1", { createdFrom: "2026-02-30" }, INTERNAL),
      BadRequestException,
    );
  });
});

describe("a bekötés", () => {
  it("a modul regisztrálja a controllert és a két szolgáltatás-darabot", () => {
    const controllers = Reflect.getMetadata(
      "controllers",
      ServiceJobsModule,
    ) as unknown[];
    const providers = Reflect.getMetadata(
      "providers",
      ServiceJobsModule,
    ) as unknown[];
    assert.ok(controllers.includes(ServiceJobLinkedWorksheetsController));
    assert.ok(providers.includes(ServiceJobLinkedWorksheetsService));
    assert.ok(
      providers.some(
        (p) =>
          (p as { name?: string }).name ===
          "ServiceJobLinkedWorksheetsRepository",
      ),
    );
  });

  it("az olvasás service.view, minden írás és a választó service.manage", () => {
    const proto = ServiceJobLinkedWorksheetsController.prototype;
    const need = (name: keyof ServiceJobLinkedWorksheetsController) =>
      Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, proto[name]) as string[];
    assert.deepEqual(need("list"), [PERMISSIONS.SERVICE_VIEW]);
    assert.deepEqual(need("linkable"), [PERMISSIONS.SERVICE_MANAGE]);
    assert.deepEqual(need("link"), [PERMISSIONS.SERVICE_MANAGE]);
    assert.deepEqual(need("unlink"), [PERMISSIONS.SERVICE_MANAGE]);
  });
});
