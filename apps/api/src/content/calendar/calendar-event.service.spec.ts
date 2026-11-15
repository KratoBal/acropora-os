import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import type { CalendarEvent } from "@acropora/types";

import type {
  CalendarEventRepository,
  CalendarEventWrite,
} from "./calendar-event.repository.js";
import {
  CalendarEventService,
  type CalendarEventActor,
} from "./calendar-event.service.js";

/*
  THE HAND-ENTERED CALENDAR EVENTS, THE RULES (T5.5 S2). What turns this red: a missing end not taken as a one-day
  event; an impossible day, a reversed or a too long range written; an inactive or unknown person set as responsible;
  an unchanged responsible who left since blocking an unrelated edit; a stale form overwriting a newer record; an
  empty place stored as blank text instead of nothing; a machine account (the content agent, which holds content.manage)
  creating, editing or deleting one.
*/
const PERSON: CalendarEventActor = { id: "u1", role: "MANAGER" };
const AGENT: CalendarEventActor = { id: "agent", role: "CONTENT_AGENT" };
const STORED: CalendarEvent = {
  id: "e1",
  kind: "SHOP_EVENT",
  title: "Nyílt nap",
  startsOn: "2026-11-20",
  endsOn: "2026-11-20",
  location: "Bolt",
  responsible: { id: "left", name: "Volt kolléga" },
  createdAt: "2026-11-15T10:00:00.000Z",
  updatedAt: "2026-11-15T10:00:00.000Z",
};

function fake(
  options: {
    stored?: CalendarEvent | null;
    update?: "changed" | null;
    deleted?: boolean;
  } = {},
) {
  const writes: CalendarEventWrite[] = [];
  const userChecks: string[] = [];
  const view = (data: CalendarEventWrite): CalendarEvent => ({
    ...STORED,
    ...data,
    responsible: data.responsibleUserId
      ? { id: data.responsibleUserId, name: null }
      : null,
  });
  let deletes = 0;
  const order: string[] = [];
  const repo = {
    get: async () => (options.stored === undefined ? STORED : options.stored),
    responsibleCandidate: async (id: string) => {
      userChecks.push(id);
      return id === "active";
    },
    create: async (data: CalendarEventWrite) => {
      writes.push(data);
      return view(data);
    },
    update: async (_id: string, data: CalendarEventWrite) => {
      writes.push(data);
      return options.update === undefined ? view(data) : options.update;
    },
    delete: async () => {
      deletes += 1;
      order.push("delete");
      return options.deleted ?? true;
    },
  } as unknown as CalendarEventRepository;
  const service = new CalendarEventService(repo);
  const followed: Parameters<CalendarEventService["follow"]>[0][] = [];
  service.follow = async (input) => {
    followed.push(input);
    order.push("follow");
    return { moved: 0, steppedBack: 0, told: 0 };
  };
  return {
    service,
    writes,
    userChecks,
    deletes: () => deletes,
    followed,
    order,
  };
}

const badRequest = (pattern: RegExp) => (error: unknown) =>
  error instanceof BadRequestException && pattern.test(error.message);

describe("CalendarEventService.create", () => {
  it("no end is a one-day event; the title and the place are trimmed, an empty place is nothing", async () => {
    const { service, writes } = fake();
    await service.create(
      {
        kind: "HOLIDAY",
        title: "  Zárva  ",
        startsOn: "2026-12-24",
        location: "   ",
      },
      PERSON,
    );
    assert.deepEqual(writes, [
      {
        kind: "HOLIDAY",
        title: "Zárva",
        startsOn: "2026-12-24",
        endsOn: "2026-12-24",
        location: null,
        responsibleUserId: null,
      },
    ]);
  });

  for (const [what, input, pattern] of [
    ["an impossible day", { startsOn: "2026-02-30" }, /nem létező nap/],
    [
      "an end before the start",
      { startsOn: "2026-11-20", endsOn: "2026-11-19" },
      /nem lehet a kezdete előtt/,
    ],
    [
      "an event longer than the widest feed range",
      { startsOn: "2026-01-01", endsOn: "2026-04-03" },
      /legfeljebb 92 napos/,
    ],
    ["a title of spaces only", { title: "   " }, /címet/],
    [
      "an inactive or unknown responsible",
      { responsibleUserId: "nobody" },
      /nem tartalom-kezelő/,
    ],
  ] as const)
    it(`refuses ${what} with a 400 that names it, and writes nothing`, async () => {
      const { service, writes } = fake();
      await assert.rejects(
        service.create(
          {
            kind: "SHOP_EVENT",
            title: "Előadás",
            startsOn: "2026-11-20",
            ...input,
          },
          PERSON,
        ),
        badRequest(pattern),
      );
      assert.deepEqual(writes, []);
    });

  it("a 92-day event is the longest allowed, and an active responsible is accepted", async () => {
    const { service, writes } = fake();
    await service.create(
      {
        kind: "SHOP_EVENT",
        title: "Kiállítás",
        startsOn: "2026-01-01",
        endsOn: "2026-04-02",
        responsibleUserId: "active",
      },
      PERSON,
    );
    assert.equal(writes[0]!.endsOn, "2026-04-02");
    assert.equal(writes[0]!.responsibleUserId, "active");
  });
});

describe("CalendarEventService.update", () => {
  it("merges over the stored record; an unchanged responsible who left is not asked again; null clears the place", async () => {
    const { service, writes, userChecks } = fake();
    await service.update(
      "e1",
      { title: "Nyílt nap 2", location: null },
      PERSON,
    );
    assert.deepEqual(writes, [
      {
        kind: "SHOP_EVENT",
        title: "Nyílt nap 2",
        startsOn: "2026-11-20",
        endsOn: "2026-11-20",
        location: null,
        responsibleUserId: "left",
      },
    ]);
    assert.deepEqual(userChecks, []);
  });

  it("a NEW responsible is checked", async () => {
    const { service, writes } = fake();
    await assert.rejects(
      service.update("e1", { responsibleUserId: "nobody" }, PERSON),
      badRequest(/nem tartalom-kezelő/),
    );
    assert.deepEqual(writes, []);
  });

  it("a moved start is checked against the stored end", async () => {
    const { service } = fake();
    await assert.rejects(
      service.update("e1", { startsOn: "2026-11-21" }, PERSON),
      badRequest(/nem lehet a kezdete előtt/),
    );
  });

  it("a form loaded before the last change is a 409, and nothing is written", async () => {
    const { service, writes } = fake();
    await assert.rejects(
      service.update(
        "e1",
        { title: "X", expectedUpdatedAt: "2026-11-15T09:00:00.000Z" },
        PERSON,
      ),
      ConflictException,
    );
    assert.deepEqual(writes, []);
  });

  it("a row that moved between the read and the write is a 409, a missing one a 404", async () => {
    await assert.rejects(
      fake({ update: "changed" }).service.update("e1", { title: "X" }, PERSON),
      ConflictException,
    );
    await assert.rejects(
      fake({ stored: null }).service.update("e1", { title: "X" }, PERSON),
      NotFoundException,
    );
  });
});

describe("a machine account reads, a person writes (acrobot 53159)", () => {
  it("the content agent is refused create, edit and delete with a 403, and nothing is written or deleted", async () => {
    const { service, writes, deletes } = fake();
    const refused = (error: unknown) =>
      error instanceof ForbiddenException && /gépi fiók/.test(error.message);
    await assert.rejects(
      service.create(
        { kind: "HOLIDAY", title: "Zárva", startsOn: "2026-12-24" },
        AGENT,
      ),
      refused,
    );
    await assert.rejects(service.update("e1", { title: "X" }, AGENT), refused);
    await assert.rejects(service.delete("e1", AGENT), refused);
    assert.deepEqual(writes, []);
    assert.equal(deletes(), 0);
  });

  it("and it still reads", async () => {
    assert.equal((await fake().service.get("e1")).id, "e1");
  });
});

describe("the event's slots follow it (S7)", () => {
  it("a saved edit hands the new days to the slots, with the editor", async () => {
    const { service, followed } = fake();
    await service.update(
      "e1",
      { startsOn: "2026-11-22", endsOn: "2026-11-23" },
      PERSON,
    );
    assert.deepEqual(followed, [
      {
        eventKey: "event:e1",
        eventTitle: "Nyílt nap",
        event: {
          title: "Nyílt nap",
          startsOn: "2026-11-22",
          endsOn: "2026-11-23",
        },
        actorUserId: "u1",
      },
    ]);
  });

  it("a delete tells the slots the event is gone BEFORE deleting it", async () => {
    const { service, followed, order } = fake();
    await service.delete("e1", PERSON);
    assert.equal(followed[0]!.event, null);
    assert.deepEqual(order, ["follow", "delete"]);
  });

  it("a refused edit or a machine account tells the slots nothing", async () => {
    const { service, followed } = fake();
    await assert.rejects(
      service.update("e1", { startsOn: "2026-11-21" }, PERSON),
    );
    await assert.rejects(service.delete("e1", AGENT));
    assert.deepEqual(followed, []);
  });
});

describe("CalendarEventService.delete and get", () => {
  it("a missing event is a 404 on both", async () => {
    await assert.rejects(
      fake({ deleted: false }).service.delete("e1", PERSON),
      NotFoundException,
    );
    await assert.rejects(
      fake({ stored: null }).service.get("e1"),
      NotFoundException,
    );
  });
});
