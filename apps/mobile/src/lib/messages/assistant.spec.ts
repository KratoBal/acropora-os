import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  SUTYERAK_VIA_ACROBOT,
  assistantBlocks,
  assistantFirst,
  bubbleSender,
  hasAssistant,
  isAssistantConversation,
  nextThinking,
} from "./assistant";
import { parseSseChunk } from "./sse";
import type { ConversationPerson } from "./types";

/*
  SUTYERÁK AZ ÜZENETEKBEN, A TELEFONON (4. pont, B). Ami pirosít:
  - az assistant.thinking esemény elveszik a folyamban (a régi KNOWN halmaz);
  - egy MÁSIK beszélgetés eseménye kapcsolja a jelzést;
  - Sutyerák nem a kollégaválasztó elején áll;
  - az acrobot adta válasz nincs jelölve, vagy a jelölés csoporton kívül elmarad;
  - a Markdownból HTML vagy kép-hivatkozás jut a rajzolóhoz, vagy a félkövér,
    a felsorolás, a táblázat szétesik.
*/
const person = (
  userId: string,
  kind?: "user" | "assistant",
): ConversationPerson => ({
  userId,
  name: userId,
  avatarUrl: null,
  role: "SERVICE",
  isActive: true,
  ...(kind ? { kind } : {}),
});

describe("Sutyerák on the phone", () => {
  it("the stream passes assistant.thinking through, whole", () => {
    const { signals } = parseSseChunk(
      'event: assistant.thinking\ndata: {"type":"assistant.thinking","conversationId":"c1","active":true}\n\n',
    );
    assert.deepEqual(signals, [
      { type: "assistant.thinking", conversationId: "c1", active: true },
    ]);
  });

  it("'thinking' follows only this conversation's event", () => {
    const on = { type: "assistant.thinking" as const, active: true };
    assert.equal(
      nextThinking(false, { ...on, conversationId: "c2" }, "c1"),
      false,
    );
    assert.equal(
      nextThinking(false, { ...on, conversationId: "c1" }, "c1"),
      true,
    );
    assert.equal(
      nextThinking(
        true,
        { type: "assistant.thinking", conversationId: "c1", active: false },
        "c1",
      ),
      false,
    );
    assert.equal(
      nextThinking(
        true,
        { type: "message.created", conversationId: "c1", messageId: "m" },
        "c1",
      ),
      true,
    );
  });

  it("Sutyerák first in the picker; his two-person conversation is recognised", () => {
    const ordered = assistantFirst([
      person("anna"),
      person("sutyerak", "assistant"),
      person("bela", "user"),
    ]);
    assert.deepEqual(
      ordered.map((p) => p.userId),
      ["sutyerak", "anna", "bela"],
    );
    const direct = {
      type: "DIRECT" as const,
      members: [person("sutyerak", "assistant")],
    };
    assert.equal(isAssistantConversation(direct), true);
    assert.equal(
      isAssistantConversation({ ...direct, members: [person("anna")] }),
      false,
    );
    assert.equal(
      isAssistantConversation({
        type: "GROUP",
        members: [person("anna"), person("sutyerak", "assistant")],
      }),
      false,
    );
    assert.equal(
      hasAssistant({
        members: [person("anna"), person("sutyerak", "assistant")],
      }),
      true,
    );
    assert.equal(hasAssistant({ members: [person("anna")] }), false);
  });

  it("acrobot's answer is labelled in a two-person conversation too; others as before", () => {
    const relayed = { senderName: "Sutyerák", assistant: { viaAcrobot: true } };
    assert.equal(bubbleSender(relayed, false, false), SUTYERAK_VIA_ACROBOT);
    assert.equal(
      bubbleSender(
        { senderName: "Sutyerák", assistant: { viaAcrobot: false } },
        false,
        false,
      ),
      null,
    );
    assert.equal(bubbleSender({ senderName: "Anna" }, true, false), "Anna");
    assert.equal(bubbleSender({ senderName: "Én" }, true, true), null);
  });

  it("Markdown becomes text blocks only: bold, list, table, and HTML stays plain text", () => {
    const blocks = assistantBlocks(
      "**Folyamatban** a munkalap\n- első\n- **második**\n| Név | Érték |\n| --- | --- |\n| A | 1 |\n<img src=x onerror=alert(1)>",
    );
    assert.deepEqual(blocks, [
      {
        kind: "paragraph",
        spans: [
          { text: "Folyamatban", bold: true },
          { text: " a munkalap", bold: false },
        ],
      },
      {
        kind: "list",
        ordered: false,
        items: [
          [{ text: "első", bold: false }],
          [{ text: "második", bold: true }],
        ],
      },
      {
        kind: "table",
        header: [
          [{ text: "Név", bold: false }],
          [{ text: "Érték", bold: false }],
        ],
        rows: [[[{ text: "A", bold: false }], [{ text: "1", bold: false }]]],
      },
      {
        kind: "paragraph",
        spans: [{ text: "<img src=x onerror=alert(1)>", bold: false }],
      },
    ]);
  });
});
