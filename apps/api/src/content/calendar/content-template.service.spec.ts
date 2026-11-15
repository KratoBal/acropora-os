import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import type { ContentTemplateRule } from "@acropora/types";

import type { CalendarEventActor } from "./calendar-event.service.js";
import type {
  ContentTemplateRepository,
  ContentTemplateRuleWrite,
} from "./content-template.repository.js";
import { templateOrder } from "./content-template.repository.js";
import { ContentTemplateService } from "./content-template.service.js";

/*
  THE DEPENDENCY TEMPLATE, THE RULES (T5.5 S4). What turns this red: a machine account writing the template; an end
  anchor on a one-day arrival (it has no end of its own); a label of spaces; a stale form overwriting a newer row; an
  edit moving a row to another event kind; the page's order not following the calendar's kinds.
*/
const PERSON: CalendarEventActor = { id: "u1", role: "MANAGER" };
const AGENT: CalendarEventActor = { id: "agent", role: "CONTENT_AGENT" };

const STORED: ContentTemplateRule = {
  id: "t55-sale-last-day",
  eventKind: "SALE",
  label: "Emlékeztető az utolsó napon",
  channel: "FACEBOOK_POST",
  anchor: "END",
  offsetDays: 0,
  active: true,
  sortOrder: 2,
  updatedAt: "2026-11-15T10:00:00.000Z",
};

function fake(
  options: { stored?: ContentTemplateRule | null; update?: "changed" } = {},
) {
  const writes: ContentTemplateRuleWrite[] = [];
  const repo = {
    get: async () => (options.stored === undefined ? STORED : options.stored),
    create: async (data: ContentTemplateRuleWrite) => {
      writes.push(data);
      return { ...STORED, ...data };
    },
    update: async (_id: string, data: ContentTemplateRuleWrite) => {
      writes.push(data);
      return options.update ?? { ...STORED, ...data };
    },
  } as unknown as ContentTemplateRepository;
  return { service: new ContentTemplateService(repo), writes };
}

describe("ContentTemplateService", () => {
  it("a new row counts from the start unless told otherwise, is on, and its label is trimmed", async () => {
    const { service, writes } = fake();
    await service.create(
      {
        eventKind: "SHOP_EVENT",
        label: "  Meghívó  ",
        channel: "NEWSLETTER",
        offsetDays: -5,
      },
      PERSON,
    );
    assert.deepEqual(writes, [
      {
        eventKind: "SHOP_EVENT",
        label: "Meghívó",
        channel: "NEWSLETTER",
        anchor: "START",
        offsetDays: -5,
        active: true,
      },
    ]);
  });

  it("an end anchor on a one-day arrival is a 400; on a sale it is fine", async () => {
    const { service, writes } = fake();
    await assert.rejects(
      service.create(
        {
          eventKind: "LIVESTOCK_ARRIVAL",
          label: "X",
          channel: "FACEBOOK_POST",
          anchor: "END",
          offsetDays: 0,
        },
        PERSON,
      ),
      (error: unknown) =>
        error instanceof BadRequestException &&
        /egy napja van/.test(error.message),
    );
    // a length check, not deepEqual([]): that would narrow `writes` to never[] for the line after
    assert.equal(writes.length, 0);
    await service.update(STORED.id, { offsetDays: -1 }, PERSON);
    assert.equal(writes[0]!.anchor, "END");
  });

  it("an edit merges over the stored row and keeps its event kind; switching off is an edit, not a delete", async () => {
    const { service, writes } = fake();
    await service.update(
      STORED.id,
      { active: false, expectedUpdatedAt: STORED.updatedAt },
      PERSON,
    );
    assert.deepEqual(writes, [
      {
        eventKind: "SALE",
        label: "Emlékeztető az utolsó napon",
        channel: "FACEBOOK_POST",
        anchor: "END",
        offsetDays: 0,
        active: false,
      },
    ]);
  });

  it("a label of spaces is a 400", async () => {
    await assert.rejects(
      fake().service.update(STORED.id, { label: "   " }, PERSON),
      BadRequestException,
    );
  });

  it("a stale form or a row that moved is a 409; a missing row a 404", async () => {
    await assert.rejects(
      fake().service.update(
        STORED.id,
        { label: "Y", expectedUpdatedAt: "2026-11-15T09:00:00.000Z" },
        PERSON,
      ),
      ConflictException,
    );
    await assert.rejects(
      fake({ update: "changed" }).service.update(
        STORED.id,
        { label: "Y" },
        PERSON,
      ),
      ConflictException,
    );
    await assert.rejects(
      fake({ stored: null }).service.update(STORED.id, { label: "Y" }, PERSON),
      NotFoundException,
    );
  });

  it("a machine account is refused create and edit with a 403, and nothing is written", async () => {
    const { service, writes } = fake();
    const refused = (error: unknown) =>
      error instanceof ForbiddenException && /gépi fiók/.test(error.message);
    await assert.rejects(
      service.create(
        {
          eventKind: "SALE",
          label: "X",
          channel: "FACEBOOK_POST",
          offsetDays: 0,
        },
        AGENT,
      ),
      refused,
    );
    await assert.rejects(
      service.update(STORED.id, { label: "X" }, AGENT),
      refused,
    );
    assert.deepEqual(writes, []);
  });
});

describe("templateOrder", () => {
  it("by the calendar's event kinds, then the row's own place", () => {
    const row = (
      id: string,
      eventKind: ContentTemplateRule["eventKind"],
      sortOrder: number,
    ): ContentTemplateRule => ({ ...STORED, id, eventKind, sortOrder });
    assert.deepEqual(
      [
        row("a", "SALE", 1),
        row("b", "LIVESTOCK_ARRIVAL", 2),
        row("c", "LIVESTOCK_ARRIVAL", 1),
        row("d", "HOLIDAY", 1),
      ]
        .sort(templateOrder)
        .map((r) => r.id),
      ["c", "b", "a", "d"],
    );
  });
});
