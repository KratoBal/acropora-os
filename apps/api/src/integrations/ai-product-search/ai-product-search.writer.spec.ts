import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  writeSearchDocument,
  type DocumentWriterClient,
} from "./ai-product-search.writer.js";
import {
  describeBalance,
  runAiSearchRebuildCli,
} from "./ai-product-search.cli.js";

function fakeClient(product: unknown) {
  const calls: Array<{ operation: string; args: unknown }> = [];
  const client: DocumentWriterClient = {
    product: {
      findUnique: async (args: unknown) => {
        calls.push({ operation: "findUnique", args });
        return product;
      },
    },
    aiProductSearchDocument: {
      upsert: async (args: unknown) => {
        calls.push({ operation: "upsert", args });
        return {};
      },
    },
  };
  return { client, calls };
}

const product = {
  id: "product-1",
  name: "Reef Salt",
  isActive: true,
  mirrorState: "ACTIVE",
  catalogAuthority: "UNAS",
  description: null,
  brand: null,
  categories: [],
  variants: [
    {
      sku: "REEF-SALT-01",
      manufacturerPartNumber: null,
      barcodes: [],
      supplierProducts: [],
    },
  ],
  unasSnapshot: {
    descriptionShort: "Tengeri só",
    descriptionLong: null,
    parameters: null,
  },
};

describe("the one writer of the search document", () => {
  it("writes create and update from the SAME built document", async () => {
    /**
     * Ha a két ág külön épülne, egy beszúrt és egy frissített sor
     * eltérhetne - és az eltérés láthatatlan lenne, mert mindkettő létező,
     * értelmes dokumentum.
     */
    const { client, calls } = fakeClient(product);

    assert.equal(await writeSearchDocument(client, "product-1"), true);

    const upsert = calls.find((call) => call.operation === "upsert")?.args as {
      where: { productId: string };
      create: { title: string };
      update: { title: string };
    };
    assert.equal(upsert.where.productId, "product-1");
    assert.deepEqual(upsert.create, upsert.update);
    assert.equal(upsert.create.title, "Reef Salt");
  });

  it("reads only the columns the document is built from", async () => {
    /**
     * A `select` A HATÁR, nem a szándék. `ProductExtension` egy relációnyira
     * van, és beszerzési árat meg preferált beszállítót tart; egy bőkezű
     * `include` mindkettőt behozná egy modell-kontextusba.
     */
    const { client, calls } = fakeClient(product);
    await writeSearchDocument(client, "product-1");

    const read = calls[0]?.args as { select: Record<string, unknown> };
    assert.equal("select" in read, true);
    assert.equal("include" in read, false);
    assert.equal(read.select.extension, undefined);
    assert.equal(read.select.stockItems, undefined);
  });

  it("writes nothing when the product is not there", async () => {
    // A hívó tranzakciója fontosabb, mint az index frissessége: egy hiányzó
    // dokumentum-sor a megtalálhatóságot késlelteti, egy visszagörgetett
    // termék-írás adatot veszít.
    const { client, calls } = fakeClient(null);

    assert.equal(await writeSearchDocument(client, "hianyzik"), false);
    assert.equal(
      calls.some((call) => call.operation === "upsert"),
      false,
    );
  });
});

describe("the balance between products and documents", () => {
  it("prints BOTH sides, not the difference", () => {
    // Ha egyszer eltolódik, azt kell tudni, MELYIK oldal mozdult.
    const { text, balanced } = describeBalance({
      searchableProducts: 3,
      searchableDocuments: 2,
      totalProducts: 4,
      totalDocuments: 4,
    });

    assert.equal(balanced, false);
    assert.match(text, /kereshető termék:\s+3/);
    assert.match(text, /kereshető dokumentum:\s+2/);
    assert.match(text, /összes termék:\s+4/);
    assert.match(text, /összes dokumentum:\s+4/);
  });

  it("calls an equal count balanced", () => {
    const { balanced } = describeBalance({
      searchableProducts: 3,
      searchableDocuments: 3,
      totalProducts: 4,
      totalDocuments: 4,
    });
    assert.equal(balanced, true);
  });
});

describe("the rebuild command", () => {
  function fakeWriter(balance: {
    searchableProducts: number;
    searchableDocuments: number;
    totalProducts: number;
    totalDocuments: number;
  }) {
    const calls: string[] = [];
    return {
      calls,
      writer: {
        rebuildAll: async () => {
          calls.push("rebuildAll");
          return { written: 7 };
        },
        balance: async () => {
          calls.push("balance");
          return balance;
        },
      },
    };
  }

  const equal = {
    searchableProducts: 7,
    searchableDocuments: 7,
    totalProducts: 9,
    totalDocuments: 9,
  };

  it("rebuilds, then checks - and the check is not optional", async () => {
    const { writer, calls } = fakeWriter(equal);
    const output: string[] = [];

    const code = await runAiSearchRebuildCli(
      [],
      { stdout: (value) => output.push(value), stderr: () => {} },
      writer,
    );

    assert.equal(code, 0);
    assert.deepEqual(calls, ["rebuildAll", "balance"]);
    assert.match(output.join(""), /újraépítve: 7 dokumentum/);
  });

  it("counts without writing when asked for the balance only", async () => {
    /**
     * Az ellenőrzést akkor is le kell tudni futtatni, amikor épp NEM akarunk
     * hozzányúlni a táblához - éles környezetben, egy panasz után.
     */
    const { writer, calls } = fakeWriter(equal);

    await runAiSearchRebuildCli(
      ["--balance"],
      { stdout: () => {}, stderr: () => {} },
      writer,
    );

    assert.deepEqual(calls, ["balance"]);
  });

  it("fails, and writes to stderr, when the two sides differ", async () => {
    // Az egyenlőtlenség MINDIG hiba, tehát a kilépési kód is az.
    const { writer } = fakeWriter({ ...equal, searchableDocuments: 6 });
    const stdout: string[] = [];
    const stderr: string[] = [];

    const code = await runAiSearchRebuildCli(
      ["--balance"],
      {
        stdout: (value) => stdout.push(value),
        stderr: (value) => stderr.push(value),
      },
      writer,
    );

    assert.equal(code, 1);
    assert.match(stderr.join(""), /ELTÉRÉS/);
    assert.equal(stdout.join("").includes("ELTÉRÉS"), false);
  });
});
