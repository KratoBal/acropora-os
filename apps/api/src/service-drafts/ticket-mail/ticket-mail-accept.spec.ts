import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ticketAttachmentDocumentType,
  ticketJobOpener,
} from "./ticket-mail-accept.js";

/**
 * ACCEPTING A TICKET@ DRAFT (card ec7b947b, S2c): the pure choices. WHAT TURNS RED: a known, active sender's report opened by the manager (or an
 * unknown sender's opened as if a user); a deactivated sender still opening a ticket; a PDF or an unknown file type mapped wrongly.
 */
describe("ticketJobOpener", () => {
  const actor = "manager-1";
  it("a known, active sender opens their own report", () => {
    assert.equal(
      ticketJobOpener({
        senderUserId: "anna",
        senderActive: true,
        actorUserId: actor,
      }),
      "anna",
    );
  });
  it("CONTROL: an unknown sender's draft is opened by the accepting manager", () => {
    assert.equal(
      ticketJobOpener({
        senderUserId: null,
        senderActive: false,
        actorUserId: actor,
      }),
      actor,
    );
  });
  it("CONTROL: a sender whose account is no longer active does not open the ticket", () => {
    assert.equal(
      ticketJobOpener({
        senderUserId: "anna",
        senderActive: false,
        actorUserId: actor,
      }),
      actor,
    );
  });
});

describe("ticketAttachmentDocumentType", () => {
  it("an image is a photo, a PDF another document", () => {
    assert.equal(ticketAttachmentDocumentType("image/png"), "PHOTO");
    assert.equal(ticketAttachmentDocumentType("image/jpeg"), "PHOTO");
    assert.equal(ticketAttachmentDocumentType("IMAGE/JPG"), "PHOTO");
    assert.equal(ticketAttachmentDocumentType("application/pdf"), "OTHER");
  });
  it("CONTROL: anything else is not copied", () => {
    for (const type of [
      "image/gif",
      "image/svg+xml",
      "video/mp4",
      "application/zip",
      "text/html",
      "",
    ])
      assert.equal(ticketAttachmentDocumentType(type), null, type);
  });
});
