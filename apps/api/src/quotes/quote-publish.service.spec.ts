import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  DocumentKey,
  DocumentStore,
} from "../service-assets/document-store/document-store.js";
import {
  QuotePublishService,
  versionContentHash,
} from "./quote-publish.service.js";

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
    const warnings: string[] = [];
    (s as unknown as { logger: unknown }).logger = {
      warn: (message: string) => warnings.push(message),
    };
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
    return { abandon, deleted, resets, steps, warnings };
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

  it("a cleanup that fails itself does not throw, but leaves a warning", async () => {
    const { abandon, deleted, warnings } = service(
      { status: "DRAFT", pdfStorageKey: null },
      true,
    );
    await abandon(key);
    assert.deepEqual(deleted, []);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /cleanup failed too \(the database is gone\)/);
  });
});

/*
  KIVÁLTOTT TÉTEL (card 2540d9d4): a verzió lenyomata része annak, mi változik a publikálás közben. MI PIROSÍT: ha a kiváltás átállítása nem
  mozdítja a lenyomatot (egy közben átállított kiváltás észrevétlen maradna); ha a kiváltás nélküli verzió lenyomata elmozdul a korábbi alakhoz
  képest (a régi tartalom ugyanazt a lenyomatot adja).
*/
describe("the version fingerprint and a replacement", () => {
  const tree = (replacing: string | null) =>
    ({
      quote: { title: "Cím" },
      validUntil: new Date("2026-12-31T00:00:00Z"),
      currency: "HUF",
      priceDisplay: "NET",
      customerSnapshot: null,
      milestones: [],
      blocks: [
        {
          kind: "SECTION",
          title: "Blokk",
          content: null,
          keepWithNext: false,
          startOnNewPage: false,
          items: ["a", "b", "o"].map((id) => ({
            id,
            name: id,
            description: null,
            quantity: { toString: () => "1" },
            unit: "db",
            unitNetPrice: { toString: () => "1000" },
            vatRatePercent: { toString: () => "27" },
            isOptional: id === "o",
            replacesItemId: id === "o" ? replacing : null,
          })),
        },
      ],
    }) as never;

  it("moves when the replacement moves, and stays put without one", () => {
    const none = versionContentHash(tree(null));
    const a = versionContentHash(tree("a"));
    const b = versionContentHash(tree("b"));
    assert.notEqual(a, none);
    assert.notEqual(a, b);
    assert.equal(versionContentHash(tree(null)), none);
  });

  it("does not depend on the item ids, only on the replaced line's place", () => {
    const first = tree("a") as {
      blocks: Array<{
        items: Array<{ id: string; replacesItemId: string | null }>;
      }>;
    };
    const renamed = tree("a") as typeof first;
    for (const item of renamed.blocks[0]!.items) {
      item.id = `x-${item.id}`;
      if (item.replacesItemId) item.replacesItemId = `x-${item.replacesItemId}`;
    }
    assert.equal(
      versionContentHash(first as never),
      versionContentHash(renamed as never),
    );
  });
});
