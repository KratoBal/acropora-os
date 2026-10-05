import type { MessageItem } from "@acropora/types";
import { describe, expect, it } from "vitest";

import { lastMessagePreview } from "./conversation-parts";
import { composerKeyAction } from "./conversation-view";
import {
  canSend,
  conversationTimeLabel,
  dayDividerLabel,
  mergeMessages,
  fileSizeLabel,
  outboxReducer,
  readyAttachmentIds,
  uploadsReducer,
  visibleOutgoing,
  type OutgoingMessage,
} from "./outbox";

/*
  A KLIENS KÜLDÉSI ÁLLAPOTA (prompt 22. pont). Ami pirosít: egy meg nem erősített
  üzenet elküldöttnek látszik vagy eltűnik; egy megerősített kétszer látszik; az
  újrapróbálás új azonosítót kap; a folyam és a válasz ugyanazt az üzenetet kétszer
  teszi be; az Enter Shift-tel is küld.
*/
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
    replyTo: null,
    attachments: [],
    reactions: [],
    clientMessageId,
  }) as MessageItem;

describe("the outbox", () => {
  it("pending -> failed -> retried keeps the same client id; removed drops it", () => {
    let state = outboxReducer([], { type: "queued", message: out("a") });
    state = outboxReducer(state, { type: "failed", clientMessageId: "a" });
    expect(state.map((m) => [m.clientMessageId, m.status])).toEqual([
      ["a", "failed"],
    ]);
    state = outboxReducer(state, { type: "retried", clientMessageId: "a" });
    expect(state.map((m) => [m.clientMessageId, m.status])).toEqual([
      ["a", "pending"],
    ]);
    expect(
      outboxReducer(state, { type: "removed", clientMessageId: "a" }),
    ).toEqual([]);
  });

  it("a message the server confirmed is not shown twice; another conversation's is not shown", () => {
    const outbox = [out("a"), out("b"), out("x", { conversationId: "c2" })];
    const shown = visibleOutgoing(outbox, "c1", [
      server("m1", "2026-10-05T10:00:01Z", "a"),
    ]);
    expect(shown.map((m) => m.clientMessageId)).toEqual(["b"]);
  });

  it("merging keeps one copy per id, in time order", () => {
    const merged = mergeMessages(
      [
        server("m2", "2026-10-05T10:00:02Z"),
        server("m1", "2026-10-05T10:00:01Z"),
      ],
      [
        server("m2", "2026-10-05T10:00:02Z"),
        server("m3", "2026-10-05T10:00:03Z"),
      ],
    );
    expect(merged.map((m) => m.id)).toEqual(["m1", "m2", "m3"]);
  });
});

describe("the composer and the labels", () => {
  it("Enter sends, Shift+Enter breaks the line, typing an accent does not send", () => {
    expect(composerKeyAction({ key: "Enter", shiftKey: false })).toBe("send");
    expect(composerKeyAction({ key: "Enter", shiftKey: true })).toBe("newline");
    expect(
      composerKeyAction({ key: "Enter", shiftKey: false, isComposing: true }),
    ).toBe(null);
    expect(composerKeyAction({ key: "a", shiftKey: false })).toBe(null);
  });

  it("the list time: today the clock, yesterday 'tegnap', this week the day, else the date", () => {
    const now = new Date(2026, 9, 9, 15, 0); // péntek
    expect(
      conversationTimeLabel(new Date(2026, 9, 9, 14, 42).toISOString(), now),
    ).toBe("14:42");
    expect(
      conversationTimeLabel(new Date(2026, 9, 8, 9, 0).toISOString(), now),
    ).toBe("tegnap");
    expect(
      conversationTimeLabel(new Date(2026, 9, 5, 9, 0).toISOString(), now),
    ).toBe("hét.");
    expect(
      conversationTimeLabel(new Date(2026, 8, 20, 9, 0).toISOString(), now),
    ).toMatch(/09/);
    expect(dayDividerLabel(new Date(2026, 9, 9, 8, 0).toISOString(), now)).toBe(
      "Ma",
    );
    expect(dayDividerLabel(new Date(2026, 9, 8, 8, 0).toISOString(), now)).toBe(
      "Tegnap",
    );
  });
});

describe("the upload queue", () => {
  const up = (localId: string) => ({
    type: "added" as const,
    upload: { localId, fileName: `${localId}.pdf`, sizeBytes: 2_500_000 },
  });

  it("uploading, progress, done or failed, retried, removed", () => {
    let s = uploadsReducer([], up("a"));
    s = uploadsReducer(s, { type: "progress", localId: "a", percent: 40 });
    expect(s.map((u) => [u.status, u.percent])).toEqual([["uploading", 40]]);
    s = uploadsReducer(s, {
      type: "failed",
      localId: "a",
      error: "nincs kapcsolat",
    });
    s = uploadsReducer(s, { type: "retried", localId: "a" });
    expect(s.map((u) => [u.status, u.percent, u.error])).toEqual([
      ["uploading", 0, null],
    ]);
    s = uploadsReducer(s, { type: "done", localId: "a", attachmentId: "f1" });
    expect(readyAttachmentIds(s)).toEqual(["f1"]);
    expect(uploadsReducer(s, { type: "removed", localId: "a" })).toEqual([]);
  });

  it("sends only when nothing is uploading, and only with text or a finished file", () => {
    const uploading = uploadsReducer([], up("a"));
    const done = uploadsReducer(uploading, {
      type: "done",
      localId: "a",
      attachmentId: "f1",
    });
    const failed = uploadsReducer(uploading, {
      type: "failed",
      localId: "a",
      error: "x",
    });
    expect(canSend("szöveg", uploading)).toBe(false);
    expect(canSend("", done)).toBe(true);
    expect(canSend("", failed)).toBe(false);
    expect(canSend("  ", [])).toBe(false);
    expect(readyAttachmentIds(failed)).toEqual([]);
  });

  it("the size label of the design", () => {
    expect([512, 20_480, 2_516_582].map(fileSizeLabel)).toEqual([
      "512 B",
      "20 kB",
      "2,4 MB",
    ]);
  });
});

describe("the list preview", () => {
  it("an image-only last message shows its kind, not an empty line", () => {
    const last = {
      id: "m1",
      conversationId: "c1",
      senderUserId: "u1",
      senderName: "Anna",
      type: "IMAGE",
      text: null,
      deleted: false,
      createdAt: "2026-10-05T10:00:00.000Z",
      editedAt: null,
      replyToMessageId: null,
      replyTo: null,
      attachments: [
        {
          id: "a1",
          kind: "IMAGE",
          fileName: "kep.jpg",
          contentType: "image/jpeg",
          sizeBytes: 10,
          hasThumbnail: true,
        },
      ],
      reactions: [],
      clientMessageId: null,
    } satisfies MessageItem;
    const item = {
      id: "c1",
      type: "GROUP" as const,
      audience: "INTERNAL" as const,
      title: "Szerviz",
      members: [],
      lastMessage: last,
      lastMessageAt: last.createdAt,
      unreadCount: 0,
    };
    expect(lastMessagePreview(item)).toBe("Anna: 📷 Kép");
    expect(
      lastMessagePreview({
        ...item,
        type: "DIRECT",
        lastMessage: {
          ...last,
          type: "FILE",
          attachments: [
            { ...last.attachments[0]!, kind: "FILE", fileName: "a.pdf" },
          ],
        },
      }),
    ).toBe("📎 a.pdf");
  });
});
