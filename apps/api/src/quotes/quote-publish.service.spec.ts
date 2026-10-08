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
    version: { status: string; pdfStorageKey: string | null },
    failing = false,
  ) {
    const deleted: DocumentKey[] = [];
    const resets: unknown[] = [];
    /** what happened, in order: the delete must fall inside the lock */
    const steps: string[] = [];
    const store = {
      delete: async (k: DocumentKey) => {
        steps.push("delete");
        deleted.push(k);
        return true;
      },
    } as unknown as DocumentStore;
    const s = new QuotePublishService(store, {});
    const tx = {
      $queryRaw: async () => {
        steps.push("lock");
        return [{ status: version.status }];
      },
      quoteVersion: {
        findUniqueOrThrow: async () => version,
        update: async (args: unknown) => {
          resets.push(args);
          return {};
        },
      },
    };
    (s as unknown as { database: unknown }).database = {
      $transaction: async (run: (t: typeof tx) => Promise<unknown>) => {
        if (failing) throw new Error("the database is gone");
        steps.push("begin");
        const result = await run(tx);
        steps.push("commit");
        return result;
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
    return { abandon, deleted, resets, steps };
  }

  it("a draft gets its request time back to null, and the stored PDF goes", async () => {
    const { abandon, deleted, resets } = service({
      status: "DRAFT",
      pdfStorageKey: null,
    });
    await abandon(key);
    assert.deepEqual(resets, [
      { where: { id: "v" }, data: { publishRequestedAt: null } },
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

  it("the look and the delete happen under the publish lock", async () => {
    const { abandon, steps } = service({
      status: "DRAFT",
      pdfStorageKey: null,
    });
    await abandon(key);
    // the other click cannot publish between the look and the delete
    assert.deepEqual(steps, ["begin", "lock", "lock", "delete", "commit"]);
  });

  it("a cleanup that fails itself stays quiet: the attempt's error is what counts", async () => {
    const { abandon, deleted } = service(
      { status: "DRAFT", pdfStorageKey: null },
      true,
    );
    await abandon(key);
    assert.deepEqual(deleted, []);
  });
});
