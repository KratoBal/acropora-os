import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  canSend,
  fileSizeLabel,
  previewText,
  readyAttachmentIds,
  replyPreviewText,
  uploadsReducer,
  type PendingUpload,
} from "./outbox";
import { parseSseChunk } from "./sse";
import { readUploadResponse, uploadPercent } from "./upload-outcome";

/*
  AZ ÜZENETEK 2. FÁZISA A TELEFONON: a feltöltési sor, az előnézet, a feltöltés
  válaszának olvasása és a `message.updated` esemény. Ami pirosít: a küldés
  elindulhat egy még töltődő fájl mellett, vagy hibás feltöltést visz; egy csak
  képből álló üzenet üres előnézetet kap; egy azonosító nélküli 2xx sikernek
  számít; a haladás 100-at mutat a válasz előtt; a szerkesztés és a reakció
  eseménye elnyelődik.
*/
describe("the upload queue", () => {
  const added = (localId: string): PendingUpload[] =>
    uploadsReducer([], {
      type: "added",
      upload: { localId, fileName: `${localId}.jpg`, sizeBytes: 2048 },
    });

  it("uploading, progress, done or failed, retried, removed", () => {
    let state = added("a");
    assert.equal(state[0]!.status, "uploading");
    state = uploadsReducer(state, {
      type: "progress",
      localId: "a",
      percent: 40,
    });
    assert.equal(state[0]!.percent, 40);
    state = uploadsReducer(state, { type: "failed", localId: "a", error: "x" });
    assert.equal(state[0]!.status, "failed");
    state = uploadsReducer(state, { type: "retried", localId: "a" });
    assert.deepEqual(
      [state[0]!.status, state[0]!.percent, state[0]!.error],
      ["uploading", 0, null],
    );
    state = uploadsReducer(state, {
      type: "done",
      localId: "a",
      attachmentId: "att-a",
    });
    assert.deepEqual(readyAttachmentIds(state), ["att-a"]);
    assert.deepEqual(
      uploadsReducer(state, { type: "removed", localId: "a" }),
      [],
    );
  });

  it("sends only when nothing is uploading, and only with text or a finished file", () => {
    const uploading = added("a");
    assert.equal(canSend("szia", uploading), false);
    const failed = uploadsReducer(uploading, {
      type: "failed",
      localId: "a",
      error: "x",
    });
    assert.equal(canSend("", failed), false);
    assert.deepEqual(readyAttachmentIds(failed), []);
    const done = uploadsReducer(uploading, {
      type: "done",
      localId: "a",
      attachmentId: "att-a",
    });
    assert.equal(canSend("", done), true);
    assert.equal(canSend("  ", []), false);
  });

  it("the size label of the design", () => {
    assert.equal(fileSizeLabel(512), "512 B");
    assert.equal(fileSizeLabel(2048), "2 kB");
    assert.equal(fileSizeLabel(2.4 * 1024 * 1024), "2,4 MB");
  });
});

describe("the preview text", () => {
  const image = {
    id: "att-1",
    kind: "IMAGE" as const,
    fileName: "a.jpg",
    contentType: "image/jpeg",
    sizeBytes: 1,
    hasThumbnail: true,
  };

  it("an image-only message is not an empty preview; text wins; deleted says so", () => {
    assert.equal(
      previewText({ text: null, deleted: false, attachments: [image] }),
      "📷 Kép",
    );
    assert.equal(
      previewText({
        text: null,
        deleted: false,
        attachments: [{ ...image, kind: "FILE", fileName: "ajanlat.pdf" }],
      }),
      "📎 ajanlat.pdf",
    );
    assert.equal(
      previewText({ text: "szia", deleted: false, attachments: [image] }),
      "szia",
    );
    assert.equal(
      previewText({ text: "szia", deleted: true, attachments: [] }),
      "Az üzenetet törölték.",
    );
  });

  it("the quoted message: deleted, text, or the kind of its attachment", () => {
    const reply = {
      id: "m1",
      senderName: "Anna",
      text: null,
      deleted: false,
      attachmentKind: "IMAGE" as const,
    };
    assert.equal(replyPreviewText(reply), "📷 Kép");
    assert.equal(
      replyPreviewText({ ...reply, attachmentKind: "FILE" }),
      "📎 Fájl",
    );
    assert.equal(replyPreviewText({ ...reply, text: "igen" }), "igen");
    assert.equal(
      replyPreviewText({ ...reply, text: "igen", deleted: true }),
      "Az üzenetet törölték.",
    );
  });
});

describe("the upload response", () => {
  it("progress never claims 100 before the server answered; unknown total is 0", () => {
    assert.equal(uploadPercent(50, 100), 50);
    assert.equal(uploadPercent(100, 100), 99);
    assert.equal(uploadPercent(10, 0), 0);
  });

  it("a 2xx with a body is the attachment; an unreadable 2xx is an error, not a success", () => {
    assert.deepEqual(readUploadResponse(201, '{"id":"att-1"}'), {
      kind: "ok",
      value: { id: "att-1" },
    });
    assert.equal(readUploadResponse(201, "").kind, "error");
    assert.equal(readUploadResponse(200, "<html>").kind, "error");
  });

  it("the server's message is kept, as text or as a list", () => {
    assert.deepEqual(
      readUploadResponse(413, '{"message":"A fájl túl nagy."}'),
      { kind: "error", status: 413, message: "A fájl túl nagy." },
    );
    assert.deepEqual(readUploadResponse(400, '{"message":["a","b"]}'), {
      kind: "error",
      status: 400,
      message: "a, b",
    });
    assert.deepEqual(readUploadResponse(502, "bad gateway"), {
      kind: "error",
      status: 502,
      message: "API request failed (502).",
    });
  });
});

describe("the stream", () => {
  it("an edit, delete or reaction arrives as message.updated", () => {
    const { signals } = parseSseChunk(
      'event: message.updated\ndata: {"type":"message.updated","conversationId":"c1","messageId":"m1"}\n\n',
    );
    assert.deepEqual(signals, [
      { type: "message.updated", conversationId: "c1", messageId: "m1" },
    ]);
  });
});
