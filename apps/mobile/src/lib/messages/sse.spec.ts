import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  mergeMessages,
  outboxReducer,
  visibleOutgoing,
  type OutgoingMessage,
} from "./outbox";
import { parseSseChunk, reconnectDelayMs } from "./sse";
import type { MessageItem } from "./types";

/*
  A TELEFON ÜZENET-FOLYAMA ÉS KÜLDÉSI SORA (kártya 51d7aba0). Ami pirosít: egy
  darabolt esemény elveszik vagy kétszer jön; az életjel eseménynek számít; egy
  hibás JSON csendben elnyelődik; a visszacsatlakozás nem ritkul vagy nincs
  felső határa; egy megerősített üzenet kétszer látszik; az újrapróbálás új
  azonosítót kap.
*/
describe("parseSseChunk", () => {
  const frame = (event: string, data: string) =>
    `event: ${event}\ndata: ${data}\n\n`;

  it("an event cut anywhere is read once, when it is complete", () => {
    const whole =
      frame(
        "message.created",
        '{"type":"message.created","conversationId":"c1","messageId":"m1"}',
      ) +
      frame(
        "conversation.read",
        '{"type":"conversation.read","conversationId":"c1"}',
      );
    for (let cut = 1; cut < whole.length; cut++) {
      const first = parseSseChunk(whole.slice(0, cut));
      const second = parseSseChunk(first.rest + whole.slice(cut));
      const types = [...first.signals, ...second.signals].map((s) => s.type);
      assert.deepEqual(
        types,
        ["message.created", "conversation.read"],
        `cut at ${cut}`,
      );
      assert.equal(second.rest, "");
    }
  });

  it("the heartbeat and a comment are not events; CRLF is fine", () => {
    const { signals } = parseSseChunk(
      ": komment\r\n\r\nevent: ping\r\ndata: {}\r\n\r\n" +
        frame(
          "conversation.created",
          '{"type":"conversation.created","conversationId":"c2"}',
        ),
    );
    assert.deepEqual(signals, [
      { type: "conversation.created", conversationId: "c2" },
    ]);
  });

  it("broken data asks for a re-read instead of being dropped", () => {
    assert.deepEqual(
      parseSseChunk(frame("message.created", "{nem json")).signals,
      [{ type: "resync" }],
    );
  });

  it("reconnects less and less often, never slower than 30 s", () => {
    assert.deepEqual(
      [0, 1, 2, 3, 4, 5, 9].map(reconnectDelayMs),
      [1000, 2000, 4000, 8000, 16000, 30000, 30000],
    );
  });
});

describe("the outbox on the phone", () => {
  const out = (
    id: string,
    over: Partial<OutgoingMessage> = {},
  ): OutgoingMessage => ({
    clientMessageId: id,
    conversationId: "c1",
    text: id,
    status: "pending",
    createdAt: "2026-10-05T10:00:00.000Z",
    ...over,
  });
  const server = (
    id: string,
    createdAt: string,
    clientMessageId: string | null = null,
  ) =>
    ({
      id,
      conversationId: "c1",
      senderUserId: "me",
      senderName: "Én",
      type: "TEXT",
      text: id,
      deleted: false,
      createdAt,
      editedAt: null,
      replyToMessageId: null,
      clientMessageId,
    }) as MessageItem;

  it("failed and retried keep the same client id", () => {
    let state = outboxReducer([], { type: "queued", message: out("a") });
    state = outboxReducer(state, { type: "failed", clientMessageId: "a" });
    state = outboxReducer(state, { type: "retried", clientMessageId: "a" });
    assert.deepEqual(
      state.map((m) => [m.clientMessageId, m.status]),
      [["a", "pending"]],
    );
  });

  it("a confirmed message is shown once; merging keeps time order", () => {
    assert.deepEqual(
      visibleOutgoing([out("a"), out("b")], "c1", [
        server("m1", "2026-10-05T10:00:01Z", "a"),
      ]).map((m) => m.clientMessageId),
      ["b"],
    );
    assert.deepEqual(
      mergeMessages(
        [server("m2", "2026-10-05T10:00:02Z")],
        [
          server("m1", "2026-10-05T10:00:01Z"),
          server("m2", "2026-10-05T10:00:02Z"),
        ],
      ).map((m) => m.id),
      ["m1", "m2"],
    );
  });
});
