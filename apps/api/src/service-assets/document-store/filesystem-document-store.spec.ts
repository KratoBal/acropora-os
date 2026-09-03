import assert from "node:assert/strict";
import { collectDocumentKeys } from "./document-store.js";
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import {
  FilesystemDocumentStore,
  MARKER_FILE,
} from "./filesystem-document-store.js";

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

    await store.put(
      { owner: "asset" as const, ownerId: "asset-1", documentId: "doc-1" },
      bytes,
    );

    assert.deepEqual(
      await store.get({
        owner: "asset" as const,
        ownerId: "asset-1",
        documentId: "doc-1",
      }),
      bytes,
    );
  });

  it("keeps the same document id apart under two assets", async () => {
    const store = new FilesystemDocumentStore(root);

    await store.put(
      { owner: "asset" as const, ownerId: "asset-a", documentId: "same" },
      Uint8Array.from([1]),
    );
    await store.put(
      { owner: "asset" as const, ownerId: "asset-b", documentId: "same" },
      Uint8Array.from([2]),
    );

    assert.deepEqual(
      await store.get({
        owner: "asset" as const,
        ownerId: "asset-a",
        documentId: "same",
      }),
      Uint8Array.from([1]),
    );
    assert.deepEqual(
      await store.get({
        owner: "asset" as const,
        ownerId: "asset-b",
        documentId: "same",
      }),
      Uint8Array.from([2]),
    );
  });

  it("answers null for a document it never stored", async () => {
    const store = new FilesystemDocumentStore(root);

    assert.equal(
      await store.get({
        owner: "asset" as const,
        ownerId: "asset-1",
        documentId: "missing",
      }),
      null,
    );
  });

  it("reports whether the delete removed anything", async () => {
    const store = new FilesystemDocumentStore(root);
    const key = {
      owner: "asset" as const,
      ownerId: "asset-delete",
      documentId: "doc-1",
    };
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
          { owner: "asset" as const, ownerId: "../..", documentId: "escaped" },
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
          {
            owner: "asset" as const,
            ownerId: "asset-1",
            documentId: "/etc/passwd",
          },
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
      { owner: "asset" as const, ownerId: "asset-tmp", documentId: "doc-1" },
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

  /**
   * A LISTA A TÁROLÓ FELŐL NÉZ, a hívó kulcsai nélkül. Ez az a mérés, amit a
   * tábla összege NEM tud megadni: egy elárvult fájlról épp az a jellemző,
   * hogy nincs sora.
   */
  it("lists the files it holds, two levels deep", async () => {
    const listRoot = await mkdtemp(path.join(tmpdir(), "document-store-list-"));
    try {
      const store = new FilesystemDocumentStore(listRoot);
      await store.put(
        { owner: "asset" as const, ownerId: "a", documentId: "1" },
        Uint8Array.from([1]),
      );
      await store.put(
        { owner: "asset" as const, ownerId: "b", documentId: "2" },
        Uint8Array.from([2]),
      );

      const listed = await collectDocumentKeys(store.list());

      assert.deepEqual(
        listed
          .map((key) => `${key.owner}/${key.ownerId}/${key.documentId}`)
          .sort(),
        ["asset/a/1", "asset/b/2"],
      );
    } finally {
      await rm(listRoot, { recursive: true, force: true });
    }
  });

  /**
   * AZ IDEIGLENES FÁJL NEM ELÁRVULT FÁJL, hanem egy FUTÓ írás közepe. Ha a
   * lista beleszámolná, minden párhuzamos feltöltés hamis leletet gyártana --
   * és három ilyen után senki nem nézné meg a listát, pont akkor, amikor a
   * valódi jön.
   *
   * A TESZT NEVE A KORLÁTOT IS KIMONDJA, és ez szándékos: ugyanez a szűrő
   * elrejt egy MEGSZAKADT írásból ottmaradt törzset is, ami valódi szemét. A
   * kettőt csak az életkor különbözteti meg, és időhatárt mérés nélkül nem
   * választunk. Lásd a `filesystem-document-store.ts` `list()` jegyzetét.
   */
  it("skips a temporary file, and with it any left by a crashed write", async () => {
    const listRoot = await mkdtemp(path.join(tmpdir(), "document-store-tmp-"));
    try {
      await mkdir(path.join(listRoot, "assets", "a"), { recursive: true });
      await writeFile(path.join(listRoot, "assets", "a", "1"), "");
      await writeFile(path.join(listRoot, "assets", "a", "1.abc.tmp"), "");
      const store = new FilesystemDocumentStore(listRoot);

      assert.deepEqual(await collectDocumentKeys(store.list()), [
        { owner: "asset" as const, ownerId: "a", documentId: "1" },
      ]);
    } finally {
      await rm(listRoot, { recursive: true, force: true });
    }
  });

  /**
   * A NEM CSATOLT GYÖKÉR ÜRES LISTÁT AD, NEM KIVÉTELT. A beállítottság
   * kérdését a `describe()` méri; ha ez is felelne rá, a hívó két különböző
   * választ kaphatna ugyanarra.
   */
  it("lists nothing when the root is not there at all", async () => {
    const store = new FilesystemDocumentStore(
      path.join(root, "no-such-directory-either"),
    );

    assert.deepEqual(await collectDocumentKeys(store.list()), []);
  });

  /**
   * A HIÁNYZÓ JELÖLŐ `not-configured`, NEM `ready`. Ez a szakasz lényege: egy
   * írható könyvtár önmagában nem bizonyítja, hogy a kötet csatolva van, mert
   * a csatolási pont ÜRES könyvtára ugyanolyan írható.
   *
   * A bemenet olyan, ahol minden MÁS feltétel igaz: a könyvtár létezik és
   * írható, csak a jelölő hiányzik.
   */
  it("says not-configured when the marker file is missing", async () => {
    const unmarked = await mkdtemp(path.join(tmpdir(), "document-store-bare-"));
    try {
      const store = new FilesystemDocumentStore(unmarked);

      assert.deepEqual((await store.describe()).state, "not-configured");
    } finally {
      await rm(unmarked, { recursive: true, force: true });
    }
  });

  it("says ready for a marked directory it can write", async () => {
    const store = new FilesystemDocumentStore(root);
    await writeFile(path.join(root, MARKER_FILE), "");

    assert.deepEqual(await store.describe(), { state: "ready" });
  });

  /**
   * AZ ALKALMAZÁS SOHA NEM HOZZA LÉTRE A JELÖLŐT, és ezt írás UTÁN kell mérni,
   * mert épp az írási út a kísértés: ott már úgyis van `mkdir`.
   *
   * Ha a `put` letenné a jelölőt, akkor egy nem csatolt könyvtár az ELSŐ
   * feltöltés után késznek mondaná magát, és a `describe()` soha többé nem
   * tudna elbukni. A védelem néma módon szűnne meg: a bajt nem a hibás
   * állapot, hanem a következő újraindítás mutatná meg, amikor a fájlok
   * eltűnnek a hoszt lemezéről.
   */
  it("never creates the marker itself, not even while writing", async () => {
    const unmarked = await mkdtemp(
      path.join(tmpdir(), "document-store-write-"),
    );
    try {
      const store = new FilesystemDocumentStore(unmarked);
      await store.put(
        { owner: "asset" as const, ownerId: "asset-1", documentId: "doc-1" },
        Uint8Array.from([1]),
      );

      assert.deepEqual(await readdir(unmarked), ["assets"]);
      assert.deepEqual((await store.describe()).state, "not-configured");
    } finally {
      await rm(unmarked, { recursive: true, force: true });
    }
  });

  /**
   * AZ ÍRÁSVÉDETT, DE CSATOLT KÖTET `broken`, NEM `not-configured`: ott VAN a
   * jelölő, tehát a csatolás megtörtént, csak a jogosultság rossz. A kettőt más
   * ember oldja fel (telepítés kontra jogosultság), ezért nem szabad egy közös
   * „nem működik" alá vonni őket.
   *
   * A BEMENET OLYAN, AHOL MINDEN MÁS FELTÉTEL IGAZ: a jelölő ott van, és csak
   * az írhatóság hiányzik. Jelölő nélkül ez a teszt egy MÁSIK okból is zöld
   * lenne, és akkor a neve mást ígérne, mint amit mér.
   *
   * ROOT ALATT KIHAGYVA: a `root` felhasználó az írásvédett könyvtárba is ír,
   * tehát ott ez az állítás nem tudna elbukni. Egy mérés, ami nem tud elbukni,
   * díszlet, és rosszabb a semminél.
   */
  it("says broken when the marked root is not writable", async (t) => {
    if (typeof process.getuid === "function" && process.getuid() === 0) {
      t.skip("root alatt az írásvédettség nem mérhető");
      return;
    }

    const readOnly = await mkdtemp(path.join(tmpdir(), "document-store-ro-"));
    await writeFile(path.join(readOnly, MARKER_FILE), "");
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

describe("a gazda a lemezen is elvalik", () => {
  it("az ESZKOZ fajlja az `assets` alatt all, valtozatlanul", async () => {
    /*
      EZ AZ ALLITAS AZT VEDI, AMI NEM VALTOZHAT. A gazda bevezetese REFAKTOR: a
      meglevo eszkoz-ut viselkedese ugyanaz marad, es a fajl ugyanoda kerul,
      ahova eddig.

      MI PIROSIT: a gazda konyvtarnevenek atirasa (`assets` -> `asset`).
    */
    const root = await mkdtemp(path.join(tmpdir(), "docstore-owner-"));
    try {
      const store = new FilesystemDocumentStore(root);
      await store.put(
        { owner: "asset", ownerId: "esz-1", documentId: "d-1" },
        new Uint8Array([1, 2, 3]),
      );
      const bytes = await readFile(path.join(root, "assets", "esz-1", "d-1"));
      assert.deepEqual(new Uint8Array(bytes), new Uint8Array([1, 2, 3]));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("a MUNKALAP fajlja MAS konyvtarba kerul", async () => {
    // ISMERT POZITIV KONTROLL: e nelkul egy valtozat, ami minden gazdat az
    // `assets` ala ir, atmenne a fenti allitason -- es egy munkalap-kep
    // felulirhatna egy eszkoz-dokumentumot.
    const root = await mkdtemp(path.join(tmpdir(), "docstore-owner-"));
    try {
      const store = new FilesystemDocumentStore(root);
      await store.put(
        { owner: "worksheet", ownerId: "ml-1", documentId: "d-1" },
        new Uint8Array([9]),
      );
      const bytes = await readFile(
        path.join(root, "worksheets", "ml-1", "d-1"),
      );
      assert.deepEqual(new Uint8Array(bytes), new Uint8Array([9]));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("a bejaras MIND A KET gazdat latja, idegen konyvtarat viszont NEM", async () => {
    /*
      A bejaras a ZART halmazon megy vegig, nem azon, ami a lemezen all. Egy
      idegen konyvtar (kezzel odamasolt adat, regi elrendezes maradeka) igy nem
      latszik elarvult fajlkent -- a lista a MI elrendezesunkrol szol.

      MI PIROSIT: ha a bejaras a gyoker OSSZES konyvtarat vegigmenne.
    */
    const root = await mkdtemp(path.join(tmpdir(), "docstore-owner-"));
    try {
      const store = new FilesystemDocumentStore(root);
      await store.put(
        { owner: "asset", ownerId: "a", documentId: "1" },
        new Uint8Array([1]),
      );
      await store.put(
        { owner: "worksheet", ownerId: "w", documentId: "2" },
        new Uint8Array([2]),
      );
      await mkdir(path.join(root, "idegen", "x"), { recursive: true });
      await writeFile(path.join(root, "idegen", "x", "3"), new Uint8Array([3]));

      const listed = [];
      for await (const key of store.list()) listed.push(key);
      assert.deepEqual(
        listed
          .map((key) => `${key.owner}/${key.ownerId}/${key.documentId}`)
          .sort(),
        ["asset/a/1", "worksheet/w/2"],
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
