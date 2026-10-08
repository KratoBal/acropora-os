import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  DocumentKey,
  DocumentStore,
} from "../service-assets/document-store/document-store.js";
import { QuotePublishService } from "./quote-publish.service.js";

/** A failed attempt's cleanup (barracuda's #1598 review). */
describe("a failed publish attempt leaves nothing behind", () => {
  const key: DocumentKey = {
    owner: "quote",
    ownerId: "q",
    documentId: "v1-abc",
  };

  function service(
    version: { status: string; pdfStorageKey: string | null } | null,
  ) {
    const deleted: DocumentKey[] = [];
    const resets: unknown[] = [];
    const store = {
      delete: async (k: DocumentKey) => {
        deleted.push(k);
        return true;
      },
    } as unknown as DocumentStore;
    const s = new QuotePublishService(store, {});
    (s as unknown as { database: unknown }).database = {
      quoteVersion: {
        findFirst: async () => version,
        updateMany: async (args: unknown) => {
          resets.push(args);
          return { count: 1 };
        },
      },
    };
    const abandon = (stored: DocumentKey | null) =>
      (
        s as unknown as {
          abandonAttempt(
            q: string,
            v: string,
            k: DocumentKey | null,
          ): Promise<void>;
        }
      ).abandonAttempt("q", "v", stored);
    return { abandon, deleted, resets };
  }

  it("a draft gets its request time back to null, and the stored PDF goes", async () => {
    const { abandon, deleted, resets } = service({
      status: "DRAFT",
      pdfStorageKey: null,
    });
    await abandon(key);
    assert.deepEqual(resets, [
      {
        where: { id: "v", status: "DRAFT" },
        data: { publishRequestedAt: null },
      },
    ]);
    assert.deepEqual(deleted, [key]);
  });

  it("the file the other click published is kept, and a published version is not reset", async () => {
    const { abandon, deleted, resets } = service({
      status: "PUBLISHED",
      pdfStorageKey: "v1-abc",
    });
    await abandon(key);
    assert.deepEqual(deleted, []);
    assert.deepEqual(resets, []);
  });

  it("nothing stored, nothing deleted", async () => {
    const { abandon, deleted } = service({
      status: "DRAFT",
      pdfStorageKey: null,
    });
    await abandon(null);
    assert.deepEqual(deleted, []);
  });
});
