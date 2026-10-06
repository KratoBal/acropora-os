import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HttpException } from "@nestjs/common";
import {
  SUTYERAK_USER_ID,
  type AuthenticatedUser,
  type MessageStreamEvent,
} from "@acropora/types";

import { ASSISTANT_ERROR } from "../assistant/assistant.service.js";
import { AssistantThinkingState } from "./assistant-thinking.state.js";
import {
  MessagesAssistantService,
  readGatewayAnswer,
} from "./messages-assistant.service.js";
import type { MessagingUserRow } from "./messages.repository.js";
import { SUTYERAK_INBOX_REDIRECT } from "./sutyerak-inbox.js";
import {
  SUTYERAK_ATTACHMENT_ONLY,
  assistantReplyPlan,
  mentionsSutyerak,
} from "./messages.rules.js";

/*
  SUTYERÁK VÁLASZOL AZ ÜZENETEKBEN (4. pont B). MI PIROSÍT:
  - csoportban említés nélkül is beleszól, vagy említésre (toldalékkal,
    ékezet nélkül, nagybetűvel) sem;
  - a saját, a törölt vagy a rendszer-üzenetre is válaszol;
  - nem a KÜLDŐ nevében és belépőjével hívja az átjárót, vagy annak is
    válaszol, akinek nem elérhető;
  - a szál nem marad meg a folytatáshoz, vagy egy idegen szál (403) után nem
    kezd újat;
  - hiba vagy korlát után csend marad, nem egy rövid Sutyerák-üzenet;
  - a gondolkodik-jelzés nem kapcsol ki a hiba után.
*/

describe("assistantReplyPlan and mentionsSutyerak", () => {
  const base = {
    assistantUserId: SUTYERAK_USER_ID,
    senderUserId: "a",
    conversationType: "DIRECT" as const,
    activeMemberIds: ["a", SUTYERAK_USER_ID],
    type: "TEXT",
    text: "Hol tart a 2026/123 munkalap?",
    attachmentCount: 0,
    deleted: false,
  };

  it("a direct conversation: every message; a group: only when named", () => {
    assert.deepEqual(assistantReplyPlan(base), {
      kind: "ASK",
      question: "Hol tart a 2026/123 munkalap?",
      group: false,
    });
    const group = {
      ...base,
      conversationType: "GROUP" as const,
      activeMemberIds: ["a", "b", SUTYERAK_USER_ID],
    };
    assert.equal(assistantReplyPlan(group), null);
    assert.deepEqual(
      assistantReplyPlan({ ...group, text: "Sutyerák, mennyi a készlet?" }),
      { kind: "ASK", question: "Sutyerák, mennyi a készlet?", group: true },
    );
  });

  it("the name counts with a suffix, without accents and in capitals, but not inside another word", () => {
    for (const text of [
      "Kérdezzük meg Sutyerákot",
      "SUTYERAK mit gondolsz?",
      "szólj sutyeráknak",
    ])
      assert.equal(mentionsSutyerak(text), true, text);
    for (const text of ["asutyerak", "Sutyi", null])
      assert.equal(mentionsSutyerak(text), false, String(text));
  });

  it("never its own, a deleted or a system message, nor where it is not a member", () => {
    assert.equal(
      assistantReplyPlan({ ...base, senderUserId: SUTYERAK_USER_ID }),
      null,
    );
    assert.equal(assistantReplyPlan({ ...base, deleted: true }), null);
    assert.equal(assistantReplyPlan({ ...base, type: "SYSTEM" }), null);
    assert.equal(
      assistantReplyPlan({ ...base, activeMemberIds: ["a", "b"] }),
      null,
    );
  });

  it("an attachment alone: one sentence in a direct conversation, silence in a group", () => {
    const only = { ...base, text: null, attachmentCount: 1 };
    assert.deepEqual(assistantReplyPlan(only), { kind: "ATTACHMENT_ONLY" });
    assert.equal(
      assistantReplyPlan({
        ...only,
        conversationType: "GROUP",
        activeMemberIds: ["a", "b", SUTYERAK_USER_ID],
      }),
      null,
    );
  });
});

describe("readGatewayAnswer", () => {
  it("takes the thread and the finished answer, and skips the text pieces and junk", () => {
    assert.deepEqual(
      readGatewayAnswer(
        [
          '{"type":"thread","threadId":"t-1","new":true}',
          '{"type":"text","delta":"Sz"}',
          "nem json",
          '{"type":"done","answer":"Szia!","durationMs":10,"toolCalls":0}',
        ].join("\n"),
      ),
      { threadId: "t-1", answer: "Szia!" },
    );
    assert.deepEqual(
      readGatewayAnswer('{"type":"error","message":"foglalt"}\n'),
      { threadId: null, answer: null },
    );
  });
});

const member = (
  id: string,
  over: Partial<MessagingUserRow> = {},
): MessagingUserRow => ({
  id,
  role: "SERVICE",
  isActive: true,
  customerId: null,
  supplierId: null,
  displayName: `Teljes ${id}`,
  nickname: null,
  avatarUrl: null,
  ...over,
});

const ndjson = (lines: unknown[], status = 200) =>
  new Response(lines.map((l) => JSON.stringify(l)).join("\n") + "\n", {
    status,
    headers: { "content-type": "application/x-ndjson" },
  });

function setup(
  over: {
    type?: "DIRECT" | "GROUP";
    memberIds?: string[];
    text?: string | null;
    attachments?: number;
    sender?: string;
    available?: (user: AuthenticatedUser) => boolean;
    thread?: string | null;
    responses?: (Response | Error)[];
  } = {},
) {
  const memberIds = over.memberIds ?? ["a", SUTYERAK_USER_ID];
  const posted: [string, string, string][] = [];
  const asked: { user: string; input: Record<string, unknown> }[] = [];
  const threads: string[] = [];
  const events: MessageStreamEvent[] = [];
  const responses = [...(over.responses ?? [])];
  let thread = over.thread ?? null;
  const repository = {
    messagesByIds: async () => [
      {
        id: "m1",
        conversationId: "c1",
        senderUserId: over.sender ?? "a",
        type: "TEXT",
        text: over.text === undefined ? "Hol tart a munkalap?" : over.text,
        attachments: Array.from({ length: over.attachments ?? 0 }, () => ({
          kind: "FILE",
        })),
        deletedAt: null,
      },
    ],
    conversation: async () => ({
      id: "c1",
      type: over.type ?? "DIRECT",
      members: memberIds.map((id) => ({ userId: id, user: member(id) })),
    }),
    assistantThread: async () => thread,
    saveAssistantThread: async (_c: string, user: string, id: string) => {
      threads.push(`save ${user} ${id}`);
      thread = id;
    },
    dropAssistantThread: async (_c: string, user: string) => {
      threads.push(`drop ${user}`);
      thread = null;
    },
  };
  const messages = {
    postAsAssistant: async (c: string, text: string, source: string) =>
      void posted.push([c, text, source]),
  };
  const assistant = {
    availableTo: over.available ?? (() => true),
    askOnBehalf: async (
      user: AuthenticatedUser,
      input: Record<string, unknown>,
    ) => {
      asked.push({ user: user.id, input });
      const next = responses.shift();
      if (next instanceof Error) throw next;
      return next ?? ndjson([{ type: "done", answer: "Kész." }]);
    },
  };
  const thinking = new AssistantThinkingState();
  const bus = {
    publish: (_ids: readonly string[], event: MessageStreamEvent) =>
      void events.push(event),
    subscribe: () => {
      throw new Error("not in this test");
    },
  };
  const service = new MessagesAssistantService(
    repository as never,
    messages as never,
    assistant as never,
    thinking,
    bus,
  );
  return { service, posted, asked, threads, events, thinking };
}

describe("MessagesAssistantService.handle", () => {
  it("answers in the sender's name, on its thread, keeps the thread, and shows it thinking meanwhile", async () => {
    const { service, posted, asked, threads, events, thinking } = setup({
      responses: [
        ndjson([
          { type: "thread", threadId: "t-9", new: true },
          { type: "done", answer: "A munkalap kész." },
        ]),
      ],
    });
    assert.equal(await service.handle("c1", "m1"), "ANSWERED");
    assert.deepEqual(asked, [
      {
        user: "a",
        input: {
          question: "Hol tart a munkalap?",
          context: {
            page: "/uzenetek",
            conversationId: "c1",
            audience: "direct",
          },
        },
      },
    ]);
    assert.deepEqual(posted, [["c1", "A munkalap kész.", "GATEWAY"]]);
    assert.deepEqual(threads, ["save a t-9"]);
    assert.deepEqual(
      events.map((e) => (e.type === "assistant.thinking" ? e.active : e.type)),
      [true, false],
    );
    assert.equal(thinking.has("c1"), false);
  });

  it("a group answers only when named, and tells the gateway it is a group", async () => {
    const group = {
      type: "GROUP" as const,
      memberIds: ["a", "b", SUTYERAK_USER_ID],
    };
    const silent = setup(group);
    assert.equal(await silent.service.handle("c1", "m1"), "SKIPPED");
    assert.deepEqual([silent.asked, silent.posted], [[], []]);
    const named = setup({ ...group, text: "Sutyerák, hol tart?" });
    assert.equal(await named.service.handle("c1", "m1"), "ANSWERED");
    assert.equal(
      (named.asked[0]!.input.context as { audience: string }).audience,
      "group",
    );
  });

  it("an attachment alone gets one sentence, without asking the gateway", async () => {
    const { service, posted, asked } = setup({ text: null, attachments: 1 });
    assert.equal(await service.handle("c1", "m1"), "ATTACHMENT_ONLY");
    assert.deepEqual(asked, []);
    assert.deepEqual(posted, [["c1", SUTYERAK_ATTACHMENT_ONLY, "GATEWAY"]]);
  });

  it("whom it is not available to, and its own message, get no answer", async () => {
    const unavailable = setup({ available: () => false });
    assert.equal(await unavailable.service.handle("c1", "m1"), "SKIPPED");
    const own = setup({ sender: SUTYERAK_USER_ID });
    assert.equal(await own.service.handle("c1", "m1"), "SKIPPED");
    assert.deepEqual([...unavailable.posted, ...own.posted], []);
  });

  it("a gateway failure is a short message, not silence, and the thinking stops", async () => {
    const { service, posted, events, thinking } = setup({
      responses: [new Response("boom", { status: 502 })],
    });
    assert.equal(await service.handle("c1", "m1"), "FAILED");
    assert.deepEqual(posted, [["c1", ASSISTANT_ERROR, "GATEWAY"]]);
    assert.equal(events.at(-1)?.type, "assistant.thinking");
    assert.equal(thinking.has("c1"), false);
  });

  it("the limit's own sentence goes out (429)", async () => {
    const { service, posted } = setup({
      responses: [
        new HttpException("Túl sok kérdés egy perc alatt.", 429) as Error,
      ],
    });
    assert.equal(await service.handle("c1", "m1"), "FAILED");
    assert.deepEqual(posted, [
      ["c1", "Túl sok kérdés egy perc alatt.", "GATEWAY"],
    ]);
  });

  it("a thread that is no longer the sender's (403) is dropped, and the question goes again without it", async () => {
    const { service, asked, threads, posted } = setup({
      thread: "t-old",
      responses: [
        new Response("", { status: 403 }),
        ndjson([
          { type: "thread", threadId: "t-new", new: true },
          { type: "done", answer: "Újra itt." },
        ]),
      ],
    });
    assert.equal(await service.handle("c1", "m1"), "ANSWERED");
    assert.deepEqual(
      asked.map((a) => a.input.threadId ?? null),
      ["t-old", null],
    );
    assert.deepEqual(threads, ["drop a", "save a t-new"]);
    assert.deepEqual(posted, [["c1", "Újra itt.", "GATEWAY"]]);
  });
});

/*
  A POSTAFIÓK-FIÓK (4. pont B, 6. tétel; az „Acrobot Szerviz”). MI PIROSÍT: aki
  neki ír, nem kap választ; a mondat minden üzenetre megismétlődik; a saját
  mondatára is válaszol; induláskor a megválaszolatlan régi beszélgetés nem
  kapja meg, vagy a már megválaszolt újra megkapja.
*/
describe("MessagesAssistantService: an inbox nobody reads", () => {
  const INBOX = "inbox-1";
  function inboxSetup(history: { id: string; sender: string; text: string }[]) {
    const posted: [string, string, string][] = [];
    const rows = history.map((h) => ({
      id: h.id,
      conversationId: "c9",
      senderUserId: h.sender,
      type: "TEXT",
      text: h.text,
      attachments: [],
      deletedAt: null,
    }));
    const repository = {
      messagesByIds: async (ids: readonly string[]) =>
        rows.filter((r) => ids.includes(r.id)),
      messagesPage: async () => ({
        rows: [...rows].reverse(),
        hasOlder: false,
      }),
      conversationsOf: async () => [
        { id: "c9", lastMessageId: rows.at(-1)?.id ?? null },
      ],
    };
    const messages = {
      postAs: async (sender: string, c: string, text: string) =>
        void posted.push([sender, c, text]),
    };
    const service = new MessagesAssistantService(
      repository as never,
      messages as never,
      { availableTo: () => true } as never,
      new AssistantThinkingState(),
      { publish: () => undefined, subscribe: () => undefined } as never,
      { ids: () => [INBOX], has: (id: string) => id === INBOX } as never,
    );
    return { service, posted };
  }

  it("whoever writes to it gets one sentence in its name, telling them to ask Sutyerák", async () => {
    const { service, posted } = inboxSetup([
      { id: "m1", sender: "feri", text: "Mikor jön az alkatrész?" },
    ]);
    assert.equal(await service.redirect(INBOX, "c9", "m1"), "REDIRECTED");
    assert.deepEqual(posted, [[INBOX, "c9", SUTYERAK_INBOX_REDIRECT]]);
  });

  it("not again right after its own sentence, and never to its own message", async () => {
    const after = inboxSetup([
      { id: "m1", sender: "feri", text: "Kérdés" },
      { id: "m2", sender: INBOX, text: SUTYERAK_INBOX_REDIRECT },
      { id: "m3", sender: "feri", text: "Még egy" },
    ]);
    // közvetlenül a 3. üzenet előtt már a mondat áll: tudja, nem ismétli
    assert.equal(await after.service.redirect(INBOX, "c9", "m3"), "SKIPPED");
    const own = inboxSetup([
      { id: "m2", sender: INBOX, text: SUTYERAK_INBOX_REDIRECT },
    ]);
    assert.equal(await own.service.redirect(INBOX, "c9", "m2"), "SKIPPED");
  });

  it("at start-up an unanswered old conversation gets it once, an answered one not again", async () => {
    const waiting = inboxSetup([
      { id: "m1", sender: "feri", text: "Ki olvassa ezt?" },
    ]);
    assert.equal(await waiting.service.redirectWaiting(), 1);
    const answered = inboxSetup([
      { id: "m1", sender: "feri", text: "Ki olvassa ezt?" },
      { id: "m2", sender: INBOX, text: SUTYERAK_INBOX_REDIRECT },
    ]);
    assert.equal(await answered.service.redirectWaiting(), 0);
    assert.deepEqual(answered.posted, []);
  });
});
