import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ACCEPTED_UPLOAD_MIMETYPES,
  uploadAccept,
  UPLOADED_FILE_TYPES,
} from "./upload-file-type.js";

/*
  WHAT TURNS THIS RED. A kind added or dropped without the pickers following; a picker's accept list built from the
  non-standard spelling, or in another order than asked; a declared type the server takes missing from the full list.
*/
describe("the upload file types", () => {
  it("takes PDF, JPEG and PNG, the old image/jpg spelling included", () => {
    assert.deepEqual(Object.keys(UPLOADED_FILE_TYPES), ["pdf", "jpeg", "png"]);
    assert.deepEqual([...ACCEPTED_UPLOAD_MIMETYPES].sort(), [
      "application/pdf",
      "image/jpeg",
      "image/jpg",
      "image/png",
    ]);
  });

  it("builds a picker's accept list from the standard types, in the order asked", () => {
    assert.equal(
      uploadAccept(["pdf", "jpeg", "png"]),
      "application/pdf,image/jpeg,image/png",
    );
    assert.equal(
      uploadAccept(["jpeg", "png", "pdf"]),
      "image/jpeg,image/png,application/pdf",
    );
    assert.equal(uploadAccept(["pdf"]), "application/pdf");
  });
});
