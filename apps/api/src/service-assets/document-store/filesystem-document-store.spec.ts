import assert from "node:assert/strict";
import { chmod, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { FilesystemDocumentStore } from "./filesystem-document-store.js";

describe("the filesystem document store", () => {
  let root: string;

  before(async () => {
    root = await mkdtemp(path.join(tmpdir(), "document-store-"));
  });

  after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("gives back the bytes it was given", async () => {
    const store = new FilesystemDocumentStore(root);
    const bytes = Uint8Array.from([1, 2, 3, 250]);

    await store.put({ assetId: "asset-1", documentId: "doc-1" }, bytes);

    assert.deepEqual(
      await store.get({ assetId: "asset-1", documentId: "doc-1" }),
      bytes,
    );
  });

  it("keeps the same document id apart under two assets", async () => {
    const store = new FilesystemDocumentStore(root);

    await store.put(
      { assetId: "asset-a", documentId: "same" },
      Uint8Array.from([1]),
    );
    await store.put(
      { assetId: "asset-b", documentId: "same" },
      Uint8Array.from([2]),
    );

    assert.deepEqual(
      await store.get({ assetId: "asset-a", documentId: "same" }),
      Uint8Array.from([1]),
    );
    assert.deepEqual(
      await store.get({ assetId: "asset-b", documentId: "same" }),
      Uint8Array.from([2]),
    );
  });

  it("answers null for a document it never stored", async () => {
    const store = new FilesystemDocumentStore(root);

    assert.equal(
      await store.get({ assetId: "asset-1", documentId: "missing" }),
      null,
    );
  });

  it("reports whether the delete removed anything", async () => {
    const store = new FilesystemDocumentStore(root);
    const key = { assetId: "asset-delete", documentId: "doc-1" };
    await store.put(key, Uint8Array.from([1]));

    assert.equal(await store.delete(key), true);
    assert.equal(await store.get(key), null);
    assert.equal(await store.delete(key), false);
  });

  /**
   * A KÉRT KALIBRÁCIÓ a végrehajtási sorrend 2. lépéséből: egy `..` szegmenst
   * tartalmazó azonosító a gyökér FÖLÉ mutat, és a hívásnak el kell hasalnia.
   *
   * A MÁSODIK ÁLLÍTÁS ITT A FONTOSABB, és nem elhagyható: nem elég, hogy a
   * hívás kivételt dob, az sem keletkezhet, amit meg akart írni. Egy olyan
   * ellenőrzés, ami szól, DE a művelet közben végigmegy, rosszabb a semminél,
   * mert a naplóból úgy néz ki, mintha a védelem működött volna.
   */
  it("refuses a key that would escape the root, and writes nothing", async () => {
    const escapeRoot = await mkdtemp(
      path.join(tmpdir(), "document-store-escape-"),
    );
    const store = new FilesystemDocumentStore(path.join(escapeRoot, "inside"));

    // KÉT SZINT KELL, NEM EGY, és ezt a teszt első futása mérte meg, nem én
    // láttam előre: az útvonal `<gyökér>/assets/<assetId>/<documentId>`, tehát
    // egyetlen `..` csak az `assets` szegmenst lépi vissza, és a cél a gyökér
    // ALATT marad. Egy olyan bemenet, ami nem tud kiszökni, nem méri a
    // védelmet, csak úgy néz ki, mintha mérné.
    await assert.rejects(
      () =>
        store.put(
          { assetId: "../..", documentId: "escaped" },
          Uint8Array.from([1]),
        ),
      /gyökerén kívülre mutat/,
    );

    assert.deepEqual(await readdir(escapeRoot), []);
    await rm(escapeRoot, { recursive: true, force: true });
  });

  it("refuses an absolute document id the same way", async () => {
    const store = new FilesystemDocumentStore(root);

    await assert.rejects(
      () =>
        store.put(
          { assetId: "asset-1", documentId: "/etc/passwd" },
          Uint8Array.from([1]),
        ),
      /gyökerén kívülre mutat/,
    );
  });

  /**
   * A SIKERES ÍRÁS NEM HAGY IDEIGLENES FÁJLT. Ha a `rename` elmaradna vagy a
   * takarítás hiányozna, a könyvtárban `.tmp` végű szemét gyűlne, és azt a
   * `get` sosem találná meg: néma, lassan növő hiba.
   */
  it("leaves no temporary file behind after a successful write", async () => {
    const store = new FilesystemDocumentStore(root);
    await store.put(
      { assetId: "asset-tmp", documentId: "doc-1" },
      Uint8Array.from([1, 2, 3]),
    );

    const entries = await readdir(path.join(root, "assets", "asset-tmp"));

    assert.deepEqual(entries, ["doc-1"]);
  });

  /**
   * A BEÁLLÍTOTTSÁG HÁROM ÁLLAPOTA, három külön bemenettel. Mindegyikhez olyan
   * eset kell, ahol a TÖBBI feltétel igaz, különben a teszt neve mást ígér,
   * mint amit mér.
   */
  it("says not-configured when the root does not exist", async () => {
    const store = new FilesystemDocumentStore(
      path.join(root, "no-such-directory"),
    );

    assert.deepEqual((await store.describe()).state, "not-configured");
  });

  it("says broken when the root is a file, not a directory", async () => {
    const asFile = path.join(root, "not-a-directory");
    await writeFile(asFile, "");
    const store = new FilesystemDocumentStore(asFile);

    assert.deepEqual((await store.describe()).state, "broken");
  });

  it("says ready for a directory it can write", async () => {
    const store = new FilesystemDocumentStore(root);

    assert.deepEqual(await store.describe(), { state: "ready" });
  });

  /**
   * AZ ÍRÁSVÉDETT KÖNYVTÁR `broken`, NEM `not-configured`: a könyvtár ott van,
   * csak nem használható. A kettő KÉT különböző hiba, és más oldja fel őket
   * (csatolás kontra jogosultság).
   *
   * ROOT ALATT KIHAGYVA: a `root` felhasználó az írásvédett könyvtárba is ír,
   * tehát ott ez az állítás nem tudna elbukni. Egy mérés, ami nem tud elbukni,
   * díszlet, és rosszabb a semminél.
   */
  it("says broken when the root exists but is not writable", async (t) => {
    if (typeof process.getuid === "function" && process.getuid() === 0) {
      t.skip("root alatt az írásvédettség nem mérhető");
      return;
    }

    const readOnly = await mkdtemp(path.join(tmpdir(), "document-store-ro-"));
    await chmod(readOnly, 0o500);
    try {
      const store = new FilesystemDocumentStore(readOnly);

      assert.deepEqual((await store.describe()).state, "broken");
    } finally {
      await chmod(readOnly, 0o700);
      await rm(readOnly, { recursive: true, force: true });
    }
  });
});
