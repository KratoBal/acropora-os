import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BadRequestException } from "@nestjs/common";

import {
  ScanTimedOut,
  ScanTooLarge,
  ScanUnreadable,
} from "./purchase-invoice-scan.js";
import { scanUploadError } from "./purchase-invoice-scan.service.js";

/*
  The upload itself reads and writes the database, so it is covered by the
  integration spec; what the uploader is told is this mapping (barracuda's
  #1645 review: the time limit's sentence had no unit test).
*/
describe("what a failed scan conversion tells the uploader", () => {
  const sentence = (error: unknown) => {
    const mapped = scanUploadError(error);
    assert.ok(mapped instanceof BadRequestException);
    return mapped.message;
  };

  it("each scan error is a 400 with its own sentence", () => {
    assert.equal(
      sentence(new ScanTimedOut("no answer within 30000 ms")),
      "A kép átalakítása fél perc alatt nem készült el: töltsd fel JPEG-ként vagy kisebb felbontásban.",
    );
    assert.equal(
      sentence(new ScanTooLarge("x")),
      "Túl nagy kép: töltsd fel JPEG-ként vagy kisebb felbontásban.",
    );
    assert.equal(sentence(new ScanUnreadable("x")), "A kép nem olvasható.");
  });

  it("any other error passes through unchanged", () => {
    const other = new Error("database down");
    assert.equal(scanUploadError(other), other);
  });
});
