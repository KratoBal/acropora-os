import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { NotFoundException } from "@nestjs/common";

import { agentItemSummary, agentItemView } from "./content-agent-view.js";
import type { ContentRepository } from "./content.repository.js";
import { ContentService } from "./content.service.js";

/*
  WHAT TURNS THESE RED (card c5a8e6d6, the machine entry's read-back): another author's item readable by the agent (it must be
  "not found", 404, not "forbidden"); the list taken over everyone's items and filtered afterwards; a user identifier (an
  author, an actor, a reviewer) in the view; the approver's send-back note missing from the history or the comments; an
  agent's own trace comment not marked as its own; the name lookup asked for ids that are not comment authors.
*/
const AGENT = "agent-1";
const NOW = new Date("2026-11-10T18:00:00.000Z");

const comment = (authorId: string | null, body: string) => ({
  id: `c-${body}`,
  contentId: "item-1",
  authorId,
  body,
  createdAt: NOW,
});

const stored = (overrides: Record<string, unknown> = {}) => ({
  id: "item-1",
  title: "Teszt vázlat",
  channel: "FACEBOOK_POST",
  state: "AWAITING_REVISION",
  body: "A szöveg",
  authorId: AGENT,
  reviewerId: "reviewer-9",
  imageRequired: true,
  imageAttachedAt: null,
  plannedFor: new Date("2026-11-20T00:00:00.000Z"),
  scheduleAnchoredAt: null,
  scheduledFor: null,
  externalUrl: "https://facebook.example/post/1",
  updatedAt: NOW,
  comments: [
    comment("approver-7", "Javítsd a második bekezdést."),
    comment(AGENT, "Gépi javítás: törzs: 10 karakterről 20 karakterre."),
    comment(null, "rendszer"),
  ],
  stateEvents: [
    {
      id: "e1",
      fromState: null,
      toState: "AWAITING_REVIEW",
      actorUserId: AGENT,
      note: null,
      createdAt: new Date("2026-11-10T10:00:00.000Z"),
    },
    {
      id: "e2",
      fromState: "AWAITING_REVIEW",
      toState: "AWAITING_REVISION",
      actorUserId: "approver-7",
      note: "Javítsd a második bekezdést.",
      createdAt: new Date("2026-11-10T11:00:00.000Z"),
    },
  ],
  ...overrides,
});

function serviceWith(
  item: ReturnType<typeof stored> | null,
  listed: unknown[] = [],
) {
  const asked: { name: string; args: unknown }[] = [];
  const repository = {
    list: async (where: unknown) => {
      asked.push({ name: "list", args: where });
      return listed;
    },
    detail: async () => item,
    userNames: async (ids: readonly string[]) => {
      asked.push({ name: "userNames", args: [...ids].sort() });
      return new Map(
        ids.map((id) => [id, id === "approver-7" ? "Balázs" : `Név ${id}`]),
      );
    },
  } as unknown as ContentRepository;
  return { service: new ContentService(repository), asked };
}

describe("a gépi ágens visszaolvasása", () => {
  it("a saját tételek listája a hívó szerzőjére szűr a lekérdezésben, és csak az összefoglalót adja", async () => {
    const { service, asked } = serviceWith(null, [
      {
        ...stored(),
        id: "item-1",
        authorId: AGENT,
        externalUrl: "https://facebook.example/post/1",
      },
    ]);
    const items = await service.agentItems(AGENT);
    assert.deepEqual(asked, [{ name: "list", args: { authorId: AGENT } }]);
    assert.deepEqual(items, [
      {
        id: "item-1",
        title: "Teszt vázlat",
        channel: "FACEBOOK_POST",
        state: "AWAITING_REVISION",
        updatedAt: NOW.toISOString(),
      },
    ]);
  });

  it("a saját tétel szövege, állapota, naplója és hozzászólásai olvashatók, a jóváhagyó visszaküldési megjegyzésével együtt", async () => {
    const { service } = serviceWith(stored());
    const view = await service.agentItem("item-1", AGENT);
    assert.equal(view.state, "AWAITING_REVISION");
    assert.equal(view.body, "A szöveg");
    assert.equal(view.imageRequired, true);
    assert.equal(view.imageAttached, false);
    assert.equal(view.plannedFor, "2026-11-20T00:00:00.000Z");
    const sendBack = view.history.find(
      (e) => e.toState === "AWAITING_REVISION",
    );
    assert.equal(sendBack?.note, "Javítsd a második bekezdést.");
    assert.equal(sendBack?.actorName, "Balázs");
    assert.deepEqual(
      view.comments.map((c) => [c.authorName, c.body, c.mine]),
      [
        ["Balázs", "Javítsd a második bekezdést.", false],
        [
          `Név ${AGENT}`,
          "Gépi javítás: törzs: 10 karakterről 20 karakterre.",
          true,
        ],
        [null, "rendszer", false],
      ],
    );
  });

  it("más szerző tétele 404 (nem 403), és a hiányzó tétel is 404", async () => {
    const other = serviceWith(stored({ authorId: "someone-else" }));
    await assert.rejects(
      () => other.service.agentItem("item-1", AGENT),
      NotFoundException,
    );
    const missing = serviceWith(null);
    await assert.rejects(
      () => missing.service.agentItem("nincs", AGENT),
      NotFoundException,
    );
  });

  it("a névkeresés csak a hozzászólók és a naplóbeli szereplők azonosítóit kéri, a lektorét nem", async () => {
    const { service, asked } = serviceWith(stored());
    await service.agentItem("item-1", AGENT);
    const lookups = asked.filter((a) => a.name === "userNames");
    assert.ok(lookups.length >= 1);
    for (const lookup of lookups) {
      assert.equal(
        (lookup.args as string[]).includes("reviewer-9"),
        false,
        "the reviewer's id is not looked up",
      );
    }
    // the comment authors are looked up
    assert.ok(
      lookups.some(
        (lookup) =>
          (lookup.args as string[]).includes(AGENT) &&
          (lookup.args as string[]).includes("approver-7"),
      ),
    );
  });

  it("a nézetben sehol nincs felhasználó-azonosító, szerzői, lektori vagy külső mező", async () => {
    const { service } = serviceWith(stored());
    const text = JSON.stringify(await service.agentItem("item-1", AGENT));
    for (const forbidden of [
      "approver-7",
      "reviewer-9",
      "actorUserId",
      "authorId",
      "reviewerId",
      "externalUrl",
      "facebook.example",
    ])
      assert.equal(text.includes(forbidden), false, forbidden);
  });
});

describe("a tiszta nézet", () => {
  it("az összefoglaló csak öt mezőt visz", () => {
    assert.deepEqual(
      Object.keys(
        agentItemSummary({
          id: "i",
          title: "t",
          channel: "FACEBOOK_POST",
          state: "IDEA",
          updatedAt: NOW,
          ...{ authorId: "x", externalUrl: "y" },
        }),
      ),
      ["id", "title", "channel", "state", "updatedAt"],
    );
  });

  it("a kép csatolva jelzője a csatolás idejéből jön, a nulla idő nem csatolt", () => {
    const base = {
      id: "i",
      title: "t",
      channel: "FACEBOOK_POST" as const,
      state: "IDEA",
      updatedAt: NOW,
      body: null,
      imageRequired: true,
      plannedFor: null,
      history: [],
      comments: [],
    };
    assert.equal(
      agentItemView({ ...base, imageAttachedAt: null }, AGENT, new Map())
        .imageAttached,
      false,
    );
    assert.equal(
      agentItemView({ ...base, imageAttachedAt: NOW }, AGENT, new Map())
        .imageAttached,
      true,
    );
  });
});
