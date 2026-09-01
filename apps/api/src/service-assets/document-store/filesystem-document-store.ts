import { constants } from "node:fs";
import {
  access,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

import type {
  DocumentKey,
  DocumentStore,
  DocumentStoreStatus,
} from "./document-store.js";

/**
 * FÁJLRENDSZERES DOKUMENTUM-TÁROLÓ: a bájtok egy csatolt könyvtárba kerülnek,
 * `assets/<assetId>/<documentId>` néven.
 *
 * AZ ÍRÁS HÁROM LÉPÉSBEN MEGY, és a sorrend nem stílus kérdése:
 * ideiglenes névre írunk, `fsync`-elünk, és csak azután nevezzük át a végleges
 * névre. Az átnevezés ugyanazon a fájlrendszeren atomi, tehát a végleges néven
 * SOHA nem keletkezik félig megírt fájl. Aki közvetlenül a végleges névre írna,
 * annak egy megszakadt írás után egy csonka, de LÉTEZŐ fájlja maradna -- és a
 * hívó azt nem tudja megkülönböztetni az éptől, mert a hossz maga is adat.
 *
 * AZ IDEIGLENES FÁJL UGYANABBAN A KÖNYVTÁRBAN KELETKEZIK. Egy közös átmeneti
 * könyvtár (például `/tmp`) más fájlrendszeren állhat, és akkor az átnevezés
 * nem átnevezés, hanem másolás plusz törlés: pontosan az az atomiság vész el,
 * amiért az egész alak készül.
 */
export class FilesystemDocumentStore implements DocumentStore {
  private readonly root: string;

  constructor(rootDirectory: string) {
    this.root = path.resolve(rootDirectory);
  }

  async put(key: DocumentKey, bytes: Uint8Array): Promise<void> {
    const target = this.resolveWithin(key);
    await mkdir(path.dirname(target), { recursive: true });

    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      const handle = await open(temporary, "wx");
      try {
        await handle.write(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, target);
    } catch (error) {
      // Az ideiglenes fájl a HIBA ÚTJÁN is eltűnik, különben minden megszakadt
      // írás hagyna egy szemetet, amit senki nem takarít el. A törlés hibáját
      // elnyeljük: az eredeti hiba a fontosabb, azt nem szabad elfednie.
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  async get(key: DocumentKey): Promise<Uint8Array | null> {
    try {
      // A `readFile` BUFFER-t ad, a port viszont `Uint8Array`-t igér, és a
      // kettő nem ugyanaz: a `Buffer` alosztály, tehát egy szigorú mély
      // összehasonlítás megkülönbözteti őket. Ha ezt itt nem alakítjuk vissza,
      // a két megvalósítás CSENDBEN tér el egymástól -- ugyanaz a hiba, amit a
      // memóriabeli változatnál a másolás előz meg. A teszt mérte, nem én
      // láttam előre.
      return new Uint8Array(await readFile(this.resolveWithin(key)));
    } catch (error) {
      if (isMissingFile(error)) return null;
      throw error;
    }
  }

  async delete(key: DocumentKey): Promise<boolean> {
    try {
      await rm(this.resolveWithin(key));
      return true;
    } catch (error) {
      if (isMissingFile(error)) return false;
      throw error;
    }
  }

  /**
   * A TÁROLÓBAN ÁLLÓ FÁJLOK, KÉT SZINT MÉLYEN BEJÁRVA.
   *
   * AZ ELRENDEZÉS `assets/<assetId>/<documentId>`, tehát a bejárás pontosan
   * két szintet megy, nem rekurzívan: egy mélyebb fájl nem a mi
   * elrendezésünkből származik, és ha csendben beleszámolnánk, egy idegen
   * könyvtár tartalma „elárvult fájlnak" látszana.
   *
   * AZ IDEIGLENES FÁJLOKAT KIHAGYJA. Egy `.tmp` végű név egy FUTÓ írás
   * közepe, nem elárvult fájl: ha beleszámolna, minden párhuzamos feltöltés
   * hamis leletet gyártana, és három ilyen után senki nem nézné meg a listát.
   *
   * NEM CSATOLT VAGY HIÁNYZÓ GYÖKÉR ESETÉN ÜRES A VÁLASZ, nem kivétel: a
   * beállítottság kérdését a `describe()` méri, és két helyen felelni rá annyit
   * tenne, hogy a hívó két különböző választ kaphat ugyanarra.
   */
  async list(): Promise<DocumentKey[]> {
    const assetsRoot = path.join(this.root, "assets");
    let assetDirectories;
    try {
      assetDirectories = await readdir(assetsRoot, { withFileTypes: true });
    } catch (error) {
      if (isMissingFile(error)) return [];
      throw error;
    }

    const keys: DocumentKey[] = [];
    for (const assetDirectory of assetDirectories) {
      if (!assetDirectory.isDirectory()) continue;
      const documents = await readdir(
        path.join(assetsRoot, assetDirectory.name),
        {
          withFileTypes: true,
        },
      );
      for (const document of documents) {
        if (!document.isFile()) continue;
        if (document.name.endsWith(".tmp")) continue;
        keys.push({
          assetId: assetDirectory.name,
          documentId: document.name,
        });
      }
    }
    return keys;
  }

  /**
   * A TÁROLÓ AKKOR ÉS CSAK AKKOR BEÁLLÍTOTT, HA A JELÖLŐ OTT VAN ÉS A KÖNYVTÁR
   * ÍRHATÓ.
   *
   * A JELÖLŐT AZ ALKALMAZÁS SOHA NEM HOZZA LÉTRE, és ez a szakasz lényege. Ha
   * létrehozná, akkor egy NEM csatolt könyvtárban is létrejönne (a csatolási
   * pont üres könyvtára ugyanolyan írható, mint a csatolt kötet), és a védelem
   * MINDIG zöld lenne. Egy ellenőrzés, ami nem tud elbukni, díszlet: úgy néz
   * ki, mintha mérnénk, közben a fájlok a hoszt lemezére mennek, és a következő
   * újraindítás elviszi őket.
   *
   * A jelölőt a telepítés teszi le, a csatolt köteten belül. Ez a
   * végrehajtási sorrend 8. lépése, és más keze kell hozzá.
   *
   * A HÁROM ÁLLAPOT NEM UGYANAZ A HIBA: a hiányzó jelölő azt jelenti, hogy
   * senki nem csatolta a kötetet (`not-configured`, telepítési kérdés); az
   * írhatatlan vagy nem könyvtár gyökér azt, hogy ott VAN valami, de nem
   * használható (`broken`, jogosultsági kérdés). A kettőt más ember oldja fel,
   * ezért nem szabad egy közös „nem működik" alá vonni őket.
   */
  async describe(): Promise<DocumentStoreStatus> {
    let entry;
    try {
      entry = await stat(this.root);
    } catch (error) {
      if (isMissingFile(error)) {
        return {
          state: "not-configured",
          reason: `A tároló gyökere nem létezik: ${this.root}`,
        };
      }
      throw error;
    }

    if (!entry.isDirectory()) {
      return {
        state: "broken",
        reason: `A tároló gyökere nem könyvtár: ${this.root}`,
      };
    }

    try {
      await access(path.join(this.root, MARKER_FILE), constants.F_OK);
    } catch {
      return {
        state: "not-configured",
        reason: `A jelölő fájl hiányzik, tehát a kötet nincs csatolva: ${path.join(this.root, MARKER_FILE)}`,
      };
    }

    // AZ ÍRHATÓSÁG A JELÖLŐ UTÁN JÖN, és a sorrend számít: egy csatolt, de
    // írásvédett kötet MÁS hiba, mint egy nem csatolt könyvtár, és ha az
    // írhatóságot néznénk előbb, a nem csatolt eset is `broken`-nek látszana.
    try {
      await access(this.root, constants.W_OK);
    } catch {
      return {
        state: "broken",
        reason: `A tároló gyökere nem írható: ${this.root}`,
      };
    }

    return { state: "ready" };
  }

  /**
   * AZ ÚTVONAL A GYÖKÉR ALATT MARAD, VAGY NINCS MŰVELET.
   *
   * MIÉRT NEM ELÉG A SZÖVEGES ELLENŐRZÉS: egy `..` szegmens, egy abszolút
   * azonosító vagy egy perjeles azonosító mind a gyökér FÖLÉ vihet, és a három
   * eset szövegesen máshogy néz ki. A `resolve` mindegyiket ugyanarra a
   * kérdésre vezeti vissza: hol van a fájl VALÓJÁBAN. A `relative` pedig
   * megmondja, hogy az kívül esik-e -- ha igen, `..`-vel kezdődik, vagy maga is
   * abszolút.
   */
  private resolveWithin(key: DocumentKey): string {
    const target = path.resolve(
      this.root,
      "assets",
      key.assetId,
      key.documentId,
    );
    const relative = path.relative(this.root, target);

    if (
      relative === "" ||
      relative.startsWith("..") ||
      path.isAbsolute(relative)
    ) {
      throw new Error(
        `A dokumentum útvonala a tároló gyökerén kívülre mutat: ${key.assetId}/${key.documentId}`,
      );
    }

    return target;
  }
}

/**
 * A JELÖLŐ FÁJL NEVE. Pontos névvel szerepel a telepítési lépésben is: ha a
 * kettő eltér, a tároló minden indulásnál `not-configured`, és a hiba a
 * legrosszabb helyen derül ki, a felhasználó első feltöltésénél.
 */
export const MARKER_FILE = ".acropora-document-store";

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
